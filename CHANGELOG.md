# Changelog

## 0.3.0 - 2026-10-28

- Renamed to Vault Recovery for MetaMask (`vault-recovery-for-metamask`), with a notice that the project is not
  affiliated with MetaMask or Consensys.
- README section on avoiding scams, `SECURITY.md` with private vulnerability reporting, and an issue template that
  warns against sharing secrets. `SECURITY.md` ships with the release.
- `docs/releasing.md`: how maintainers publish and sign a release.
- Commits and tags are signed with SSH; `.github/allowed_signers` holds the key to verify them.

## 0.2.0 - 2026-10-28

- The web page only works while the computer is disconnected from every network: it starts locked when the browser
  reports a connection, and drops everything it holds if a connection appears.
- Documentation covers any recovery scenario, operating system and disk encryption, and links to the projects and
  standards it relies on.

## 0.1.0 - 2026-10-28

First release.

- `vault-recovery.html`: single-file web page that finds, decrypts and lists the vaults in the files you choose.
  Its Content Security Policy blocks every network request.
- `vault-recovery.mjs`: the same as a command-line tool, with its dependencies bundled. Needs Node.js 26.12.1 or
  later.
- `find-metamask.sh` and `find-metamask.ps1`: find MetaMask's data folders on a disk and copy them with a
  `SHA256SUMS` manifest.
- Reads LevelDB `.log` and `.ldb` files properly (records, blocks, Snappy), so every stored copy of the vault is
  found: `storage.local` in the `data` and split-state formats, and the `metamask-backup` IndexedDB copy.
- Derives the addresses of the HD accounts and of imported private keys.
- Reproducible release with `SHA256SUMS`, checked by `scripts/verify-release.js`.
