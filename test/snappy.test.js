import assert from 'node:assert/strict'
import { test } from 'node:test'
import { snappyUncompress } from '../src/snappy.js'

const decode = bytes => new TextDecoder().decode(bytes)

test('uncompresses a literal followed by an overlapping copy', () => {
  // length 9, literal "abc", copy of 6 bytes from 3 back
  assert.equal(decode(snappyUncompress(Uint8Array.from([9, 0x08, 0x61, 0x62, 0x63, 0x09, 0x03]))), 'abcabcabc')
})

test('uncompresses a long literal with an explicit length byte', () => {
  const text = 'x'.repeat(100)
  const input = Uint8Array.from([100, 60 << 2, 99, ...new TextEncoder().encode(text)])
  assert.equal(decode(snappyUncompress(input)), text)
})

test('rejects a copy before the start of the output', () => {
  assert.throws(() => snappyUncompress(Uint8Array.from([4, 0x01, 0x05])), /Invalid Snappy copy/)
})

test('rejects a length that the block cannot expand to, before allocating it', () => {
  // 1 MiB announced in 5 bytes: more than 22 times the input
  assert.throws(() => snappyUncompress(Uint8Array.from([0x80, 0x80, 0x40, 0x08, 0x61])), /Snappy block too large/)
})

test('rejects a truncated block', () => {
  assert.throws(() => snappyUncompress(Uint8Array.from([5, 0x08, 0x61, 0x62, 0x63])), /Truncated Snappy block/)
})
