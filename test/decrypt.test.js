import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeMnemonic } from '../src/accounts.js'
import { decryptVault } from '../src/decrypt.js'
import { encryptVault } from './helpers.js'

// Vaults from MetaMask/vault-decryptor's tests (app/lib.test.js)
const UPSTREAM_VAULTS = [
  {
    variant: 'no key metadata (10000 iterations)',
    vault: { data: 's6TpYjlUNsn7ifhEFTkuDGBUM1GyOlPrim7JSjtfIxgTt8/6MiXgiR/CtFfR4dWW2xhq85/NGIBYEeWrZThGdKGarBzeIqBfLFhw9n509jprzJ0zc2Rf+9HVFGLw+xxC4xPxgCS0IIWeAJQ+XtGcHmn0UZXriXm8Ja4kdlow6SWinB7sr/WM3R0+frYs4WgllkwggDf2/Tv6VHygvLnhtzp6hIJFyTjh+l/KnyJTyZW1TkZhDaNDzX3SCOHT', iv: 'FbeHDAW5afeWNORfNJBR0Q==', salt: 'TxZ+WbCW6891C9LK/hbMAoUsSEW1E8pyGLVBU6x5KR8=' },
  },
  {
    variant: 'key metadata with 600000 iterations',
    vault: { data: 'WHaP1FrrtV4zUonudIppDifsLHF39g6oPkVksAIdWAHBRzax1uy1asfAJprR7u72t4/HuYz5yPIFQrnNnv+hwQu9GRuty88VKMnvMy+sq8MNtoXI+C54bZpWa8r4iUQfa0Mj/cfJbpFpzOdF1ZYXahTfTcU5WsrHwvJew842CiJR4B2jmCHHXfm/DxLK3WazsVQwXJGx/U71UelGoOOrT8NI28EKrAwgPn+7Xmv0j92gmhau30N7Bo2fr6Zv', iv: 'LfD8/tY1EjXzxuemSmDVdA==', keyMetadata: { algorithm: 'PBKDF2', params: { iterations: 600000 } }, salt: 'nk4xdpmMR+1s5BYe4Vnk++XAQwrISI2bCtbMg7V1wUA=' },
  },
]

for (const { variant, vault } of UPSTREAM_VAULTS) {
  test(`decrypts an upstream vault with ${variant}`, async () => {
    const keyrings = await decryptVault(vault, 'correct horse battery staple')
    assert.equal(decodeMnemonic(keyrings[0].data.mnemonic), 'spread raise short crane omit tent fringe mandate neglect detail suspect cradle')
  })
}

test('round-trips a vault encrypted like browser-passworder', async () => {
  const keyrings = [{ type: 'Simple Key Pair', data: ['ab'.repeat(32)] }]
  assert.deepEqual(await decryptVault(await encryptVault(keyrings, 'secret'), 'secret'), keyrings)
})

test('reports a wrong password', async () => {
  const vault = await encryptVault([], 'secret')
  await assert.rejects(decryptVault(vault, 'other'), { message: 'Incorrect password' })
})

test('refuses unknown key derivations and absurd iteration counts', async () => {
  const vault = await encryptVault([], 'secret')
  await assert.rejects(decryptVault({ ...vault, keyMetadata: { algorithm: 'Argon2', params: {} } }, 'secret'), /Unsupported key derivation/)
  await assert.rejects(decryptVault({ ...vault, keyMetadata: { algorithm: 'PBKDF2', params: { iterations: 1e12 } } }, 'secret'), /Unsupported iteration count/)
})
