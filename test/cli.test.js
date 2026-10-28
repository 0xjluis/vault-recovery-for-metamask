import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

test('fails when no password works', () => {
  const { stdout, status } = run([dir], 'wrong\n')
  assert.equal(status, 1)
  assert.match(stdout, /Not decrypted: wrong password/)
})
