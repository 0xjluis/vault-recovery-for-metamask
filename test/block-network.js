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
// A server lets others connect to this process
net.Server.prototype.listen = block('net.Server.listen')
tls.connect = block('tls.connect')
dgram.createSocket = block('dgram.createSocket')
// The class too: `new dgram.Socket('udp4')` does not go through createSocket
for (const name of ['bind', 'connect', 'send']) {
  dgram.Socket.prototype[name] = block(`dgram.Socket.${name}`)
}
// Every lookup, resolve and reverse function, also through Resolver objects: a DNS query
// is enough to send data out
for (const [prefix, api] of [
  ['dns', dns],
  ['dns.promises', dns.promises],
  ['dns.Resolver', dns.Resolver.prototype],
  ['dns.promises.Resolver', dns.promises.Resolver.prototype],
]) {
  for (const name of Object.getOwnPropertyNames(api).filter(name => /^(lookup|resolve|reverse)/.test(name))) {
    api[name] = block(`${prefix}.${name}`)
  }
}
http.request = http.get = block('http.request')
https.request = https.get = block('https.request')
http2.connect = block('http2.connect')
globalThis.fetch = block('fetch')
globalThis.WebSocket = block('WebSocket')
// Named imports of built-in modules see the patched functions too
syncBuiltinESMExports()
