import assert from 'node:assert/strict'
import { test } from 'node:test'
import { findVaults, findVaultsInText, groupSources, isVault } from '../src/vaults.js'
import { makeLogFile } from './helpers.js'

const vault = {
  data: 'ZGF0YQ==',
  iv: 'aXY=',
  keyMetadata: { algorithm: 'PBKDF2', params: { iterations: 600000 } },
  salt: 'c2FsdA==',
}

test('finds a vault as plain JSON, as in the IndexedDB backup', () => {
  assert.deepEqual(findVaultsInText(`junk${JSON.stringify(vault)}junk`), [vault])
})

test('finds a vault escaped once, as in storage.local', () => {
  const stored = JSON.stringify({ KeyringController: { vault: JSON.stringify(vault) } })
  assert.deepEqual(findVaultsInText(stored), [vault])
})

test('finds a vault escaped twice', () => {
  const stored = JSON.stringify(JSON.stringify({ KeyringController: { vault: JSON.stringify(vault) } }))
  assert.deepEqual(findVaultsInText(stored), [vault])
})

test('ignores objects that are not vaults', () => {
  assert.deepEqual(findVaultsInText('{"data":"not base64!","iv":"aXY=","salt":"c2FsdA=="}'), [])
  assert.deepEqual(findVaultsInText('{"data":"ZGF0YQ==","iv":"aXY="'), [])
  assert.equal(isVault({ data: 'ZGF0YQ==', iv: 'aXY=' }), false)
  assert.equal(isVault(null), false)
})

test('finds a vault in UTF-16 text', () => {
  const text = JSON.stringify(vault)
  const bytes = new Uint8Array(text.length * 2 + 1)
  for (let i = 0; i < text.length; i++) {
    bytes[1 + i * 2] = text.charCodeAt(i)
  }
  const { vaults } = findVaults([{ name: 'value.bin', bytes }])
  assert.deepEqual(vaults.map(v => v.vault), [vault])
})

test('merges copies of the same vault and sorts by newest copy', () => {
  const older = { ...vault, iv: 'b2xk' }
  const state = v => JSON.stringify({ KeyringController: { vault: JSON.stringify(v) } })
  const file = makeLogFile([
    { sequence: 1, ops: [{ key: 'data', value: state(older) }] },
    { sequence: 2, ops: [{ key: 'data', value: state(vault) }] },
    { sequence: 3, ops: [{ key: 'KeyringController', value: JSON.stringify({ vault: JSON.stringify(vault) }) }] },
  ])
  const { vaults, errors } = findVaults([{ name: '000003.log', bytes: file }])
  assert.deepEqual(errors, [])
  assert.deepEqual(vaults.map(v => v.vault.iv), [vault.iv, older.iv])
  assert.deepEqual(vaults[0].sources, [
    { file: '000003.log', key: 'data', sequence: 2 },
    { file: '000003.log', key: 'KeyringController', sequence: 3 },
  ])
})

test('falls back to a raw scan when a file cannot be parsed', () => {
  const bytes = new TextEncoder().encode(`garbage ${JSON.stringify(vault)}`)
  const { vaults, errors } = findVaults([{ name: '000005.ldb', bytes }])
  assert.equal(errors.length, 1)
  assert.deepEqual(vaults[0].sources, [{ file: '000005.ldb', key: null, sequence: null }])
})

test('groups sources by file and key', () => {
  assert.deepEqual(groupSources([
    { file: 'a.log', key: 'data', sequence: 3 },
    { file: 'a.log', key: 'data', sequence: 7 },
    { file: 'b.ldb', key: null, sequence: null },
  ]), [
    { file: 'a.log', key: 'data', minSequence: 3, maxSequence: 7, count: 2 },
    { file: 'b.ldb', key: null, minSequence: null, maxSequence: null, count: 1 },
  ])
})
