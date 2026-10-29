#!/usr/bin/env node
// Finds and decrypts MetaMask vaults in browser profile folders. Works offline: it only
// reads the files it is given and never opens a network connection.

import { lstatSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { parseArgs } from 'node:util'
import {
  decryptVault,
  describeKeyrings,
  findVaults,
  groupSources,
  isSupportedNodeVersion,
  MIN_NODE_VERSION,
  VERSION,
} from '../src/index.js'

const USAGE = `Usage: vault-recovery [options] <path>...

Finds MetaMask vaults in files or folders (folders are searched recursively for
.ldb and .log files), decrypts them with your password and lists the accounts.

Usual paths, inside a Chromium browser profile:
  Local Extension Settings/nkbihfbeogaeaoehlefnkodbefgpgknn
  IndexedDB/chrome-extension_nkbihfbeogaeaoehlefnkodbefgpgknn_0.indexeddb.leveldb
(Edge uses the id ejbalbakoplchlghecdalmeeeajnimhm.) Give these folders, not the
whole profile: websites can write files there that look like a vault.

Options:
  --show-secrets  Print the secret recovery phrase and the private keys
  --json          JSON output (secrets only with --show-secrets)
  -v, --version   Print the version
  -h, --help      Print this help
`

const LEVELDB_FILE = /\.(ldb|log|sst)$/i
// Far above the LevelDB files a browser writes; larger files are not read into memory
const MAX_FILE_SIZE = 256 * 1024 * 1024
const WRONG_PASSWORD = 'wrong password'
const NOT_TRIED = 'no password tried'
// C0 and C1 controls (terminal escape sequences, line breaks) and bidi overrides
const CONTROL = /[\x00-\x1f\x7f-\x9f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g

/**
 * File names and text read from the files can be crafted to fake the output, e.g. a
 * second vault with another phrase: their control characters are shown as '?'.
 *
 * @param {unknown} text - Text to print.
 * @returns {string} Text without control characters.
 */
function printable (text) {
  return String(text).replace(CONTROL, '?')
}

/** @type {import('node:readline').Interface | undefined} */
let stdinLines
/** @type {AsyncIterator<string> | undefined} */
let stdinIterator

/**
 * Links inside folders are not followed: they can loop, like the 'Application Data'
 * junction of Windows profiles, or lead out of the copy, e.g. to this computer's disk.
 * Only regular files are read, so a FIFO or a device cannot block the search. What
 * cannot be read is reported and skipped.
 *
 * @param {string[]} paths - Files or folders given by the user.
 * @param {(message: string) => void} warn - Reports what was skipped.
 * @returns {{name: string, bytes: Uint8Array}[]} Files to search.
 */
function collectFiles (paths, warn) {
  const files = []
  const visit = (path, explicit, base) => {
    try {
      const stats = explicit ? statSync(path) : lstatSync(path)
      if (stats.isSymbolicLink()) {
        warn(`${path}: link not followed`)
      } else if (stats.isDirectory()) {
        for (const entry of readdirSync(path)) {
          visit(join(path, entry), false, base)
        }
      } else if (explicit || LEVELDB_FILE.test(path)) {
        if (!stats.isFile()) {
          warn(`${path}: not a regular file, skipped`)
        } else if (stats.size > MAX_FILE_SIZE) {
          warn(`${path}: larger than ${MAX_FILE_SIZE / 1024 / 1024} MiB, skipped`)
        } else {
          files.push({ name: relative(base, path) || path, bytes: new Uint8Array(readFileSync(path)) })
        }
      }
    } catch (err) {
      warn(`${err.message}, skipped`)
    }
  }
  // Names relative to the folder holding each path given, e.g. 'IndexedDB/…/000003.log'
  for (const path of paths) {
    visit(path, true, dirname(resolve(path)))
  }
  return files
}

/**
 * Reads a line without echoing it. Falls back to a plain line when stdin is not a TTY.
 *
 * @param {string} question - Prompt.
 * @returns {Promise<string>} The line typed.
 */
function promptHidden (question) {
  if (!process.stdin.isTTY) {
    // One reader for the whole run, so that lines already buffered are not lost
    stdinLines ??= createInterface({ input: process.stdin })
    stdinIterator ??= stdinLines[Symbol.asyncIterator]()
    return stdinIterator.next().then(({ done, value }) => (done ? '' : value))
  }
  process.stdout.write(question)
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.setEncoding('utf8')
  return new Promise(resolve => {
    let value = ''
    const onData = chunk => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          process.stdin.off('data', onData)
          process.stdin.setRawMode(false)
          process.stdin.pause()
          process.stdout.write('\n')
          resolve(value)
          return
        }
        if (char === '\u0003') {
          process.stdin.setRawMode(false)
          process.stdout.write('\n')
          process.exit(130)
        }
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1)
        } else {
          value += char
        }
      }
    }
    process.stdin.on('data', onData)
  })
}

/**
 * One line per file and key: '000005.ldb · key data · sequences 5-41 (37 copies)'.
 *
 * @param {import('../src/vaults.js').VaultSource[]} sources - Where the vault was found.
 * @returns {string[]} Lines.
 */
function describeSources (sources) {
  return groupSources(sources).map(({ file, key, minSequence, maxSequence, count }) => {
    file = printable(file)
    if (key === null) {
      return `${file} (raw scan)`
    }
    return minSequence === maxSequence
      ? `${file} · key ${key} · sequence ${maxSequence}`
      : `${file} · key ${key} · sequences ${minSequence}-${maxSequence} (${count} copies)`
  })
}

function printVault (index, entry, showSecrets) {
  console.log(`\nVault ${index + 1}`)
  for (const line of describeSources(entry.sources)) {
    console.log(`  Found in: ${line}`)
  }
  if (!entry.inKeyringController) {
    console.log('  Not where MetaMask keeps its vault: it can be a damaged copy, or text that a website or another extension wrote.')
  }
  if (entry.error) {
    console.log(`  Not decrypted: ${printable(entry.error)}`)
    return
  }
  if (entry.sameAs !== undefined) {
    console.log(`  Same contents as vault ${entry.sameAs + 1}`)
    return
  }
  for (const keyring of entry.keyrings) {
    console.log(`  ${printable(keyring.type)}`)
    if (keyring.mnemonic && showSecrets) {
      console.log(`    Secret recovery phrase: ${keyring.mnemonic}`)
    }
    for (const account of keyring.accounts) {
      console.log(`    ${printable(account.address)}${account.path ? `  ${printable(account.path)}` : ''}`)
      if (account.privateKey && showSecrets) {
        console.log(`      Private key: ${account.privateKey}`)
      }
    }
    if (!keyring.accounts.length) {
      console.log('    (no accounts)')
    }
  }
}

function toJson (entries, showSecrets) {
  return entries.map(({ vault, sources, inKeyringController, error, sameAs, keyrings }) => ({
    vault,
    sources,
    inKeyringController,
    error,
    sameAs,
    keyrings: keyrings?.map(({ mnemonic, accounts, ...keyring }) => ({
      ...keyring,
      ...(showSecrets && mnemonic ? { mnemonic } : {}),
      accounts: accounts.map(({ privateKey, ...account }) => ({
        ...account,
        ...(showSecrets && privateKey ? { privateKey } : {}),
      })),
    })),
  }))
}

async function main () {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'show-secrets': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      version: { type: 'boolean', short: 'v', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  if (values.version) {
    console.log(VERSION)
    return
  }
  if (values.help || !positionals.length) {
    console.log(USAGE)
    process.exitCode = values.help ? 0 : 1
    return
  }
  // Secrets go through this process: refuse Node.js versions with known vulnerabilities
  if (!isSupportedNodeVersion(process.versions.node)) {
    console.error(`vault-recovery needs Node.js ${MIN_NODE_VERSION} or later (the current LTS); this is ${process.versions.node}.`)
    process.exitCode = 1
    return
  }

  const log = values.json ? console.error : console.log
  const files = collectFiles(positionals, message => log(`Warning: ${printable(message)}`))
  const { vaults, errors } = findVaults(files)
  for (const { file, message } of errors) {
    log(`Warning: ${printable(file)}: ${printable(message)}, scanned as raw bytes`)
  }
  log(`${files.length} file(s) read, ${vaults.length} vault(s) found`)
  if (!vaults.length) {
    process.exitCode = 1
    return
  }

  /** @type {any[]} */
  const entries = vaults.map(found => ({ ...found, error: NOT_TRIED }))
  let pending = entries
  try {
    while (pending.length) {
      const password = await promptHidden(
        pending === entries ? 'MetaMask password: ' : `Another password for ${pending.length} vault(s) (Enter to stop): `,
      )
      if (!password) {
        break
      }
      for (const entry of pending) {
        try {
          entry.keyrings = await describeKeyrings(await decryptVault(entry.vault, password))
          delete entry.error
        } catch (err) {
          entry.error = err.message === 'Incorrect password' ? WRONG_PASSWORD : err.message
        }
      }
      pending = entries.filter(entry => entry.error === WRONG_PASSWORD)
    }
  } finally {
    stdinLines?.close()
  }

  // Older copies of the same vault decrypt to the same keyrings
  const seen = new Map()
  entries.forEach((entry, index) => {
    if (!entry.keyrings) {
      return
    }
    const id = JSON.stringify(entry.keyrings)
    if (seen.has(id)) {
      entry.sameAs = seen.get(id)
    } else {
      seen.set(id, index)
    }
  })

  if (values.json) {
    console.log(JSON.stringify(toJson(entries, values['show-secrets']), null, 2))
  } else {
    entries.forEach((entry, index) => printVault(index, entry, values['show-secrets']))
    if (!values['show-secrets'] && entries.some(entry => entry.keyrings)) {
      console.log('\nUse --show-secrets to print the secret recovery phrase and the private keys.')
    }
  }
  if (entries.every(entry => entry.error)) {
    process.exitCode = 1
  }
}

main().catch(err => {
  console.error(printable(err.message))
  process.exitCode = 1
})
