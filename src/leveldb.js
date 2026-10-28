// Read-only LevelDB parser for the files Chromium keeps in a profile.
// Formats: https://github.com/google/leveldb/blob/main/doc/log_format.md
//          https://github.com/google/leveldb/blob/main/doc/table_format.md
// Old versions of a key are kept until compaction, so every record is returned,
// not only the latest one: an old copy of the vault may be the one that matters.

import { snappyUncompress } from './snappy.js'

/**
 * @typedef {object} LevelDBRecord
 * @property {Uint8Array} key - User key.
 * @property {Uint8Array | null} value - Value, or null for a deletion.
 * @property {number} sequence - LevelDB sequence number (higher is newer).
 */

const LOG_BLOCK_SIZE = 32768
const LOG_HEADER_SIZE = 7
const LOG_FULL = 1
const LOG_FIRST = 2
const LOG_MIDDLE = 3
const LOG_LAST = 4

const TABLE_FOOTER_SIZE = 48
const TABLE_MAGIC = [0x57, 0xfb, 0x80, 0x8b, 0x24, 0x75, 0x47, 0xdb]
const BLOCK_TRAILER_SIZE = 5
const NO_COMPRESSION = 0
const SNAPPY_COMPRESSION = 1

/**
 * Reads a varint (up to 64 bits, as a Number) at `pos`.
 *
 * @param {Uint8Array} bytes - Buffer to read from.
 * @param {number} pos - Start position.
 * @returns {[number, number]} The value and the position after it.
 */
function readVarint (bytes, pos) {
  let value = 0
  let shift = 0
  let byte
  do {
    if (pos >= bytes.length || shift > 63) {
      throw new Error('Invalid varint')
    }
    byte = bytes[pos++]
    value += (byte & 0x7f) * 2 ** shift
    shift += 7
  } while (byte & 0x80)
  return [value, pos]
}

function readUint32 (bytes, pos) {
  return (bytes[pos] | (bytes[pos + 1] << 8) | (bytes[pos + 2] << 16) | (bytes[pos + 3] << 24)) >>> 0
}

function readUint64 (bytes, pos) {
  return readUint32(bytes, pos) + readUint32(bytes, pos + 4) * 2 ** 32
}

function readSlice (bytes, pos) {
  const [length, start] = readVarint(bytes, pos)
  if (start + length > bytes.length) {
    throw new Error('Slice out of bounds')
  }
  return [bytes.subarray(start, start + length), start + length]
}

/**
 * Parses a write batch: sequence, count, then Put/Delete operations.
 *
 * @param {Uint8Array} batch - Reassembled log record.
 * @param {LevelDBRecord[]} records - Output list.
 */
function parseWriteBatch (batch, records) {
  if (batch.length < 12) {
    return
  }
  const sequence = readUint64(batch, 0)
  const count = readUint32(batch, 8)
  let pos = 12
  try {
    for (let i = 0; i < count && pos < batch.length; i++) {
      const type = batch[pos++]
      let key
      ;[key, pos] = readSlice(batch, pos)
      let value = null
      if (type === 1) {
        ;[value, pos] = readSlice(batch, pos)
      } else if (type !== 0) {
        return
      }
      records.push({ key, value, sequence: sequence + i })
    }
  } catch (err) {
    // Truncated batch: keep the operations read so far
  }
}

/**
 * Reads a `.log` file (write-ahead log). Checksums are not verified, so that
 * partially corrupted files still yield what can be read.
 *
 * @param {Uint8Array} bytes - File contents.
 * @returns {LevelDBRecord[]} Records in file order.
 */
export function readLogFile (bytes) {
  const records = []
  let fragments = []
  for (let block = 0; block < bytes.length; block += LOG_BLOCK_SIZE) {
    const end = Math.min(block + LOG_BLOCK_SIZE, bytes.length)
    let pos = block
    while (pos + LOG_HEADER_SIZE <= end) {
      const length = bytes[pos + 4] | (bytes[pos + 5] << 8)
      const type = bytes[pos + 6]
      const start = pos + LOG_HEADER_SIZE
      if (type === 0 || start + length > end) {
        // Zero padding or a torn write: the rest of the block is unusable
        break
      }
      const data = bytes.subarray(start, start + length)
      pos = start + length

      if (type === LOG_FULL) {
        fragments = []
        parseWriteBatch(data, records)
      } else if (type === LOG_FIRST) {
        fragments = [data]
      } else if (type === LOG_MIDDLE && fragments.length) {
        fragments.push(data)
      } else if (type === LOG_LAST && fragments.length) {
        fragments.push(data)
        parseWriteBatch(concat(fragments), records)
        fragments = []
      } else {
        fragments = []
      }
    }
  }
  return records
}

function concat (chunks) {
  const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  let pos = 0
  for (const chunk of chunks) {
    result.set(chunk, pos)
    pos += chunk.length
  }
  return result
}

function readBlockHandle (bytes, pos) {
  const [offset, afterOffset] = readVarint(bytes, pos)
  const [size, after] = readVarint(bytes, afterOffset)
  return [{ offset, size }, after]
}

/**
 * Reads a table block and decompresses it when needed.
 *
 * @param {Uint8Array} bytes - Table file contents.
 * @param {{offset: number, size: number}} handle - Block location.
 * @returns {Uint8Array} Block contents.
 */
function readBlock (bytes, handle) {
  const end = handle.offset + handle.size
  if (end + BLOCK_TRAILER_SIZE > bytes.length) {
    throw new Error('Block out of bounds')
  }
  const contents = bytes.subarray(handle.offset, end)
  const compression = bytes[end]
  if (compression === NO_COMPRESSION) {
    return contents
  }
  if (compression === SNAPPY_COMPRESSION) {
    return snappyUncompress(contents)
  }
  throw new Error(`Unsupported block compression ${compression}`)
}

/**
 * Parses the prefix-compressed entries of a block.
 *
 * @param {Uint8Array} block - Block contents.
 * @returns {{key: Uint8Array, value: Uint8Array}[]} Entries.
 */
function readBlockEntries (block) {
  const restarts = readUint32(block, block.length - 4)
  const entriesEnd = block.length - 4 - 4 * restarts
  if (entriesEnd < 0) {
    throw new Error('Invalid block restarts')
  }
  const entries = []
  let previousKey = new Uint8Array(0)
  let pos = 0
  while (pos < entriesEnd) {
    let shared, unshared, valueLength
    ;[shared, pos] = readVarint(block, pos)
    ;[unshared, pos] = readVarint(block, pos)
    ;[valueLength, pos] = readVarint(block, pos)
    if (shared > previousKey.length || pos + unshared + valueLength > entriesEnd) {
      throw new Error('Invalid block entry')
    }
    const key = concat([previousKey.subarray(0, shared), block.subarray(pos, pos + unshared)])
    pos += unshared
    entries.push({ key, value: block.subarray(pos, pos + valueLength) })
    pos += valueLength
    previousKey = key
  }
  return entries
}

/**
 * Reads a `.ldb` (or `.sst`) table file. Damaged data blocks are skipped.
 *
 * @param {Uint8Array} bytes - File contents.
 * @returns {LevelDBRecord[]} Records in key order.
 */
export function readTableFile (bytes) {
  if (bytes.length < TABLE_FOOTER_SIZE) {
    throw new Error('File too small for a LevelDB table')
  }
  const footer = bytes.subarray(bytes.length - TABLE_FOOTER_SIZE)
  if (!TABLE_MAGIC.every((byte, i) => footer[40 + i] === byte)) {
    throw new Error('Not a LevelDB table')
  }
  const [, afterMetaindex] = readBlockHandle(footer, 0)
  const [indexHandle] = readBlockHandle(footer, afterMetaindex)

  const records = []
  for (const { value } of readBlockEntries(readBlock(bytes, indexHandle))) {
    try {
      const [handle] = readBlockHandle(value, 0)
      for (const { key, value: entryValue } of readBlockEntries(readBlock(bytes, handle))) {
        // Internal key: user key + 8 bytes of (sequence << 8 | type)
        if (key.length < 8) {
          continue
        }
        const tag = readUint64(key, key.length - 8)
        const type = tag % 256
        records.push({
          key: key.subarray(0, key.length - 8),
          value: type === 1 ? entryValue : null,
          sequence: Math.floor(tag / 256),
        })
      }
    } catch (err) {
      // Damaged data block: continue with the next one
    }
  }
  return records
}
