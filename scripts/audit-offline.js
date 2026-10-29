// Static checks that the distributable files use no known way to reach the network:
//   vault-recovery.html  one CSP with default-src 'none', whose hashes match the inline
//                        script and style, nothing that loads external resources, and a
//                        script that imports nothing and uses no network API
//   vault-recovery.mjs   imports only node:fs, node:path, node:readline and node:util, as
//                        esbuild's parser finds them, and uses no network API (fetch,
//                        WebSocket...), dynamic import or way to reach one at run time
//   find-metamask.*      no download, remote copy or interpreter commands
// It is a heuristic: it catches mistakes and plain additions, not code written to hide
// from it. The reproducible build is what ties the files to the reviewed source.
// Usage: node scripts/audit-offline.js <folder with the files>

import { buildSync } from 'esbuild'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const CLI_ALLOWED_IMPORTS = ['node:fs', 'node:path', 'node:readline', 'node:util']
// Network APIs, and ways to reach one that a list of names misses: dynamic import, require,
// built-in modules loaded at run time, native bindings, code built from strings, and
// computed access to the global object or process (globalThis['fe' + 'tch']). The whole
// code is searched, comments and strings included: removing comments with a regex let a
// "/*" inside a string hide the code after it
const NETWORK_APIS = /\b(fetch|WebSocket|XMLHttpRequest|EventSource|sendBeacon|WebTransport|RTCPeerConnection|getBuiltinModule|binding|_linkedBinding|dlopen|eval|Function)\b|\bimport\s*\(|\brequire\s*\(|\b(globalThis|global|self|window|process)\s*(\?\.)?\[/
const NETWORK_COMMANDS = /\b(curl|wget|nc|ncat|socat|ssh|scp|sftp|rsync|ftp|tftp|telnet|Invoke-WebRequest|Invoke-RestMethod|iwr|irm|WebClient|HttpClient|Start-BitsTransfer|Net\.Sockets|TcpClient|UdpClient|Send-MailMessage|DownloadString|DownloadFile|DownloadData|certutil|bitsadmin|mshta|Invoke-Expression|iex|Invoke-Command|Enter-PSSession|New-PSSession|Start-Process|EncodedCommand|node|python3?|perl|ruby|php|osascript)\b|\/dev\/(tcp|udp)\//i

const sha256 = text => `sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}`

/**
 * Every import of a module, static or dynamic, as esbuild's parser finds them: a regex
 * misses `import/**\/"node:net"` or `export * from "node:dgram"`.
 *
 * @param {string} code - JavaScript.
 * @returns {{path: string, kind: string}[]} Imports, or a single entry for a parse error.
 */
function findImports (code) {
  try {
    const { metafile } = buildSync({
      stdin: { contents: code, loader: 'js' },
      bundle: true,
      write: false,
      metafile: true,
      platform: 'node',
      format: 'esm',
      external: ['*'],
      logLevel: 'silent',
    })
    return Object.values(metafile.inputs).flatMap(input => input.imports)
  } catch (err) {
    return [{ path: `(cannot be parsed: ${err.message.split('\n')[0]})`, kind: 'error' }]
  }
}

function auditHtml (html) {
  const problems = []
  const policies = [...html.matchAll(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/gi)]
  if (policies.length !== 1) {
    return [`expected 1 Content-Security-Policy meta tag, found ${policies.length}`]
  }
  const directives = Object.fromEntries(policies[0][1].split(';').map(d => d.trim().split(/\s+/)).map(([name, ...values]) => [name, values]))
  if (directives['default-src']?.join(' ') !== "'none'") {
    problems.push("CSP default-src is not 'none'")
  }
  const allowed = new Set(['default-src', 'script-src', 'style-src', 'base-uri', 'form-action'])
  for (const name of Object.keys(directives)) {
    if (!allowed.has(name)) {
      problems.push(`unexpected CSP directive ${name}`)
    }
  }
  for (const name of ['base-uri', 'form-action']) {
    if (directives[name]?.join(' ') !== "'none'") {
      problems.push(`CSP ${name} is not 'none'`)
    }
  }

  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1])
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1])
  const expect = (name, blocks) => {
    const hashes = blocks.map(block => `'${sha256(block)}'`).sort()
    if ((directives[name] ?? []).slice().sort().join(' ') !== hashes.join(' ')) {
      problems.push(`CSP ${name} does not allow exactly the inline blocks by hash`)
    }
  }
  expect('script-src', scripts)
  expect('style-src', styles)
  // The policy already blocks requests: this catches a script that would try anyway
  for (const script of scripts) {
    const match = script.match(NETWORK_APIS)
    if (match) {
      problems.push(`script uses ${match[0]}`)
    }
    for (const { path } of findImports(script)) {
      problems.push(`script imports ${path}`)
    }
  }

  const markup = html.replace(/<script>[\s\S]*?<\/script>/g, '').replace(/<style>[\s\S]*?<\/style>/g, '')
  if (/<(script|link|iframe|frame|img|object|embed|audio|video|source|track|base|svg)\b/i.test(markup)) {
    problems.push('markup loads external resources')
  }
  if (/\b(src|href|action|srcset|poster)\s*=|http-equiv="refresh"/i.test(markup)) {
    problems.push('markup has src/href/action attributes or a refresh')
  }
  return problems
}

function auditCli (code) {
  const problems = []
  for (const { path, kind } of findImports(code)) {
    if (kind !== 'import-statement' || !CLI_ALLOWED_IMPORTS.includes(path)) {
      problems.push(`imports ${path}`)
    }
  }
  const match = code.match(NETWORK_APIS)
  if (match) {
    problems.push(`uses ${match[0]}`)
  }
  return problems
}

function auditScript (code) {
  const commands = code.split('\n').filter(line => !/^\s*#/.test(line)).join('\n').match(NETWORK_COMMANDS)
  return commands ? [`uses ${commands[0]}`] : []
}

/**
 * @param {string} dir - Folder with the distributable files.
 * @returns {Record<string, string[]>} Problems by file, empty when everything passes.
 */
export function auditOffline (dir) {
  const read = name => readFileSync(join(dir, name), 'utf8')
  return {
    'vault-recovery.html': auditHtml(read('vault-recovery.html')),
    'vault-recovery.mjs': auditCli(read('vault-recovery.mjs')),
    'find-metamask.sh': auditScript(read('find-metamask.sh')),
    'find-metamask.ps1': auditScript(read('find-metamask.ps1')),
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2]
  if (!dir) {
    console.error('Usage: node scripts/audit-offline.js <folder>')
    process.exit(1)
  }
  let failed = false
  for (const [file, problems] of Object.entries(auditOffline(dir))) {
    console.log(`${problems.length ? 'FAIL' : 'ok  '}  ${file}${problems.map(p => `\n        ${p}`).join('')}`)
    failed ||= problems.length > 0
  }
  process.exitCode = failed ? 1 : 0
}
