// Assembles release/metamask-vault-recovery-v<version>/ from a clean git checkout:
// the two built files, the kit scripts, the docs, BUILD-INFO.txt and a SHA256SUMS file.
// The build is reproducible: scripts/verify-release.js rebuilds it and compares every byte.
// Usage: node scripts/release.js [--allow-dirty]

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { auditOffline } from './audit-offline.js'
import { build } from './build.js'
import { VERSION } from '../src/version.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// Release path -> source path, for the files copied as they are
const COPIED = {
  'find-metamask.sh': 'kit/find-metamask.sh',
  'find-metamask.ps1': 'kit/find-metamask.ps1',
  'README.md': 'README.md',
  'CHANGELOG.md': 'CHANGELOG.md',
  LICENSE: 'LICENSE',
  'docs/recovery-guide.md': 'docs/recovery-guide.md',
  'docs/security.md': 'docs/security.md',
  'docs/how-it-works.md': 'docs/how-it-works.md',
  'docs/verifying-a-release.md': 'docs/verifying-a-release.md',
}

export const RELEASE_NAME = `metamask-vault-recovery-v${VERSION}`

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

function git (...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
}

/**
 * @param {string} dir - Folder.
 * @param {string} [prefix] - Path inside it.
 * @returns {string[]} Every file, as 'a/b' paths, sorted.
 */
export function listFiles (dir, prefix = '') {
  return readdirSync(join(dir, prefix), { withFileTypes: true })
    .flatMap(entry => {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      return entry.isDirectory() ? listFiles(dir, path) : [path]
    })
    .sort()
}

/**
 * sha256sum format: '<hash>  <path>' per line, sorted by path, LF endings.
 *
 * @param {string} dir - Release folder.
 * @returns {string} SHA256SUMS contents for every file but SHA256SUMS itself.
 */
export function checksums (dir) {
  return listFiles(dir)
    .filter(path => path !== 'SHA256SUMS')
    .map(path => `${sha256(readFileSync(join(dir, path)))}  ${path}\n`)
    .join('')
}

/**
 * Builds and copies every release file into `dir` and writes SHA256SUMS.
 *
 * @param {string} dir - Empty output folder.
 * @returns {Promise<string>} SHA256SUMS contents.
 */
export async function assembleRelease (dir) {
  mkdirSync(dir, { recursive: true })
  await build(dir)
  for (const [target, source] of Object.entries(COPIED)) {
    mkdirSync(dirname(join(dir, target)), { recursive: true })
    copyFileSync(join(ROOT, source), join(dir, target))
  }
  const esbuildVersion = JSON.parse(readFileSync(join(ROOT, 'node_modules/esbuild/package.json'), 'utf8')).version
  writeFileSync(join(dir, 'BUILD-INFO.txt'), [
    `name: metamask-vault-recovery`,
    `version: ${VERSION}`,
    `git commit: ${git('rev-parse', 'HEAD')}`,
    `pnpm-lock.yaml sha256: ${sha256(readFileSync(join(ROOT, 'pnpm-lock.yaml')))}`,
    `esbuild: ${esbuildVersion}`,
    '',
  ].join('\n'))
  const sums = checksums(dir)
  writeFileSync(join(dir, 'SHA256SUMS'), sums)
  return sums
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (git('status', '--porcelain') && !process.argv.includes('--allow-dirty')) {
    console.error('The working tree has uncommitted changes: a release must be built from a commit.')
    process.exit(1)
  }
  const dir = join(ROOT, 'release', RELEASE_NAME)
  rmSync(dir, { recursive: true, force: true })
  const sums = await assembleRelease(dir)

  const problems = Object.entries(auditOffline(dir)).filter(([, list]) => list.length)
  if (problems.length) {
    console.error('Offline audit failed:', JSON.stringify(Object.fromEntries(problems), null, 2))
    process.exit(1)
  }
  console.log(`${dir}\n\n${sums}\nSHA-256 of SHA256SUMS: ${sha256(sums)}`)
}
