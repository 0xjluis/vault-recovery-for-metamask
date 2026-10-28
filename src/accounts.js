// Turns decrypted keyrings into accounts: secret recovery phrase, addresses, private keys.

import { secp256k1 } from '@noble/curves/secp256k1.js'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { HDKey } from '@scure/bip32'

const DEFAULT_HD_PATH = `m/44'/60'/0'/0`

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * @typedef {object} Account
 * @property {string} address - Checksummed address.
 * @property {string} [path] - Derivation path, for HD accounts.
 * @property {string} [privateKey] - Hex private key, when the keyring holds it.
 */

/**
 * @typedef {object} KeyringSummary
 * @property {string} type - Keyring type, e.g. 'HD Key Tree' or 'Simple Key Pair'.
 * @property {string} [mnemonic] - Secret recovery phrase, for HD keyrings.
 * @property {Account[]} accounts
 */

function toHex (bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

function hexToBytes (hex) {
  const clean = hex.replace(/^0x/, '')
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error('Invalid private key')
  }
  return Uint8Array.from(clean.match(/../g), byte => parseInt(byte, 16))
}

/**
 * The HD keyring stores the phrase as a string, or as its UTF-8 bytes (an array, or
 * an object with numeric keys when a Uint8Array went through JSON).
 *
 * @param {unknown} mnemonic - Stored phrase.
 * @returns {string} Phrase.
 */
export function decodeMnemonic (mnemonic) {
  if (typeof mnemonic === 'string') {
    return mnemonic
  }
  if (typeof mnemonic === 'object' && mnemonic !== null) {
    return decoder.decode(Uint8Array.from(Object.values(mnemonic)))
  }
  throw new Error('Unknown mnemonic format')
}

/**
 * EIP-55 checksummed address of a private key.
 *
 * @param {Uint8Array} privateKey - 32 bytes.
 * @returns {string} Address.
 */
export function privateKeyToAddress (privateKey) {
  const publicKey = secp256k1.getPublicKey(privateKey, false)
  const address = toHex(keccak_256(publicKey.subarray(1)).subarray(12))
  const hash = toHex(keccak_256(encoder.encode(address)))
  return `0x${Array.from(address, (char, i) => (parseInt(hash[i], 16) >= 8 ? char.toUpperCase() : char)).join('')}`
}

/**
 * BIP39 seed, with WebCrypto: PBKDF2-HMAC-SHA512, 2048 iterations.
 *
 * @param {string} mnemonic - Secret recovery phrase.
 * @returns {Promise<Uint8Array>} 64-byte seed.
 */
export async function mnemonicToSeed (mnemonic) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(mnemonic.normalize('NFKD')), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: encoder.encode('mnemonic'), iterations: 2048, hash: 'SHA-512' },
    key,
    512,
  )
  return new Uint8Array(bits)
}

/**
 * @param {any[]} keyrings - Decrypted vault contents.
 * @returns {Promise<KeyringSummary[]>} One summary per keyring.
 */
export async function describeKeyrings (keyrings) {
  const summaries = []
  for (const { type, data } of keyrings) {
    if (type === 'HD Key Tree') {
      const mnemonic = decodeMnemonic(data.mnemonic).trim()
      const root = HDKey.fromMasterSeed(await mnemonicToSeed(mnemonic))
      const hdPath = data.hdPath ?? DEFAULT_HD_PATH
      const accounts = []
      for (let i = 0; i < (data.numberOfAccounts ?? 1); i++) {
        const path = `${hdPath}/${i}`
        const privateKey = root.derive(path).privateKey
        accounts.push({ path, address: privateKeyToAddress(privateKey), privateKey: `0x${toHex(privateKey)}` })
      }
      summaries.push({ type, mnemonic, accounts })
    } else if (type === 'Simple Key Pair') {
      summaries.push({
        type,
        accounts: data.map(key => {
          const privateKey = hexToBytes(key)
          return { address: privateKeyToAddress(privateKey), privateKey: `0x${toHex(privateKey)}` }
        }),
      })
    } else {
      // Hardware and other keyrings only keep addresses, the keys live elsewhere
      const addresses = Array.isArray(data?.accounts) ? data.accounts.filter(a => typeof a === 'string') : []
      summaries.push({ type, accounts: addresses.map(address => ({ address })) })
    }
  }
  return summaries
}
