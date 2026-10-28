// Verifies a release folder:
//   1. every file matches SHA256SUMS, with no file missing or added
//   2. the offline audit passes (no way to reach the network)
//   3. unless --no-rebuild: rebuilding from this checkout gives the same bytes, which proves
//      the published files come from this source code (check out the release tag first)
// Usage: node scripts/verify-release.js <release folder> [--no-rebuild]

import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { auditOffline } from './audit-offline.js'
import { assembleRelease, listFiles } from './release.js'

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

function parseSums (text) {
  return new Map(text.trimEnd().split('\n').map(line => {
    const match = line.match(/^([0-9a-f]{64}) [ *](.+)$/)
    if (!match) {
      throw new Error(`Invalid SHA256SUMS line: ${line}`)
    }
    return [match[2], match[1]]
  }))
}

/**
 * @param {string} dir - Release folder.
 * @param {{rebuild?: boolean}} [options] - Whether to rebuild and compare.
 * @returns {Promise<{ok: boolean, lines: string[]}>} Result and report lines.
 */
export async function verifyRelease (dir, { rebuild = true } = {}) {
  const lines = []
  let ok = true
  const fail = message => {
    ok = false
    lines.push(`FAIL  ${message}`)
  }

  const sumsText = readFileSync(join(dir, 'SHA256SUMS'), 'utf8')
  const sums = parseSums(sumsText)
  lines.push(`SHA-256 of SHA256SUMS: ${sha256(sumsText)}`)
  const files = listFiles(dir).filter(path => path !== 'SHA256SUMS')
  for (const path of files) {
    if (!sums.has(path)) {
      fail(`${path} is not listed in SHA256SUMS`)
    } else if (sha256(readFileSync(join(dir, path))) !== sums.get(path)) {
      fail(`${path} does not match SHA256SUMS`)
    }
  }
  for (const path of sums.keys()) {
    if (!files.includes(path)) {
      fail(`${path} is listed in SHA256SUMS but missing`)
    }
  }
  if (ok) {
    lines.push(`ok    ${files.length} files match SHA256SUMS`)
  }

  for (const [file, problems] of Object.entries(auditOffline(dir))) {
    if (problems.length) {
      fail(`offline audit of ${file}: ${problems.join('; ')}`)
    }
  }
  if (ok) {
    lines.push('ok    offline audit: the page and the CLI cannot reach the network')
  }

  if (rebuild) {
    const tmp = mkdtempSync(join(tmpdir(), 'verify-release-'))
    try {
      const rebuilt = parseSums(await assembleRelease(tmp))
      let same = true
      for (const path of new Set([...sums.keys(), ...rebuilt.keys()])) {
        if (sums.get(path) !== rebuilt.get(path)) {
          same = false
          fail(`${path} differs from the file rebuilt from this checkout`)
        }
      }
      if (same) {
        lines.push('ok    reproducible: rebuilding from this checkout gives identical files')
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }
  return { ok, lines }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2]
  if (!dir) {
    console.error('Usage: node scripts/verify-release.js <release folder> [--no-rebuild]')
    process.exit(1)
  }
  const { ok, lines } = await verifyRelease(dir, { rebuild: !process.argv.includes('--no-rebuild') })
  console.log(lines.join('\n'))
  console.log(ok ? '\nRelease verified.' : '\nRelease NOT verified.')
  process.exitCode = ok ? 0 : 1
}
