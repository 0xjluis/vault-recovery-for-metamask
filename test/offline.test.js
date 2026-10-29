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

// With a timeout: an attempt the blocker misses can keep the process waiting
const runBlocked = (args, input) =>
  spawnSync(process.execPath, ['--import', BLOCK_NETWORK, ...args], { input, encoding: 'utf8', timeout: 30000 })

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

test('the audit catches network access written to hide from it', () => {
  const tampered = mkdtempSync(join(tmpdir(), 'tampered-'))
  try {
    for (const name of ['vault-recovery.html', 'find-metamask.sh', 'find-metamask.ps1']) {
      copyFileSync(join(dir, name), join(tampered, name))
    }
    const cli = readFileSync(join(dir, 'vault-recovery.mjs'), 'utf8')
    const hidden = [
      // A "/*" in a string used to hide the rest of the line from a comment-stripping regex
      `const marker = "/*"; fetch('https://example.com') // */`,
      `process.getBuiltinModule('node:net')`,
      `globalThis['fe' + 'tch']('https://example.com')`,
      `import/**/'node:net'`,
      `export * from 'node:dgram'`,
    ]
    for (const code of hidden) {
      writeFileSync(join(tampered, 'vault-recovery.mjs'), `${cli}\n${code}\n`)
      assert.notDeepEqual(auditOffline(tampered)['vault-recovery.mjs'], [], code)
    }
    for (const line of ['exec 3<>/dev/tcp/example.com/80', 'node -e "fetch(1)"']) {
      writeFileSync(join(tampered, 'find-metamask.sh'), `${line}\n`)
      assert.notDeepEqual(auditOffline(tampered)['find-metamask.sh'], [], line)
    }
    writeFileSync(join(tampered, 'find-metamask.ps1'), 'iex (New-Object Net.WebClient).DownloadString($u)\n')
    assert.notDeepEqual(auditOffline(tampered)['find-metamask.ps1'], [])
  } finally {
    rmSync(tampered, { recursive: true, force: true })
  }
})

test('the network blocker stops a connection attempt', () => {
  // DNS servers set to this computer: if the blocker misses an attempt, no query leaves it
  const local = "require('node:dns').setServers(['127.0.0.1']);"
  const attempts = [
    ["fetch('https://example.com')", /fetch/],
    ["new (require('node:dgram').Socket)('udp4').send('x', 53, '127.0.0.1')", /dgram\.Socket\.send/],
    [`${local} const r = new (require('node:dns').Resolver)(); r.setServers(['127.0.0.1']); r.resolveTxt('example.com', () => {})`, /dns\.Resolver\.resolveTxt/],
    // Node.js can run it through the default Resolver, also blocked
    [`${local} require('node:dns').promises.resolveTxt('example.com')`, /dns\.promises\.(Resolver\.)?resolveTxt/],
  ]
  for (const [code, name] of attempts) {
    const { status, stderr } = runBlocked(['-e', code])
    assert.equal(status, 99, code)
    assert.match(stderr, new RegExp(`NETWORK ATTEMPT: ${name.source}`))
  }
})

test('the bundled CLI decrypts a vault with the network blocked', async () => {
  const vault = await encryptVault([{ type: 'HD Key Tree', data: { mnemonic: HARDHAT.mnemonic, numberOfAccounts: 1 } }], 'pw')
  writeFileSync(join(dir, '000003.log'), makeLogFile([{ sequence: 1, ops: [{ key: 'data', value: JSON.stringify({ KeyringController: { vault: JSON.stringify(vault) } }) }] }]))
  const { status, stdout, stderr } = runBlocked([join(dir, 'vault-recovery.mjs'), join(dir, '000003.log')], 'pw\n')
  assert.equal(status, 0, stderr)
  assert.doesNotMatch(stderr, /NETWORK ATTEMPT/)
  assert.match(stdout, new RegExp(HARDHAT.addresses[0]))
})
