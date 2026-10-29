# Security policy

## Reporting a vulnerability

Report vulnerabilities **privately**, through this repository's **Security** tab, **Report a vulnerability**
([how private reporting works](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)).
Do not open a public issue for them.

Useful reports include: a way for the page or the CLI to reach the network, to leak or store a secret, to run code
from a crafted file, or a release that does not match its source.

**Never include a real vault, browser files, a password, a recovery phrase or a private key** in a report. Build a
test case with a throwaway wallet instead (`test/helpers.js` shows how).

## Supported versions

Only the latest release receives fixes.

## The only official source

- Repository and releases: `https://github.com/0xjluis/vault-recovery-for-metamask`
- Signing key of commits, tags and `SHA256SUMS`: SSH Ed25519 `SHA256:lbz25JepdbVPhbBtAfT08husAFZMmw4VppPnnLsYMV4`

A copy of this project at any other address is not this project, even if its files and documents look the same:
[docs/verifying-a-release.md](docs/verifying-a-release.md) shows how to check a release.

## What the maintainers will never do

- Ask for your recovery phrase, private keys, password or vault files.
- Contact you first, or offer recovery help by direct message, e-mail or any other channel.
- Publish releases anywhere other than the Releases page of the repository above: not on npm, not in other
  repositories, not as downloads on other sites.

Anyone doing so is impersonating the project.

## Security model

How the tools avoid the network, handle secrets and can be verified: [docs/security.md](docs/security.md) and
[docs/verifying-a-release.md](docs/verifying-a-release.md).
