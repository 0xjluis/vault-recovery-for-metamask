// Preload (node --import) that makes every Node.js network API exit the process with code 99
// and a message on stderr, to prove at runtime that the CLI never touches the network.

import dgram from 'node:dgram'
import dns from 'node:dns'
import http from 'node:http'
import http2 from 'node:http2'
import https from 'node:https'
import { syncBuiltinESMExports } from 'node:module'
import net from 'node:net'
import tls from 'node:tls'

const block = name => () => {
  process.stderr.write(`NETWORK ATTEMPT: ${name}\n`)
  process.exit(99)
}

net.connect = net.createConnection = block('net.connect')
net.Socket.prototype.connect = block('net.Socket.connect')
tls.connect = block('tls.connect')
dgram.createSocket = block('dgram.createSocket')
for (const name of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny']) {
  dns[name] = block(`dns.${name}`)
  dns.promises[name] = block(`dns.promises.${name}`)
}
http.request = http.get = block('http.request')
https.request = https.get = block('https.request')
http2.connect = block('http2.connect')
globalThis.fetch = block('fetch')
globalThis.WebSocket = block('WebSocket')
// Named imports of built-in modules see the patched functions too
syncBuiltinESMExports()
