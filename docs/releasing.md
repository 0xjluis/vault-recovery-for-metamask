# Releasing

Steps for maintainers. The goal: anyone can check that a published release is exactly what this repository builds.

## Before the first release

Account and repository settings on GitHub:

- [Two-factor authentication](https://docs.github.com/en/authentication/securing-your-account-with-two-factor-authentication-2fa)
  on every maintainer account.
- A private commit e-mail ([setting your commit email address](https://docs.github.com/en/account-and-profile/how-tos/email-preferences/setting-your-commit-email-address)).
- A signing key for tags and commits
  ([commit signature verification](https://docs.github.com/en/authentication/managing-commit-signature-verification)),
  added to the GitHub account as a signing key and listed in `.github/allowed_signers` as
  `<commit e-mail> namespaces="git" <public key>`, so that anyone can run `git tag -v` and `git verify-commit`.
- [Private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/working-with-repository-security-advisories/configuring-private-vulnerability-reporting-for-a-repository)
  enabled, as `SECURITY.md` points to it.
- A [ruleset](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)
  on `main` and on `v*` tags: no force pushes, no deletions, signed commits required.

## Making a release

1. Update `version` in `package.json` and `VERSION` in `src/version.js` (a test checks they match), and add the
   version's section to `CHANGELOG.md`.
2. Commit, with the working tree clean.
3. Build the release; it refuses to run with uncommitted changes:

   ```bash
   pnpm release
   ```

   It prints `SHA256SUMS` and its SHA-256.

4. Verify it from a fresh clone, not from the working copy:

   ```bash
   git clone https://github.com/0xjluis/vault-recovery-for-metamask.git /tmp/verify && cd /tmp/verify && pnpm install --frozen-lockfile && pnpm verify-release <path to release/vault-recovery-for-metamask-v<version>>
   ```

5. Sign `SHA256SUMS` with the same SSH key that signs the tags, inside the release folder. It writes
   `SHA256SUMS.sig`, which users check with `ssh-keygen -Y verify` without git or a clone
   ([verifying-a-release.md](verifying-a-release.md#with-the-signature-releases-with-a-sha256sumssig-file)):

   ```bash
   ssh-keygen -Y sign -f <signing key> -n file SHA256SUMS
   ```

   ```bash
   echo '27089707+0xjluis@users.noreply.github.com namespaces="file" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILzArQIJ54lyraHcTHAq+PAmaPGsxdYGD0Iu8ie6B+QX' > ../allowed_signers && ssh-keygen -Y verify -f ../allowed_signers -I 27089707+0xjluis@users.noreply.github.com -n file -s SHA256SUMS.sig < SHA256SUMS
   ```

6. Create a **signed** annotated tag whose message holds the SHA-256 of `SHA256SUMS` and the list itself:

   ```bash
   git tag -s v<version> -F <file with the message>
   ```

   ([signing tags](https://docs.github.com/en/authentication/managing-commit-signature-verification/signing-tags)),
   then check it:

   ```bash
   git -c gpg.ssh.allowedSignersFile=.github/allowed_signers tag -v v<version>
   ```

7. Push `main` and the tag.
8. Create the GitHub release from the tag
   ([managing releases](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)):
   attach every file of the release folder (`docs/` files and `SHA256SUMS.sig` included) and paste the SHA-256 of
   `SHA256SUMS` in the notes.
9. Publish the same SHA-256 in at least one other channel, so that a replaced release page can be noticed. The
   repository address and the key fingerprint (`SHA256:lbz25JepdbVPhbBtAfT08husAFZMmw4VppPnnLsYMV4`) belong in a
   channel that copies of the repository cannot change too, such as the maintainer's GitHub profile.

Never edit or re-upload the files of a published release: make a new version instead.
