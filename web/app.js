// Single-page UI over the shared core. Everything stays in memory; nothing is stored or sent.

import { decryptVault, describeKeyrings, findVaults, groupSources } from '../src/index.js'

const LEVELDB_FILE = /\.(ldb|log|sst)$/i
const WRONG_PASSWORD = 'Wrong password'
const NOT_TRIED = 'Not decrypted yet'

const $ = id => document.getElementById(id)

/** @type {any[]} */
let entries = []

/**
 * Creates an element with text content only: file contents never become HTML.
 *
 * @param {string} tag - Tag name.
 * @param {string} [className] - CSS class.
 * @param {string} [text] - Text content.
 * @returns {HTMLElement} Element.
 */
function el (tag, className, text) {
  const node = document.createElement(tag)
  if (className) {
    node.className = className
  }
  if (text !== undefined) {
    node.textContent = text
  }
  return node
}

function describeSource ({ file, key, minSequence, maxSequence, count }) {
  if (key === null) {
    return `${file} (raw scan)`
  }
  return minSequence === maxSequence
    ? `${file} · key ${key} · sequence ${maxSequence}`
    : `${file} · key ${key} · sequences ${minSequence}-${maxSequence} (${count} copies)`
}

async function scan (fileList, onlyLevelDB) {
  const selected = [...fileList].filter(file => !onlyLevelDB || LEVELDB_FILE.test(file.name))
  $('scan-status').textContent = `Reading ${selected.length} file(s)…`
  const files = await Promise.all(selected.map(async file => ({
    name: file.webkitRelativePath || file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
  })))
  const { vaults, errors } = findVaults(files)
  entries = vaults.map(found => ({ ...found, error: NOT_TRIED }))

  $('scan-status').textContent = `${files.length} file(s) read, ${vaults.length} vault(s) found.`
    + (errors.length ? ` ${errors.length} file(s) could not be parsed and were scanned as raw bytes.` : '')
  const list = $('vault-list')
  list.replaceChildren(...vaults.map(({ sources }) => {
    const item = el('li')
    for (const group of groupSources(sources)) {
      item.append(el('div', 'source mono', describeSource(group)))
    }
    return item
  }))
  $('password').disabled = !vaults.length
  $('decrypt').disabled = !vaults.length
  renderResults()
}

async function decrypt (password) {
  const pending = entries.filter(entry => entry.error === NOT_TRIED || entry.error === WRONG_PASSWORD)
  $('decrypt-status').textContent = `Decrypting ${pending.length} vault(s)…`
  $('decrypt').disabled = true
  for (const entry of pending) {
    try {
      entry.keyrings = await describeKeyrings(await decryptVault(entry.vault, password))
      delete entry.error
    } catch (err) {
      entry.error = err.message === 'Incorrect password' ? WRONG_PASSWORD : err.message
    }
  }

  // Older copies of the same vault decrypt to the same keyrings
  const seen = new Map()
  entries.forEach((entry, index) => {
    delete entry.sameAs
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

  const failed = entries.filter(entry => entry.error).length
  $('decrypt-status').textContent = failed
    ? `${entries.length - failed} decrypted, ${failed} left: try another password.`
    : 'All vaults decrypted.'
  $('decrypt').disabled = false
  renderResults()
}

function renderResults () {
  const showSecrets = $('show-secrets').checked
  $('results').replaceChildren(...entries.map((entry, index) => {
    const card = el('div', 'vault')
    card.append(el('h3', '', `Vault ${index + 1}`))
    if (entry.error) {
      card.append(el('div', entry.error === NOT_TRIED ? 'muted' : 'error', entry.error))
      return card
    }
    if (entry.sameAs !== undefined) {
      card.append(el('div', 'muted', `Same contents as vault ${entry.sameAs + 1}`))
      return card
    }
    for (const keyring of entry.keyrings) {
      const block = el('div', 'keyring')
      block.append(el('strong', '', keyring.type))
      if (keyring.mnemonic && showSecrets) {
        block.append(el('div', 'secret mono', `Secret recovery phrase: ${keyring.mnemonic}`))
      }
      for (const account of keyring.accounts) {
        block.append(el('div', 'account mono', account.path ? `${account.address}  ${account.path}` : account.address))
        if (account.privateKey && showSecrets) {
          block.append(el('div', 'secret mono', `Private key: ${account.privateKey}`))
        }
      }
      if (!keyring.accounts.length) {
        block.append(el('div', 'account muted', 'No accounts'))
      }
      card.append(block)
    }
    return card
  }))
}

// Browsers may restore form state on reload: secrets always start hidden
$('show-secrets').checked = false

$('folder').addEventListener('change', event => scan(event.target.files, true))
$('files').addEventListener('change', event => scan(event.target.files, false))
$('show-secrets').addEventListener('change', renderResults)
$('password-form').addEventListener('submit', event => {
  event.preventDefault()
  const password = $('password').value
  $('password').value = ''
  if (password) {
    decrypt(password)
  }
})
$('clear').addEventListener('click', () => {
  entries = []
  for (const id of ['folder', 'files', 'password']) {
    $(id).value = ''
  }
  $('show-secrets').checked = false
  for (const id of ['scan-status', 'decrypt-status']) {
    $(id).textContent = ''
  }
  $('vault-list').replaceChildren()
  $('password').disabled = true
  $('decrypt').disabled = true
  renderResults()
})
