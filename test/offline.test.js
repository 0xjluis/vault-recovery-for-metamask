// The built files cannot use the network: static audit, and the bundled CLI run end to end
// with every Node.js network API blocked.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { auditOffline } from '../scripts/audit-offline.js'
import { build } from '../scripts/build.js'
import { encryptVault, HARDHAT, makeLogFile } from './helpers.js'

const dir = mkdtempSync(join(tmpdir(), 'offline-'))
const BLOCK_NETWORK = pathToFileURL(fileURLToPath(new URL('./block-network.js', import.meta.url))).href
after(() => rmSync(dir, { recursive: true, force: true }))

before(async () => {
  await build(dir)
  for (const script of ['find-metamask.sh', 'find-metamask.ps1']) {
    copyFileSync(fileURLToPath(new URL(`../kit/${script}`, import.meta.url)), join(dir, script))
  }
})

const runBlocked = (args, input) =>
  spawnSync(process.execPath, ['--import', BLOCK_NETWORK, ...args], { input, encoding: 'utf8' })

test('the built files pass the offline audit', () => {
  assert.deepEqual(auditOffline(dir), {
    'vault-recovery.html': [],
    'vault-recovery.mjs': [],
    'find-metamask.sh': [],
    'find-metamask.ps1': [],
  })
})

test('the audit catches a page that allows connections and a CLI that fetches', () => {
  const tampered = mkdtempSync(join(tmpdir(), 'tampered-'))
  try {
    for (const name of ['vault-recovery.html', 'vault-recovery.mjs', 'find-metamask.sh', 'find-metamask.ps1']) {
      copyFileSync(join(dir, name), join(tampered, name))
    }
    const html = readFileSync(join(tampered, 'vault-recovery.html'), 'utf8')
    writeFileSync(join(tampered, 'vault-recovery.html'), html.replace("default-src 'none'", "default-src 'none'; connect-src *"))
    writeFileSync(join(tampered, 'vault-recovery.mjs'), `${readFileSync(join(tampered, 'vault-recovery.mjs'), 'utf8')}\nfetch('https://example.com')\n`)
    writeFileSync(join(tampered, 'find-metamask.ps1'), 'Invoke-WebRequest https://example.com\n')
    const problems = auditOffline(tampered)
    assert.ok(problems['vault-recovery.html'].length)
    assert.deepEqual(problems['vault-recovery.mjs'], ['uses fetch'])
    assert.deepEqual(problems['find-metamask.ps1'], ['uses Invoke-WebRequest'])
  } finally {
    rmSync(tampered, { recursive: true, force: true })
  }
})

test('the network blocker stops a connection attempt', () => {
  const { status, stderr } = runBlocked(['-e', "fetch('https://example.com')"])
  assert.equal(status, 99)
  assert.match(stderr, /NETWORK ATTEMPT: fetch/)
})

test('the bundled CLI decrypts a vault with the network blocked', async () => {
  const vault = await encryptVault([{ type: 'HD Key Tree', data: { mnemonic: HARDHAT.mnemonic, numberOfAccounts: 1 } }], 'pw')
  writeFileSync(join(dir, '000003.log'), makeLogFile([{ sequence: 1, ops: [{ key: 'data', value: JSON.stringify({ KeyringController: { vault: JSON.stringify(vault) } }) }] }]))
  const { status, stdout, stderr } = runBlocked([join(dir, 'vault-recovery.mjs'), join(dir, '000003.log')], 'pw\n')
  assert.equal(status, 0, stderr)
  assert.doesNotMatch(stderr, /NETWORK ATTEMPT/)
  assert.match(stdout, new RegExp(HARDHAT.addresses[0]))
})
