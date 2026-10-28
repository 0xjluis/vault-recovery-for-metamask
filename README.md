# MetaMask Vault Recovery

Recover the accounts of a MetaMask browser extension from the files it leaves on disk, offline: the secret
recovery phrase, the addresses and the private keys, including accounts imported with a private key, which the
phrase alone does not restore.

It is meant for a computer that no longer works, or a MetaMask that no longer opens, when you still know the
**MetaMask password** of that installation. Without that password the vault cannot be decrypted.

Nothing here connects to the internet. The web page's Content Security Policy blocks every network request, the
command-line tool only reads the files you give it, and both are checked for this on every build
([docs/security.md](docs/security.md)).

## What a release contains

| File | What it is |
| --- | --- |
| `vault-recovery.html` | Web page, one self-contained file: open it in a current browser, no install (tested in Chrome) |
| `vault-recovery.mjs` | The same as a command-line tool, dependencies included; needs Node.js 26.12.1 or later (LTS) |
| `find-metamask.sh` | Finds and copies MetaMask's data folders from a disk (Linux, Tails, macOS) |
| `find-metamask.ps1` | The same for Windows PowerShell |
| `docs/` | Recovery guide, security model, how it works, how to verify a release |
| `BUILD-INFO.txt` | Git commit and toolchain the release was built from |
| `SHA256SUMS` | SHA-256 of every file above |

**Verify a release before using it**: [docs/verifying-a-release.md](docs/verifying-a-release.md).

## Quick start

1. **Copy MetaMask's data** from the browser profile: the two folders below, for each profile that had MetaMask.
   From a computer that does not boot, start it from a Tails or Linux USB stick and use `find-metamask.sh`:
   [docs/recovery-guide.md](docs/recovery-guide.md) explains each step.

   ```
   <profile>/Local Extension Settings/nkbihfbeogaeaoehlefnkodbefgpgknn
   <profile>/IndexedDB/chrome-extension_nkbihfbeogaeaoehlefnkodbefgpgknn_0.indexeddb.leveldb
   ```

   Edge uses the id `ejbalbakoplchlghecdalmeeeajnimhm` instead.

2. **Disconnect from the internet.**

3. **Decrypt**, with either tool:
   - Open `vault-recovery.html`, choose the copied folder, type the MetaMask password.
   - Or run:

     ```bash
     node vault-recovery.mjs <copied folder>
     ```

   Both list every vault found with its accounts. Secrets stay hidden until you ask for them (a checkbox in the
   page, `--show-secrets` in the CLI).

4. **Write down** the secret recovery phrase and any imported private key, import them in a fresh MetaMask, then
   delete the copied folders.

## Why another tool

MetaMask's own [vault-decryptor](https://github.com/MetaMask/vault-decryptor) searches the files with regular
expressions and stops at the first vault. Browsers keep several copies: every older version of the stored state
until LevelDB compacts it, and, in recent MetaMask versions, a backup copy in IndexedDB that the official tool does
not read. This tool parses the LevelDB files and
returns every distinct vault, which matters when the newest copy is not the one with your accounts. See
[docs/how-it-works.md](docs/how-it-works.md).

## Building from source

Requirements: Node.js 26 LTS (`.nvmrc`), pnpm 12.14.0 (`packageManager` in `package.json`).

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
| `pnpm test` | Unit tests, the upstream fixtures, a real Chrome IndexedDB file, the kit scripts and the offline checks |
| `pnpm build` | Builds `dist/vault-recovery.html` and `dist/vault-recovery.mjs` |
| `pnpm audit:offline <folder>` | Checks that the built files cannot reach the network |
| `pnpm release` | Assembles `release/metamask-vault-recovery-v<version>/` from a clean commit |
| `pnpm verify-release <folder>` | Checks a release against `SHA256SUMS` and rebuilds it to compare every byte |

The project has three runtime dependencies, `@noble/curves`, `@noble/hashes` and `@scure/bip32`, which only add
`@scure/base`. All four come from the same author and are independently audited (see their READMEs). Decryption
itself uses the browser's or Node.js's built-in WebCrypto. pnpm is configured to install only versions published
at least 7 days ago and to run no install scripts ([pnpm-workspace.yaml](pnpm-workspace.yaml)).

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

Test fixtures in `test/fixtures/vault-decryptor` come from
[MetaMask/vault-decryptor](https://github.com/MetaMask/vault-decryptor) (ISC). This project is released under the
ISC license, see [LICENSE](LICENSE).
