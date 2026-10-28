# IndexedDB backup written by Chrome 156

`000003.log` was written by Chrome 156.0.8078.49 (headless, fresh profile) from a `file://` page that stores a
test backup the way MetaMask's `IndexedDBStore` does: database `metamask-backup`, object store `store`, one
record per key (`KeyringController`, `AppMetadataController`, `AnalyticsController`, `meta`).

The vault uses Hardhat's public test mnemonic (as UTF-8 bytes, like the HD keyring stores it) and one imported
key, encrypted with the password `idb-test` and 600000 PBKDF2 iterations. Values in IndexedDB are V8-serialized,
not JSON, which is why this fixture exists.
