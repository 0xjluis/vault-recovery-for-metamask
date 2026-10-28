// Static checks that the distributable files cannot use the network:
//   vault-recovery.html  one CSP with default-src 'none', whose hashes match the inline
//                        script and style, and nothing that loads external resources
//   vault-recovery.mjs   imports only node:fs, node:path, node:readline and node:util,
//                        and uses no network API (fetch, WebSocket...) or dynamic import
//   find-metamask.*      no download or remote copy commands
// Usage: node scripts/audit-offline.js <folder with the files>

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const CLI_ALLOWED_IMPORTS = ['node:fs', 'node:path', 'node:readline', 'node:util']
const NETWORK_APIS = /\b(fetch|WebSocket|XMLHttpRequest|EventSource|sendBeacon|WebTransport|RTCPeerConnection)\b|\bimport\s*\(|\brequire\s*\(/
const NETWORK_COMMANDS = /\b(curl|wget|nc|ncat|socat|ssh|scp|sftp|rsync|ftp|tftp|telnet|Invoke-WebRequest|Invoke-RestMethod|iwr|irm|WebClient|HttpClient|Start-BitsTransfer|Net\.Sockets|TcpClient|UdpClient|Send-MailMessage)\b/i

const sha256 = text => `sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}`

// Code without comments: URLs and words in license headers are not calls
function stripComments (code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1')
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
  const imports = [...code.matchAll(/^\s*import\s[^'"]*?from\s+["']([^"']+)["']/gm)].map(m => m[1])
  for (const specifier of imports) {
    if (!CLI_ALLOWED_IMPORTS.includes(specifier)) {
      problems.push(`imports ${specifier}`)
    }
  }
  const match = stripComments(code).match(NETWORK_APIS)
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
