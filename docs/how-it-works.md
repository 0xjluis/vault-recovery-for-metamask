# How it works

Where MetaMask keeps its vault in a Chromium browser, how the tool reads it, and how it turns it into accounts.
References to MetaMask's code are to
[metamask-extension](https://github.com/MetaMask/metamask-extension) at commit `254e5927483a9190fa9e188ca34569b2d799b46b`
(2026-10-28).

## Where the vault is

MetaMask stores its state with the extension storage API, `browser.storage.local`
(`shared/lib/stores/extension-store.ts`), in one of two formats:

| Format | Keys | Where the vault is |
| --- | --- | --- |
| `data` (older) | `data`, `meta` | `data.KeyringController.vault` |
| Split state (newer) | `manifest` (list of keys), then one key per controller | key `KeyringController`, field `vault` |

Recent versions also keep a **backup** (`shared/lib/stores/persistence-manager.ts`): after each write that contains a
vault, a copy of `KeyringController`, `AppMetadataController`, `AnalyticsController` and `meta` goes to an
IndexedDB database named `metamask-backup`, object store `store`. MetaMask reads it only at startup, when
`storage.local` fails or has no vault, and then offers to restore from it.

Chromium keeps both in LevelDB databases inside the browser profile:

| Data | Folder |
| --- | --- |
| `storage.local` | `<profile>/Local Extension Settings/<extension id>/` |
| IndexedDB backup | `<profile>/IndexedDB/chrome-extension_<extension id>_0.indexeddb.leveldb/` |

The extension id is `nkbihfbeogaeaoehlefnkodbefgpgknn` for the Chrome Web Store build (Chrome, Brave, Chromium and
other browsers that install from that store) and `ejbalbakoplchlghecdalmeeeajnimhm` for the Edge Add-ons build.

Usual profile folders (`<profile>` is `Default`, `Profile 1`, `Profile 2`...):

| Browser | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Chrome | `%LOCALAPPDATA%\Google\Chrome\User Data\` | `~/Library/Application Support/Google/Chrome/` | `~/.config/google-chrome/` |
| Brave | `%LOCALAPPDATA%\BraveSoftware\Brave-Browser\User Data\` | `~/Library/Application Support/BraveSoftware/Brave-Browser/` | `~/.config/BraveSoftware/Brave-Browser/` |
| Edge | `%LOCALAPPDATA%\Microsoft\Edge\User Data\` | `~/Library/Application Support/Microsoft Edge/` | `~/.config/microsoft-edge/` |

## Reading LevelDB (`src/leveldb.js`, `src/snappy.js`)

LevelDB writes new data to a `.log` file and later compacts it into sorted `.ldb` tables. Old versions of a key stay
in both until a compaction removes them, which is why a profile often holds many copies of the vault.

- **`.log`**: 32 KiB blocks of records, each with a 7-byte header; records split across blocks are reassembled.
  Each record is a write batch: a sequence number, then Put and Delete operations.
  ([log format](https://github.com/google/leveldb/blob/main/doc/log_format.md))
- **`.ldb`**: a footer points to an index block, which points to the data blocks. Blocks may be compressed with
  Snappy and store keys with prefix compression; each key ends with its sequence number.
  ([table format](https://github.com/google/leveldb/blob/main/doc/table_format.md),
  [Snappy format](https://github.com/google/snappy/blob/main/format_description.txt))

Every record is returned, not only the latest of each key. Checksums are not verified, so a damaged file still gives
what can be read; a damaged block is skipped.

## Finding vaults (`src/vaults.js`)

Instead of following key names, the tool looks for the vault's own shape in every value: a JSON object with `data`,
`iv` and `salt` in base64, and optionally `keyMetadata`. This covers every format at once:

- In `storage.local` values are JSON, and the vault is a JSON string inside it, so it appears escaped once
  (`{\"data\":\"...`).
- In IndexedDB values are serialized by V8, and the vault string appears as plain text, one byte per character, or
  in UTF-16.

The search reads each value as one-byte text and as UTF-16, finds `{"data":` at any escaping level, takes the whole
object and checks it. If a file cannot be parsed as LevelDB, the same search runs over its raw bytes.

Copies of the same vault (same `data`, `iv` and `salt`) are merged, keeping every place they were found, and vaults
are sorted by their newest copy. Different vaults can still hold the same accounts, since MetaMask re-encrypts the
vault with a new `iv` and `salt` when it saves it; after decryption, the tools show those as "Same contents as
vault N".

## Decrypting (`src/decrypt.js`)

The vault format is MetaMask's `@metamask/browser-passworder`:

1. Key: PBKDF2-HMAC-SHA256 of the password with `salt`, `keyMetadata.params.iterations` rounds (10000 when there is no
   `keyMetadata`, 600000 or 900000 in recent vaults), 256 bits.
2. AES-GCM-256 decryption of `data` with `iv`. A wrong password fails GCM authentication.
3. The plaintext is the JSON list of keyrings.

Everything uses WebCrypto (`crypto.subtle`), the same in the browser and in Node.js.

## Accounts (`src/accounts.js`)

| Keyring type | Data | What the tool shows |
| --- | --- | --- |
| `HD Key Tree` | `mnemonic` (string, or its UTF-8 bytes), `numberOfAccounts`, `hdPath` | The phrase, and for i < `numberOfAccounts` the address and private key at `hdPath/i` (BIP39 seed with PBKDF2-HMAC-SHA512, BIP32 with `@scure/bip32`) |
| `Simple Key Pair` | List of private keys | Address and private key of each: the imported accounts |
| Others (Ledger, Trezor, QR, Snap...) | Addresses at most | The addresses; the keys are not in the vault |

Addresses are the last 20 bytes of the Keccak-256 of the uncompressed public key (`@noble/curves` secp256k1,
`@noble/hashes` Keccak), with the EIP-55 checksum.
