// End to end over real browser files from MetaMask/vault-decryptor's fixtures.

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import { decryptVault, describeKeyrings, findVaults } from '../src/index.js'
import { HARDHAT } from './helpers.js'

const FIXTURES = [
  { dir: 'chrome-windows-1', mnemonic: 'dolphin peanut amateur party differ tomorrow clean coconut when spatial hard trigger', password: 't0b1m4ru' },
  { dir: 'chrome-windows-2', mnemonic: 'please injury labor shift much city general enemy vivid bench pottery picture', password: 'correct horse battery staple' },
  { dir: 'chromium-108.0_5359.98_4.10.24.2', mnemonic: 'harvest afraid useful nose electric swift various man boil diagram confirm ahead', password: 'JooXegoodowu8mohf2ietah5kohgah5' },
  { dir: 'chromium-94.0.4606.81_4.17', mnemonic: 'very follow angry proof column rail smile intact broom chicken lens earth', password: 'aePaf7aequukoo6lahraitheemu6pein' },
  { dir: 'chrome-119.0.6045.199-macos-arm64', mnemonic: 'position ship hill notice replace truth science angle merit reunion direct steak', password: 'r!chSloth14' },
  { dir: 'chromium-120.0.6099.71-macos-arm64', mnemonic: 'because carpet thought flame ride regular wink weather lazy spice unveil device', password: 'correct horse battery staple' },
  { dir: 'chrome-133.0.6943.127-macos-arm64', mnemonic: 'slight escape bracket joy globe bring teach exact mango mansion injury category', password: 'password' },
  { dir: 'chromium-134-ubuntu', mnemonic: 'live pupil slab senior boy release lyrics shaft lazy renew potato simple', password: 'correct horse battery staple' },
]

for (const { dir, mnemonic, password } of FIXTURES) {
  test(`recovers the phrase from ${dir}`, async () => {
    const base = new URL(`./fixtures/vault-decryptor/${dir}/`, import.meta.url)
    const files = readdirSync(base).map(name => ({ name, bytes: new Uint8Array(readFileSync(new URL(name, base))) }))
    const { vaults, errors } = findVaults(files)
    assert.deepEqual(errors, [])
    assert.ok(vaults.length >= 1)
    assert.ok(vaults.every(found => found.inKeyringController))
    for (const { vault } of vaults) {
      const [hd] = await describeKeyrings(await decryptVault(vault, password))
      assert.equal(hd.mnemonic, mnemonic)
    }
  })
}

test('recovers the IndexedDB backup written by Chrome', async () => {
  const bytes = new Uint8Array(readFileSync(new URL('./fixtures/chrome-156-indexeddb/000003.log', import.meta.url)))
  const { vaults } = findVaults([{ name: '000003.log', bytes }])
  assert.equal(vaults.length, 1)
  assert.equal(vaults[0].sources[0].key, 'KeyringController')
  assert.equal(vaults[0].inKeyringController, true)
  const [hd, imported] = await describeKeyrings(await decryptVault(vaults[0].vault, 'idb-test'))
  assert.equal(hd.mnemonic, HARDHAT.mnemonic)
  assert.deepEqual(hd.accounts.map(a => a.address), HARDHAT.addresses)
  assert.equal(imported.accounts[0].address, HARDHAT.imported.address)
})
