// Finds MetaMask vaults ({"data","iv","salt"[,"keyMetadata"]} JSON) in browser files.
// The vault is searched as text inside every LevelDB value instead of relying on key
// names, so it covers storage.local ("data" or split state, JSON-escaped once) and the
// IndexedDB backup (V8-serialized strings, not escaped).

import { readLogFile, readTableFile } from './leveldb.js'

/**
 * @typedef {object} Vault
 * @property {string} data
 * @property {string} iv
 * @property {string} salt
 * @property {{algorithm: string, params: {iterations: number}}} [keyMetadata]
 */

/**
 * @typedef {object} VaultSource
 * @property {string} file - File the vault was read from.
 * @property {string | null} key - LevelDB key, or null when found by a raw scan.
 * @property {number | null} sequence - LevelDB sequence number (higher is newer).
 */

/**
 * @typedef {object} FoundVault
 * @property {Vault} vault
 * @property {VaultSource[]} sources
 */

const BASE64 = /^[A-Za-z0-9+/]+=*$/
const MAX_VAULT_LENGTH = 1 << 20
// `{"data":` with the same number of backslashes before both quotes (escaping level)
const VAULT_START = /\{(\\*)"data\1"\s*:/g

const latin1 = new TextDecoder('latin1')
const utf16 = new TextDecoder('utf-16le')

/**
 * @param {unknown} value - Parsed JSON.
 * @returns {value is Vault} Whether it has the shape of an encrypted vault.
 */
export function isVault (value) {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const { data, iv, salt, keyMetadata } = /** @type {any} */ (value)
  if (![data, iv, salt].every(field => typeof field === 'string' && BASE64.test(field))) {
    return false
  }
  return keyMetadata === undefined || (typeof keyMetadata === 'object' && keyMetadata !== null)
}

/**
 * Finds the closing brace of the object starting at `start`.
 *
 * @param {string} text - Text to search.
 * @param {number} start - Position of the opening brace.
 * @returns {number} Position of the closing brace, or -1.
 */
function findObjectEnd (text, start) {
  let depth = 0
  const limit = Math.min(text.length, start + MAX_VAULT_LENGTH)
  for (let i = start; i < limit; i++) {
    if (text[i] === '{') {
      depth++
    } else if (text[i] === '}' && --depth === 0) {
      return i
    }
  }
  return -1
}

/**
 * @param {string} text - Any text, possibly with vaults JSON-escaped one or more times.
 * @returns {Vault[]} Vaults found, in order.
 */
export function findVaultsInText (text) {
  const vaults = []
  for (const match of text.matchAll(VAULT_START)) {
    const end = findObjectEnd(text, match.index)
    if (end === -1) {
      continue
    }
    let candidate = text.slice(match.index, end + 1)
    try {
      // Each escaping level doubles the backslashes plus one: 0, 1, 3, 7...
      const levels = Math.log2(match[1].length + 1)
      for (let i = 0; i < levels; i++) {
        candidate = JSON.parse(`"${candidate}"`)
      }
      const vault = JSON.parse(candidate)
      if (isVault(vault)) {
        vaults.push(vault)
      }
    } catch (err) {
      // Not a complete vault: continue
    }
  }
  return vaults
}

/**
 * Searches vaults in a byte buffer, read both as one-byte and as UTF-16 text.
 *
 * @param {Uint8Array} bytes - Bytes to search.
 * @returns {Vault[]} Vaults found.
 */
function findVaultsInBytes (bytes) {
  return [
    ...findVaultsInText(latin1.decode(bytes)),
    ...findVaultsInText(utf16.decode(bytes.subarray(0, bytes.length - (bytes.length % 2)))),
    ...findVaultsInText(utf16.decode(bytes.subarray(1, bytes.length - ((bytes.length - 1) % 2)))),
  ]
}

/**
 * Groups the copies of a vault by file and key, with their sequence range.
 *
 * @param {VaultSource[]} sources - Where a vault was found.
 * @returns {{file: string, key: string | null, minSequence: number | null, maxSequence: number | null, count: number}[]} Groups.
 */
export function groupSources (sources) {
  const groups = new Map()
  for (const source of sources) {
    const id = `${source.file}\u0000${source.key}`
    groups.set(id, [...(groups.get(id) ?? []), source])
  }
  return [...groups.values()].map(group => {
    const sequences = group.map(source => source.sequence).filter(sequence => sequence !== null)
    return {
      file: group[0].file,
      key: group[0].key,
      minSequence: sequences.length ? Math.min(...sequences) : null,
      maxSequence: sequences.length ? Math.max(...sequences) : null,
      count: group.length,
    }
  })
}

function vaultId (vault) {
  return `${vault.data}|${vault.iv}|${vault.salt}`
}

// IndexedDB keys carry binary prefixes and UTF-16 strings: keep only the readable part
function printableKey (key) {
  return latin1.decode(key).replace(/\0/g, '').replace(/[^\x20-\x7e]/g, '.').replace(/^\.+/, '')
}

/**
 * Finds every vault in a set of files: LevelDB `.log` and `.ldb` files are parsed,
 * and every file is also scanned as raw bytes in case it is damaged.
 *
 * @param {{name: string, bytes: Uint8Array}[]} files - Files to search.
 * @returns {{vaults: FoundVault[], errors: {file: string, message: string}[]}} Distinct
 * vaults, newest first, and the files that could not be parsed.
 */
export function findVaults (files) {
  /** @type {Map<string, FoundVault>} */
  const found = new Map()
  const errors = []

  const add = (vault, source) => {
    const id = vaultId(vault)
    const entry = found.get(id) ?? { vault, sources: [] }
    if (!entry.sources.some(s => s.file === source.file && s.key === source.key && s.sequence === source.sequence)) {
      entry.sources.push(source)
    }
    found.set(id, entry)
  }

  for (const { name, bytes } of files) {
    let records = []
    try {
      if (/\.log$/i.test(name)) {
        records = readLogFile(bytes)
      } else if (/\.(ldb|sst)$/i.test(name)) {
        records = readTableFile(bytes)
      }
    } catch (err) {
      errors.push({ file: name, message: err.message })
    }

    let parsed = 0
    for (const record of records) {
      if (!record.value) {
        continue
      }
      for (const vault of findVaultsInBytes(record.value)) {
        add(vault, { file: name, key: printableKey(record.key), sequence: record.sequence })
        parsed++
      }
    }
    // Raw scan finds vaults in damaged or unknown files; skip it when parsing worked
    if (parsed === 0) {
      for (const vault of findVaultsInBytes(bytes)) {
        add(vault, { file: name, key: null, sequence: null })
      }
    }
  }

  const newest = entry => Math.max(-1, ...entry.sources.map(s => s.sequence ?? -1))
  return {
    vaults: [...found.values()].sort((a, b) => newest(b) - newest(a)),
    errors,
  }
}
