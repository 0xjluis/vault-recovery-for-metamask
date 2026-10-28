// Builds the two distributable files into dist/ (or the folder given):
//   vault-recovery.html  web page, self-contained: inline script and style allowed by hash in
//                        a Content-Security-Policy that blocks every network request
//   vault-recovery.mjs   CLI with its dependencies bundled, runs with Node.js alone (26 LTS)
// Output is not minified, so that it can be read, and is reproducible: the same sources and
// lockfile always give the same bytes.

import { build as esbuild } from 'esbuild'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { VERSION } from '../src/version.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

const sha256 = text => createHash('sha256').update(text, 'utf8').digest('base64')

/**
 * @param {string} outDir - Output folder.
 * @returns {Promise<string[]>} Paths of the files written.
 */
export async function build (outDir = join(ROOT, 'dist')) {
  mkdirSync(outDir, { recursive: true })

  // absWorkingDir: the paths esbuild writes in comments must not depend on the caller's cwd
  const web = await esbuild({
    absWorkingDir: ROOT,
    entryPoints: [join(ROOT, 'web/app.js')],
    bundle: true,
    format: 'iife',
    target: 'es2022',
    charset: 'utf8',
    legalComments: 'inline',
    write: false,
  })
  // Keep the bundle from closing its own <script> tag
  const script = web.outputFiles[0].text.replaceAll('</script', '<\\/script')
  const style = readFileSync(join(ROOT, 'web/style.css'), 'utf8')
  const csp = [
    "default-src 'none'",
    `script-src 'sha256-${sha256(script)}'`,
    `style-src 'sha256-${sha256(style)}'`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
  const html = readFileSync(join(ROOT, 'web/index.html'), 'utf8')
    .replace('__CSP__', () => csp)
    .replace('__VERSION__', () => VERSION)
    .replace('__STYLE__', () => style)
    .replace('__SCRIPT__', () => script)
  const htmlPath = join(outDir, 'vault-recovery.html')
  writeFileSync(htmlPath, html)

  const cliPath = join(outDir, 'vault-recovery.mjs')
  await esbuild({
    absWorkingDir: ROOT,
    entryPoints: [join(ROOT, 'cli/vault-recovery.js')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node26',
    charset: 'utf8',
    legalComments: 'inline',
    outfile: cliPath,
  })

  return [htmlPath, cliPath]
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const path of await build()) {
    console.log(path)
  }
}
