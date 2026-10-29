// Vault decryption compatible with @metamask/browser-passworder:
// PBKDF2-SHA256 (iterations from keyMetadata) + AES-GCM-256, using only WebCrypto.

// browser-passworder's OLD_DERIVATION_PARAMS, used when a vault has no keyMetadata
const DEFAULT_ITERATIONS = 10000
// Upper bound so that crafted vaults cannot block the decryption for hours: each one costs
// this many rounds per password tried. MetaMask uses 600000 and browser-passworder 900000
// by default, so this leaves room for a later increase
const MAX_ITERATIONS = 2_000_000

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function base64ToBytes (base64) {
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0))
}

/**
 * @param {import('./vaults.js').Vault} vault - Encrypted vault.
 * @param {string} password - MetaMask password.
 * @returns {Promise<any[]>} Decrypted keyrings.
 * @throws {Error} 'Incorrect password' when the password does not match.
 */
export async function decryptVault (vault, password) {
  const algorithm = vault.keyMetadata?.algorithm ?? 'PBKDF2'
  const iterations = vault.keyMetadata?.params?.iterations ?? DEFAULT_ITERATIONS
  // keyMetadata is not encrypted nor authenticated: its values never go into a message
  if (algorithm !== 'PBKDF2') {
    throw new Error('Unsupported key derivation')
  }
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) {
    throw new Error('Unsupported iteration count')
  }

  const passwordKey = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: base64ToBytes(vault.salt), iterations, hash: 'SHA-256' },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  )

  let plaintext
  try {
    plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(vault.iv) }, key, base64ToBytes(vault.data))
  } catch (err) {
    // AES-GCM authentication fails when the key, i.e. the password, is wrong
    throw new Error('Incorrect password')
  }
  return JSON.parse(decoder.decode(plaintext))
}
