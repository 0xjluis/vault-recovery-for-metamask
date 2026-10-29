// Finds MetaMask vaults ({"data","iv","salt"[,"keyMetadata"]} JSON) in browser files.
// The vault is searched as text inside every LevelDB value instead of relying on key
// names, so it covers storage.local ("data" or split state, JSON-escaped once) and the
// IndexedDB backup (V8-serialized strings, not escaped). Text from websites can also land
// in these files (tab titles, NFT names, localStorage), so each vault records whether a
// copy was found where MetaMask keeps its own: the KeyringController state.

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
 * @property {boolean} inKeyringController - Whether a copy was found in MetaMask's
 * KeyringController state, and not only elsewhere in the files or by a raw scan.
 */

const BASE64 = /^[A-Za-z0-9+/]+=*$/
const MAX_VAULT_LENGTH = 1 << 20
// The vault, keyMetadata and its params, plus one level to spare. Deeper objects are not
// vaults, and stopping there keeps the search linear: without the limit, `{"data":`
// repeated made every match scan up to MAX_VAULT_LENGTH (hours for a few MB)
const MAX_VAULT_DEPTH = 4
// `{"data":` with the same number of backslashes before both quotes (escaping level)
const VAULT_START = /\{(\\*)"data\1"\s*:/g

const latin1 = new TextDecoder('latin1')
const utf16 = new TextDecoder('utf-16le')
const utf8 = new TextDecoder()

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
 * @returns {number} Position of the closing brace, or -1 if the object is too long or
 * too deep for a vault.
 */
function findObjectEnd (text, start) {
  let depth = 0
  const limit = Math.min(text.length, start + MAX_VAULT_LENGTH)
  for (let i = start; i < limit; i++) {
    if (text[i] === '{') {
      if (++depth > MAX_VAULT_DEPTH) {
        return -1
      }
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
    if (!groups.has(id)) {
      groups.set(id, [])
    }
    groups.get(id).push(source)
  }
  return [...groups.values()].map(group => {
    const sequences = group.map(source => source.sequence).filter(sequence => sequence !== null)
    return {
      file: group[0].file,
      key: group[0].key,
      // Not Math.min(...sequences): a spread of many copies overflows the stack
      minSequence: sequences.length ? sequences.reduce((min, sequence) => Math.min(min, sequence)) : null,
      maxSequence: sequences.length ? sequences.reduce((max, sequence) => Math.max(max, sequence)) : null,
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
 * MetaMask keeps its vault in the KeyringController state: under its own key in split
 * state and in the IndexedDB backup, or at KeyringController.vault inside the "data" key.
 *
 * @param {string} key - Printable LevelDB key.
 * @param {Uint8Array} value - LevelDB value the vault was found in.
 * @param {Vault} vault - Vault found.
 * @returns {boolean} Whether it is the vault of that KeyringController state.
 */
function isKeyringControllerCopy (key, value, vault) {
  if (key === 'KeyringController') {
    return true
  }
  if (key !== 'data') {
    return false
  }
  try {
    return vaultId(JSON.parse(JSON.parse(utf8.decode(value)).KeyringController.vault)) === vaultId(vault)
  } catch (err) {
    return false
  }
}

/**
 * Finds every vault in a set of files: LevelDB `.log` and `.ldb` files are parsed,
 * and every file is also scanned as raw bytes in case it is damaged.
 *
 * @param {{name: string, bytes: Uint8Array}[]} files - Files to search.
 * @returns {{vaults: FoundVault[], errors: {file: string, message: string}[]}} Distinct
 * vaults, those found in the KeyringController state first, then newest first, and the
 * files that could not be parsed.
 */
export function findVaults (files) {
  /** @type {Map<string, FoundVault>} */
  const found = new Map()
  const errors = []

  // A file can hold hundreds of thousands of copies: no search through the sources
  const seen = new Set()
  const add = (vault, source, inKeyringController) => {
    const id = vaultId(vault)
    const entry = found.get(id) ?? { vault, sources: [], inKeyringController: false }
    const sourceId = JSON.stringify([id, source.file, source.key, source.sequence])
    if (!seen.has(sourceId)) {
      seen.add(sourceId)
      entry.sources.push(source)
    }
    entry.inKeyringController ||= inKeyringController
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

    const parsed = new Set()
    for (const record of records) {
      if (!record.value) {
        continue
      }
      const key = printableKey(record.key)
      for (const vault of findVaultsInBytes(record.value)) {
        add(vault, { file: name, key, sequence: record.sequence }, isKeyringControllerCopy(key, record.value, vault))
        parsed.add(vaultId(vault))
      }
    }
    // Raw scan finds vaults in damaged or unknown files, and in records the parser skipped
    // because they are damaged; vaults already found in this file are not added again
    for (const vault of findVaultsInBytes(bytes)) {
      if (!parsed.has(vaultId(vault))) {
        add(vault, { file: name, key: null, sequence: null }, false)
      }
    }
  }

  const newest = entry => entry.sources.reduce((max, s) => Math.max(max, s.sequence ?? -1), -1)
  return {
    vaults: [...found.values()].sort((a, b) => Number(b.inKeyringController) - Number(a.inKeyringController) || newest(b) - newest(a)),
    errors,
  }
}
