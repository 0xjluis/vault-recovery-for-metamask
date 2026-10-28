// Raw Snappy decompression, as used by LevelDB blocks.
// Format: https://github.com/google/snappy/blob/main/format_description.txt

const MAX_LENGTH = 1 << 26

/**
 * @param {Uint8Array} input - Compressed block.
 * @returns {Uint8Array} Uncompressed bytes.
 */
export function snappyUncompress (input) {
  let pos = 0
  let length = 0
  let shift = 0
  let byte
  do {
    if (pos >= input.length || shift > 28) {
      throw new Error('Invalid Snappy length')
    }
    byte = input[pos++]
    length += (byte & 0x7f) * 2 ** shift
    shift += 7
  } while (byte & 0x80)
  if (length > MAX_LENGTH) {
    throw new Error('Snappy block too large')
  }

  const output = new Uint8Array(length)
  let out = 0
  while (pos < input.length) {
    const tag = input[pos++]
    const type = tag & 3

    if (type === 0) {
      // Literal: length in the tag, or in the next 1-4 bytes
      let literalLength = tag >> 2
      if (literalLength >= 60) {
        const bytes = literalLength - 59
        literalLength = 0
        for (let i = 0; i < bytes; i++) {
          literalLength += input[pos++] * 2 ** (8 * i)
        }
      }
      literalLength += 1
      if (pos + literalLength > input.length || out + literalLength > length) {
        throw new Error('Invalid Snappy literal')
      }
      output.set(input.subarray(pos, pos + literalLength), out)
      pos += literalLength
      out += literalLength
      continue
    }

    // Copy: repeat `copyLength` bytes found `offset` bytes back in the output
    let copyLength
    let offset
    if (type === 1) {
      copyLength = ((tag >> 2) & 7) + 4
      offset = ((tag >> 5) << 8) | input[pos++]
    } else if (type === 2) {
      copyLength = (tag >> 2) + 1
      offset = input[pos] | (input[pos + 1] << 8)
      pos += 2
    } else {
      copyLength = (tag >> 2) + 1
      offset = (input[pos] | (input[pos + 1] << 8) | (input[pos + 2] << 16) | (input[pos + 3] << 24)) >>> 0
      pos += 4
    }
    if (pos > input.length || offset === 0 || offset > out || out + copyLength > length) {
      throw new Error('Invalid Snappy copy')
    }
    // Byte by byte: source and destination may overlap
    for (let i = 0; i < copyLength; i++) {
      output[out] = output[out - offset]
      out++
    }
  }

  if (out !== length) {
    throw new Error('Truncated Snappy block')
  }
  return output
}
