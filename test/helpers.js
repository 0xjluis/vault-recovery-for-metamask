// Test helpers: build vaults and LevelDB log files like MetaMask and Chromium do.

const encoder = new TextEncoder()

function bytesToBase64 (bytes) {
  return btoa(String.fromCharCode(...bytes))
}

/**
 * Encrypts keyrings like @metamask/browser-passworder.
 *
 * @param {any[]} keyrings - Vault contents.
 * @param {string} password - Password.
 * @param {number} [iterations] - PBKDF2 iterations; low by default to keep tests fast.
 * @returns {Promise<object>} Vault.
 */
export async function encryptVault (keyrings, password, iterations = 1000) {
  const salt = crypto.getRandomValues(new Uint8Array(32))
  const iv = crypto.getRandomValues(new Uint8Array(16))
  const passwordKey = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  )
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(keyrings)))
  return {
    data: bytesToBase64(new Uint8Array(data)),
    iv: bytesToBase64(iv),
    keyMetadata: { algorithm: 'PBKDF2', params: { iterations } },
    salt: bytesToBase64(salt),
  }
}

function varint (value) {
  const bytes = []
  while (value >= 0x80) {
    bytes.push((value & 0x7f) | 0x80)
    value = Math.floor(value / 128)
  }
  bytes.push(value)
  return bytes
}

function toBytes (value) {
  return typeof value === 'string' ? encoder.encode(value) : value
}

/**
 * Builds a LevelDB `.log` file. Checksums are left as zero: the reader ignores them.
 *
 * @param {{sequence: number, ops: {key: string | Uint8Array, value: string | Uint8Array | null}[]}[]} batches - Write batches.
 * @returns {Uint8Array} File contents.
 */
export function makeLogFile (batches) {
  const BLOCK_SIZE = 32768
  const HEADER_SIZE = 7
  const out = []
  let blockOffset = 0

  for (const { sequence, ops } of batches) {
    const batch = [
      ...Array.from({ length: 8 }, (_, i) => Math.floor(sequence / 2 ** (8 * i)) & 0xff),
      ...[0, 1, 2, 3].map(i => (ops.length >> (8 * i)) & 0xff),
    ]
    for (const { key, value } of ops) {
      const keyBytes = toBytes(key)
      batch.push(value === null ? 0 : 1, ...varint(keyBytes.length), ...keyBytes)
      if (value !== null) {
        const valueBytes = toBytes(value)
        batch.push(...varint(valueBytes.length), ...valueBytes)
      }
    }

    // Split the batch into FULL, or FIRST/MIDDLE.../LAST fragments that fit the blocks
    let pos = 0
    let first = true
    do {
      if (BLOCK_SIZE - blockOffset < HEADER_SIZE) {
        out.push(...new Array(BLOCK_SIZE - blockOffset).fill(0))
        blockOffset = 0
      }
      const length = Math.min(batch.length - pos, BLOCK_SIZE - blockOffset - HEADER_SIZE)
      const last = pos + length === batch.length
      const type = first && last ? 1 : first ? 2 : last ? 4 : 3
      out.push(0, 0, 0, 0, length & 0xff, length >> 8, type, ...batch.slice(pos, pos + length))
      blockOffset += HEADER_SIZE + length
      pos += length
      first = false
    } while (pos < batch.length)
  }
  return Uint8Array.from(out)
}

/**
 * Builds a LevelDB table (`.ldb`) with uncompressed blocks. Checksums are left as zero.
 *
 * @param {{key: string, sequence: number, value: string}[][]} blocks - Entries of each data block.
 * @param {number[]} [index] - Data block of each index entry: every block once by default.
 * @returns {Uint8Array} File contents.
 */
export function makeTableFile (blocks, index = blocks.map((_, i) => i)) {
  const out = []
  // Entries without shared key prefixes and a single restart point; returns its handle
  const addBlock = entries => {
    const bytes = []
    for (const { key, value } of entries) {
      bytes.push(0, ...varint(key.length), ...varint(value.length), ...key, ...value)
    }
    bytes.push(0, 0, 0, 0, 1, 0, 0, 0)
    const handle = [...varint(out.length), ...varint(bytes.length)]
    out.push(...bytes, 0, 0, 0, 0, 0)
    return handle
  }
  const handles = blocks.map(entries => addBlock(entries.map(({ key, sequence, value }) => ({
    // Internal key: user key + 8 bytes of (sequence << 8 | 1), 1 being a Put
    key: [...toBytes(key), ...Array.from({ length: 8 }, (_, i) => Math.floor((sequence * 256 + 1) / 2 ** (8 * i)) & 0xff)],
    value: [...toBytes(value)],
  }))))
  const indexHandle = addBlock(index.map((block, i) => ({ key: [i], value: handles[block] })))
  // Footer: metaindex and index handles, padding to 40 bytes, magic number
  const footer = [0, 0, ...indexHandle]
  out.push(...footer, ...new Array(40 - footer.length).fill(0), 0x57, 0xfb, 0x80, 0x8b, 0x24, 0x75, 0x47, 0xdb)
  return Uint8Array.from(out)
}

// Hardhat's public test mnemonic and its first accounts
export const HARDHAT = {
  mnemonic: 'test test test test test test test test test test test junk',
  addresses: ['0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'],
  privateKeys: [
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  ],
  imported: {
    privateKey: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
    address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  },
}
