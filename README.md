# MetaMask Vault Recovery

Offline tools to recover the accounts of a [MetaMask](https://github.com/MetaMask/metamask-extension) browser
extension from the files it keeps in a Chromium browser profile: the secret recovery phrase, the addresses and the
private keys, including accounts imported with a private key, which the phrase alone does not restore.

Use it when MetaMask cannot be opened but its files still exist, for example:

- the computer does not start, or its disk was moved to another computer;
- the browser profile is damaged, or MetaMask shows its onboarding screen instead of your wallet;
- you restored a profile from a backup and need what is inside;
- you have the recovery phrase but need the imported accounts, or the vaults of other browser profiles.

You need the **MetaMask password** used in that profile: without it the vault cannot be decrypted, by this or any
other tool.

Nothing here connects to the internet. The web page's Content Security Policy blocks every network request and
the page refuses to work while the computer is connected to a network; the command-line tool only reads the files
you give it. Both are checked for this on every build ([docs/security.md](docs/security.md)).

## What a release contains

| File | What it is |
| --- | --- |
| `vault-recovery.html` | Web page, one self-contained file: open it in a current browser, no install (tested in Chrome) |
| `vault-recovery.mjs` | The same as a command-line tool, dependencies included; needs [Node.js](https://nodejs.org/) 26.12.1 or later (LTS) |
| `find-metamask.sh` | Finds and copies MetaMask's data folders from a disk or a folder (Linux, macOS, live systems such as [Tails](https://tails.net/)) |
| `find-metamask.ps1` | The same for Windows PowerShell |
| `docs/` | Recovery guide, security model, how it works, how to verify a release |
| `BUILD-INFO.txt` | Git commit and toolchain the release was built from |
| `SHA256SUMS` | SHA-256 of every file above |

**Verify a release before using it**: [docs/verifying-a-release.md](docs/verifying-a-release.md).

## Quick start

1. **Copy MetaMask's data folders** out of the browser profile, with `find-metamask.sh` or `find-metamask.ps1`, or
   by hand. For each profile that had MetaMask:

   ```
   <profile>/Local Extension Settings/<extension id>/
   <profile>/IndexedDB/chrome-extension_<extension id>_0.indexeddb.leveldb/
   ```

   The extension id is `nkbihfbeogaeaoehlefnkodbefgpgknn` for the Chrome Web Store build and
   `ejbalbakoplchlghecdalmeeeajnimhm` for the Edge Add-ons build. Where profiles live, and how to reach them on a
   computer that does not start: [docs/recovery-guide.md](docs/recovery-guide.md).

2. **Disconnect the computer from every network.** The web page stays locked until you do.

3. **Decrypt** with either tool:
   - open `vault-recovery.html`, choose the copied folder, type the password;
   - or run `node vault-recovery.mjs <copied folder>`.

   Both list every vault found and its accounts. Secrets stay hidden until you ask for them.

4. **Restore** the phrase and any imported private key in a fresh MetaMask, then delete the copies.

## Why another tool

MetaMask's [vault-decryptor](https://github.com/MetaMask/vault-decryptor) searches the files with regular
expressions and uses the first vault it matches. Browsers keep several copies: every older version of the stored
state until [LevelDB](https://github.com/google/leveldb) compacts it, and, in recent MetaMask versions, a backup
copy in IndexedDB that the official tool does not read. This tool parses the LevelDB files and returns every
distinct vault, which matters when the newest copy is not the one you need. See
[docs/how-it-works.md](docs/how-it-works.md).

## Building from source

Requirements: [Node.js](https://nodejs.org/) 26 LTS (`.nvmrc`) and [pnpm](https://pnpm.io/) 12.14.0
(`packageManager` in `package.json`).

```bash
pnpm install --frozen-lockfile
```

```bash
pnpm test
```

```bash
pnpm build
```

| Command | What it does |
| --- | --- |
| `pnpm test` | Unit tests, upstream fixtures, a real Chrome IndexedDB file, the kit scripts and the offline checks |
| `pnpm build` | Builds `dist/vault-recovery.html` and `dist/vault-recovery.mjs` |
| `pnpm audit:offline <folder>` | Checks that the built files cannot reach the network |
| `pnpm release` | Assembles `release/metamask-vault-recovery-v<version>/` from a clean commit |
| `pnpm verify-release <folder>` | Checks a release against `SHA256SUMS` and rebuilds it to compare every byte |

## Dependencies

| Package | Used for |
| --- | --- |
| [@noble/curves](https://github.com/paulmillr/noble-curves) | secp256k1 public keys |
| [@noble/hashes](https://github.com/paulmillr/noble-hashes) | Keccak-256 for addresses |
| [@scure/bip32](https://github.com/paulmillr/scure-bip32) | HD key derivation ([BIP32](https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki)) |
| [@scure/base](https://github.com/paulmillr/scure-base) | Pulled in by `@scure/bip32` |
| [esbuild](https://github.com/evanw/esbuild) | Build only: bundles the page and the CLI |

The four runtime packages come from the same author and are independently audited (see their READMEs).
Decryption uses the [WebCrypto](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto) built into browsers
and Node.js. pnpm installs only versions published at least 7 days ago and runs no install scripts
([pnpm-workspace.yaml](pnpm-workspace.yaml)).

## Layout

```
src/        shared core: LevelDB and Snappy readers, vault search, decryption, account derivation
cli/        command-line tool
web/        web page (template, style, script)
kit/        find-metamask.sh and find-metamask.ps1
scripts/    build, offline audit, release, release verification
test/       tests and fixtures
docs/       documentation
```

## Credits and license

The vault format is [@metamask/browser-passworder](https://github.com/MetaMask/browser-passworder)'s, and the
storage layout is [metamask-extension](https://github.com/MetaMask/metamask-extension)'s. Test fixtures in
`test/fixtures/vault-decryptor` come from [MetaMask/vault-decryptor](https://github.com/MetaMask/vault-decryptor)
(ISC). This project is released under the ISC license, see [LICENSE](LICENSE).
