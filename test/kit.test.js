// Runs the find-metamask scripts over a fake disk with several browsers, profiles and decoys.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const KIT = fileURLToPath(new URL('../kit/', import.meta.url))
const CHROME_ID = 'nkbihfbeogaeaoehlefnkodbefgpgknn'
const EDGE_ID = 'ejbalbakoplchlghecdalmeeeajnimhm'
const LOCAL = 'Users/alice/AppData/Local'

const EXPECTED = [
  `${LOCAL}/Google/Chrome/User Data/Default/Local Extension Settings/${CHROME_ID}/000003.log`,
  `${LOCAL}/Google/Chrome/User Data/Default/Local Extension Settings/${CHROME_ID}/MANIFEST-000001`,
  `${LOCAL}/Google/Chrome/User Data/Profile 2/IndexedDB/chrome-extension_${CHROME_ID}_0.indexeddb.leveldb/000005.ldb`,
  `${LOCAL}/BraveSoftware/Brave-Browser/User Data/Default/Local Extension Settings/${CHROME_ID}/000004.log`,
  `${LOCAL}/Microsoft/Edge/User Data/Default/Local Extension Settings/${EDGE_ID}/000003.log`,
]
const DECOYS = [
  // Extension code, other extensions, and an unrelated folder with the same name
  `${LOCAL}/Google/Chrome/User Data/Default/Extensions/${CHROME_ID}/12.0.0/manifest.json`,
  `${LOCAL}/Google/Chrome/User Data/Default/Local Extension Settings/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/000003.log`,
  `${LOCAL}/Google/Chrome/User Data/Default/IndexedDB/https_example.com_0.indexeddb.leveldb/000003.log`,
  `Users/alice/Documents/${CHROME_ID}/notes.txt`,
]

const root = mkdtempSync(join(tmpdir(), 'kit-disk-'))
const work = mkdtempSync(join(tmpdir(), 'kit-out-'))
after(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(work, { recursive: true, force: true })
})
for (const file of [...EXPECTED, ...DECOYS]) {
  mkdirSync(join(root, dirname(file)), { recursive: true })
  writeFileSync(join(root, file), `contents of ${file}`)
}
// Windows profiles have junctions pointing to their own parent ('Application Data')
symlinkSync(join(root, LOCAL), join(root, LOCAL, 'Application Data'), process.platform === 'win32' ? 'junction' : 'dir')

function listFiles (dir, prefix = '') {
  return readdirSync(join(dir, prefix), { withFileTypes: true }).flatMap(entry => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    return entry.isDirectory() ? listFiles(dir, path) : [path]
  })
}

/**
 * Checks the copy: only the expected files, and a SHA256SUMS that matches them.
 *
 * @param {string} dest - Destination given to the script.
 */
function checkCopy (dest) {
  const [out] = readdirSync(dest)
  assert.match(out, /^metamask-data-\d{8}T\d{6}Z$/)
  const copied = listFiles(join(dest, out)).filter(file => file !== 'SHA256SUMS')
  assert.deepEqual(copied.sort(), [...EXPECTED].sort())

  const sums = readFileSync(join(dest, out, 'SHA256SUMS'), 'utf8').trimEnd().split('\n')
  assert.equal(sums.length, EXPECTED.length)
  for (const line of sums) {
    const [, hash, path] = line.match(/^([0-9a-f]{64}) {2}\.\/(.+)$/)
    assert.equal(createHash('sha256').update(readFileSync(join(dest, out, path))).digest('hex'), hash)
    assert.equal(createHash('sha256').update(readFileSync(join(root, path))).digest('hex'), hash)
  }
}

const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe'
const bash = process.platform === 'win32' ? (existsSync(gitBash) ? gitBash : null) : 'bash'

describe('find-metamask.sh', { skip: !bash && 'bash not available' }, () => {
  const run = (...args) => spawnSync(bash, [join(KIT, 'find-metamask.sh'), ...args], { encoding: 'utf8' })

  test('lists the MetaMask folders without copying', () => {
    const { stdout, status } = run(root)
    assert.equal(status, 0)
    assert.match(stdout, /Found 4 MetaMask folder\(s\)/)
  })

  test('copies them with a verified SHA256SUMS', () => {
    const dest = join(work, 'bash')
    const { stdout, stderr, status } = run(root, dest)
    assert.equal(status, 0, stderr)
    assert.match(stdout, /Copy verified/)
    checkCopy(dest)
  })

  test('fails when nothing is found', () => {
    const { status } = run(join(root, 'Users/alice/Documents'))
    assert.equal(status, 1)
  })
})

describe('find-metamask.ps1', { skip: process.platform !== 'win32' && 'Windows only' }, () => {
  const run = (...args) => spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(KIT, 'find-metamask.ps1'), ...args], { encoding: 'utf8' })

  test('lists the MetaMask folders without copying', () => {
    const { stdout, status } = run('-Root', root)
    assert.equal(status, 0)
    assert.match(stdout, /Found 4 MetaMask folder\(s\)/)
  })

  test('copies them with a verified SHA256SUMS', () => {
    const dest = join(work, 'powershell')
    const { stdout, stderr, status } = run('-Root', root, '-Destination', dest)
    assert.equal(status, 0, stderr)
    assert.match(stdout, /Copy verified/)
    checkCopy(dest)
  })

  test('fails when nothing is found', () => {
    const { status } = run('-Root', join(root, 'Users/alice/Documents'))
    assert.equal(status, 1)
  })
})
