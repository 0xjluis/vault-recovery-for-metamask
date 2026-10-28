import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { readLogFile, readTableFile } from '../src/leveldb.js'
import { makeLogFile } from './helpers.js'

const decode = bytes => new TextDecoder().decode(bytes)

test('reads puts and deletes from a log file, with their sequence numbers', () => {
  const records = readLogFile(makeLogFile([
    { sequence: 10, ops: [{ key: 'a', value: 'one' }, { key: 'b', value: 'two' }] },
    { sequence: 12, ops: [{ key: 'a', value: null }] },
  ]))
  assert.deepEqual(records.map(r => [decode(r.key), r.value && decode(r.value), r.sequence]), [
    ['a', 'one', 10],
    ['b', 'two', 11],
    ['a', null, 12],
  ])
})

test('reassembles a record split across log blocks', () => {
  const big = 'v'.repeat(80000)
  const records = readLogFile(makeLogFile([
    { sequence: 1, ops: [{ key: 'small', value: 'x' }] },
    { sequence: 2, ops: [{ key: 'big', value: big }] },
  ]))
  assert.equal(records.length, 2)
  assert.equal(decode(records[1].value), big)
})

test('keeps the records before a torn write', () => {
  const file = makeLogFile([
    { sequence: 1, ops: [{ key: 'a', value: 'one' }] },
    { sequence: 2, ops: [{ key: 'b', value: 'two' }] },
  ])
  const records = readLogFile(file.subarray(0, file.length - 2))
  assert.deepEqual(records.map(r => decode(r.key)), ['a'])
})

test('reads every version of a key from a table file', () => {
  const bytes = new Uint8Array(readFileSync(new URL('./fixtures/vault-decryptor/chrome-windows-1/000005.ldb', import.meta.url)))
  const records = readTableFile(bytes)
  assert.equal(records.length, 41)
  assert.equal(records.filter(r => decode(r.key) === 'data').length, 40)
})

test('rejects a file that is not a table', () => {
  assert.throws(() => readTableFile(new Uint8Array(100)), /Not a LevelDB table/)
})
