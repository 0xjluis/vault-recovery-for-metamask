# Changelog

## 0.3.1 - 2026-10-29

Security fixes from an audit of 0.3.0. Update if you use 0.3.0: with it, a crafted file could show a fake recovery
phrase as if it came from your vault.

- Text from the files is no longer shown as it is. Error messages do not quote the vault's `keyMetadata`, and the
  command line and the kit show control characters, line breaks and bidi overrides as `?`: a crafted vault could
  print a fake second vault with another phrase, or write to the clipboard.
- Vaults found outside MetaMask's `KeyringController` state, such as text that a website wrote into the profile
  (tab titles, NFT names, `localStorage`), are marked "Not where MetaMask keeps its vault" and listed last. The
  page and the command line ask for MetaMask's folders, not the whole profile.
- Every file is also scanned as raw bytes, so vaults in damaged records are no longer missed.
- A crafted file can no longer block the search for hours, make the table reader decompress gigabytes, or crash
  it with hundreds of thousands of copies. The iteration limit goes down to 2 million.
- The command line no longer follows links inside folders, reads only regular files, and reports what it skips
  instead of stopping. The kit reports the folders it cannot read, and copies regular files only, never through
  junctions or symbolic links.
- The page clears everything when new files are chosen, and a damaged keyring no longer hides the others.
- `--json` includes the encrypted vault only with `--show-secrets`.
- The documents name the official repository and the signing key, check for files added to a release, and put
  verifying the release before running the kit. Releases now ship `SHA256SUMS.sig`, an SSH signature checked with
  `ssh-keygen -Y verify`.
- The offline audit is described as the heuristic it is, and catches more ways to hide network access; the test
  network blocker covers UDP and every DNS query.

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
