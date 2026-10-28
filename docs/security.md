# Security

What this tool protects, how it shows that it never uses the network, and what it cannot protect against.

## What is at stake

The files it reads contain your vault, encrypted with your MetaMask password. Once decrypted, the vault gives
full control of every account in it. So the tool must:

- never send anything anywhere;
- show secrets only when asked;
- be verifiable: what you run must be what this source code builds, unchanged.

## No network access

| Part | Guarantee | How it is checked |
| --- | --- | --- |
| `vault-recovery.html` | Its Content Security Policy is `default-src 'none'`: the browser refuses any request (fetch, images, fonts, forms, frames...). Only the page's own inline script and style run, allowed by their SHA-256. | `scripts/audit-offline.js` parses the policy, recomputes both hashes and rejects external tags or `src`/`href`/`action` attributes |
| `vault-recovery.mjs` | Imports only `node:fs`, `node:path`, `node:readline` and `node:util`. No `fetch`, `WebSocket`, `XMLHttpRequest`, `import()` or `require()` | Same script, on the code without comments. `test/offline.test.js` also runs the CLI end to end with every Node.js network API replaced by a function that kills the process |
| `find-metamask.sh`, `.ps1` | Use only `find`, `cp`, `du`, `sha256sum`/`shasum` (and the PowerShell equivalents) | Same script, against a list of download and remote-copy commands |

The audit runs in the test suite, in `pnpm release` and in `pnpm verify-release`, and the tests check that it
catches a page that allows connections, a CLI that calls `fetch` and a script that downloads.

Static checks can be fooled by code written to hide what it does. The browser's enforcement of the policy cannot,
and neither can a computer without a network: **disconnect before typing the password** anyway.

## Secrets

- The page keeps everything in memory. It stores nothing (no `localStorage`, no cookies), writes file contents
  only as text (never as HTML), starts with secrets hidden on every load, and **Clear everything from this page**
  drops it all. Closing the tab also does.
- The CLI reads the password without echoing it, prints secrets only with `--show-secrets`, and includes them in
  `--json` output only with that flag too. Shell history never sees the password.
- The CLI refuses to run on Node.js versions older than 26.12.1, the 26 LTS release with the October 2026 security
  fixes.

## Supply chain

- Three runtime dependencies (`@noble/curves`, `@noble/hashes`, `@scure/bip32`, plus `@scure/base`), all
  independently audited, pinned to exact versions in `package.json` and by hash in `pnpm-lock.yaml`. Decryption
  uses WebCrypto, built into browsers and Node.js.
- One build dependency, `esbuild`, pinned the same way.
- `pnpm-workspace.yaml`:
  - `minimumReleaseAge: 10080`: only versions published at least 7 days ago, the usual window in which hijacked
    releases are found and removed.
  - `trustPolicy: no-downgrade`: refuses a version published with weaker provenance than earlier ones.
  - `strictDepBuilds: true` and no entry allowed in `allowBuilds`: no dependency install script ever runs.
  - `engineStrict: true`: refuses to install with a Node.js outside `engines`.
- Toolchain: Node.js 26 LTS (`.nvmrc`), pnpm 12.14.0 (`packageManager`), versions with no open security advisory
  when this release was made.
- The release files are not minified, so they can be read.

## Release integrity

Every release ships `SHA256SUMS` and `BUILD-INFO.txt`, and the build is reproducible: the same commit and lockfile
give the same bytes. [verifying-a-release.md](verifying-a-release.md) explains the checks. In short:

1. The hashes in `SHA256SUMS` match the files: nothing changed after the release was made.
2. The hash of `SHA256SUMS` matches the one published with the release: the list itself was not replaced.
3. Rebuilding from the tagged source gives the same files: they contain exactly that source code.

Releases are not signed yet. Until they are, the published hash of `SHA256SUMS` and the reproducible build are what
tie a download to this repository.

## What it does not protect against

- Malware on the computer where you decrypt. Use a clean, offline system: Tails, or a fresh browser profile with
  no extensions on a disconnected computer.
- Someone who has the copied files and knows or guesses the password. Delete the copies when you are done.
- Weak passwords: PBKDF2 slows guessing down but cannot make a short password safe.
- Hardware wallet accounts (Ledger, Trezor...): the vault only stores their addresses; the keys never left the
  device.

## Reporting a problem

Open an issue without including any vault, file or secret. For a vulnerability, contact the maintainers privately
first.
