import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { encryptVault, HARDHAT, makeLogFile } from './helpers.js'

const CLI = fileURLToPath(new URL('../cli/vault-recovery.js', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'vault-recovery-'))
after(() => rmSync(dir, { recursive: true, force: true }))

const run = (args, input) => spawnSync(process.execPath, [CLI, ...args], { input, encoding: 'utf8' })

const keyrings = [
  { type: 'HD Key Tree', data: { mnemonic: HARDHAT.mnemonic, numberOfAccounts: 1, hdPath: `m/44'/60'/0'/0` } },
  { type: 'Simple Key Pair', data: [HARDHAT.imported.privateKey.slice(2)] },
]
const vault = await encryptVault(keyrings, 'right')
writeFileSync(join(dir, '000003.log'), makeLogFile([
  { sequence: 5, ops: [{ key: 'KeyringController', value: JSON.stringify({ vault: JSON.stringify(vault) }) }] },
]))

test('shows addresses but no secrets by default, retrying with another password', () => {
  const { stdout, status } = run([dir], 'wrong\nright\n')
  assert.equal(status, 0)
  assert.match(stdout, /1 vault\(s\) found/)
  assert.match(stdout, new RegExp(HARDHAT.addresses[0]))
  assert.match(stdout, new RegExp(HARDHAT.imported.address))
  assert.doesNotMatch(stdout, /test test test/)
  assert.doesNotMatch(stdout, new RegExp(HARDHAT.imported.privateKey))
})

test('prints secrets in JSON only with --show-secrets', () => {
  const { stdout, status } = run(['--json', '--show-secrets', dir], 'right\n')
  assert.equal(status, 0)
  const [entry] = JSON.parse(stdout)
  assert.equal(entry.keyrings[0].mnemonic, HARDHAT.mnemonic)
  assert.equal(entry.keyrings[1].accounts[0].privateKey, HARDHAT.imported.privateKey)
})

test('shows control characters from the files as ? and marks vaults found elsewhere', async t => {
  const evil = mkdtempSync(join(tmpdir(), 'vault-recovery-'))
  t.after(() => rmSync(evil, { recursive: true, force: true }))
  const ledger = await encryptVault([{ type: 'Ledger\u001b[2J\nVault 9', data: { accounts: ['0xab\u001b]52;c;cHduZWQ=\u0007'] } }], 'right')
  // A website's tab title holding a fake vault whose keyMetadata carries escape sequences
  const planted = { ...ledger, iv: 'cGxhbnRlZA==', keyMetadata: { algorithm: '\u001b[8m', params: {} } }
  writeFileSync(join(evil, '000003.log'), makeLogFile([
    { sequence: 5, ops: [{ key: 'KeyringController', value: JSON.stringify({ vault: JSON.stringify(ledger) }) }] },
    { sequence: 6, ops: [{ key: 'SubjectMetadataController', value: JSON.stringify({ name: JSON.stringify(planted) }) }] },
  ]))
  const { stdout, status } = run([evil], 'right\n')
  assert.equal(status, 0)
  assert.doesNotMatch(stdout, /[\x00-\x09\x0b-\x1f\x7f]/)
  assert.match(stdout, /Ledger\?\[2J\?Vault 9/)
  assert.match(stdout, /0xab\?\]52;c;cHduZWQ=\?/)
  assert.match(stdout, /Vault 2\n.*key SubjectMetadataController.*\n {2}Not where MetaMask keeps its vault.*\n {2}Not decrypted: Unsupported key derivation\n/)
})

test('skips links and paths it cannot read instead of stopping', t => {
  const base = mkdtempSync(join(tmpdir(), 'vault-recovery-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const profile = join(base, 'profile')
  const outside = join(base, 'outside')
  mkdirSync(profile)
  mkdirSync(outside)
  copyFileSync(join(dir, '000003.log'), join(profile, '000003.log'))
  copyFileSync(join(dir, '000003.log'), join(outside, '000004.log'))
  // A loop, like the 'Application Data' junction of Windows profiles, and a way out of the copy
  const type = process.platform === 'win32' ? 'junction' : 'dir'
  symlinkSync(profile, join(profile, 'loop'), type)
  symlinkSync(outside, join(profile, 'outside'), type)
  const { stdout, status } = run([profile, join(base, 'missing')], 'right\n')
  assert.equal(status, 0)
  assert.match(stdout, /loop: link not followed/)
  assert.match(stdout, /outside: link not followed/)
  assert.match(stdout, /Warning: ENOENT.*missing.*skipped/)
  assert.match(stdout, /1 file\(s\) read, 1 vault\(s\) found/)
})

test('fails when no password works', () => {
  const { stdout, status } = run([dir], 'wrong\n')
  assert.equal(status, 1)
  assert.match(stdout, /Not decrypted: wrong password/)
})
