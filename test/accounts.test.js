import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeMnemonic, describeKeyrings, privateKeyToAddress } from '../src/accounts.js'
import { HARDHAT } from './helpers.js'

const hexToBytes = hex => Uint8Array.from(hex.slice(2).match(/../g), byte => parseInt(byte, 16))

test('derives the checksummed address of a private key', () => {
  assert.equal(privateKeyToAddress(hexToBytes(HARDHAT.privateKeys[0])), HARDHAT.addresses[0])
})

test('derives HD accounts and imported accounts', async () => {
  const summaries = await describeKeyrings([
    { type: 'HD Key Tree', data: { mnemonic: HARDHAT.mnemonic, numberOfAccounts: 2, hdPath: `m/44'/60'/0'/0` } },
    { type: 'Simple Key Pair', data: [HARDHAT.imported.privateKey.slice(2)] },
    { type: 'Ledger Hardware', data: { accounts: ['0x0000000000000000000000000000000000000001'] } },
  ])
  assert.deepEqual(summaries, [
    {
      type: 'HD Key Tree',
      mnemonic: HARDHAT.mnemonic,
      accounts: [
        { path: `m/44'/60'/0'/0/0`, address: HARDHAT.addresses[0], privateKey: HARDHAT.privateKeys[0] },
        { path: `m/44'/60'/0'/0/1`, address: HARDHAT.addresses[1], privateKey: HARDHAT.privateKeys[1] },
      ],
    },
    { type: 'Simple Key Pair', accounts: [{ address: HARDHAT.imported.address, privateKey: HARDHAT.imported.privateKey }] },
    { type: 'Ledger Hardware', accounts: [{ address: '0x0000000000000000000000000000000000000001' }] },
  ])
})

test('a damaged keyring does not hide the others', async () => {
  const [hd, imported, broken] = await describeKeyrings([
    { type: 'HD Key Tree', data: { mnemonic: HARDHAT.mnemonic, numberOfAccounts: 1 } },
    { type: 'Simple Key Pair', data: ['not a key'] },
    { type: 'HD Key Tree', data: null },
  ])
  assert.equal(hd.mnemonic, HARDHAT.mnemonic)
  assert.deepEqual(imported, { type: 'Simple Key Pair', accounts: [], error: 'damaged keyring, could not be read' })
  assert.deepEqual(broken, { type: 'HD Key Tree', accounts: [], error: 'damaged keyring, could not be read' })
})

test('decodes a phrase stored as UTF-8 bytes', () => {
  const bytes = [...new TextEncoder().encode(HARDHAT.mnemonic)]
  assert.equal(decodeMnemonic(bytes), HARDHAT.mnemonic)
  assert.equal(decodeMnemonic({ ...bytes }), HARDHAT.mnemonic)
})
