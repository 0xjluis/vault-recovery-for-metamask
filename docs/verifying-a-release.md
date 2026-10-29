# Verifying a release

Check a release **before** you use it, and before you run the kit: a modified copy can send your files or your
password anywhere as soon as it runs. Do it on the computer where you will use it. There are three levels; the first
two need no tools beyond the operating system.

## The only official source

| What | Value |
| --- | --- |
| Repository and releases | `https://github.com/0xjluis/vault-recovery-for-metamask` |
| Maintainer's signing key (SSH, Ed25519) | `SHA256:lbz25JepdbVPhbBtAfT08husAFZMmw4VppPnnLsYMV4` |

If you downloaded the release from any other address, it is a copy: do not use it, even if it looks the same.

A copy can change this page too, so do not trust these values only because they are written here. Compare them with
a source that a copy cannot change: the maintainer's GitHub account lists its signing keys at
`https://api.github.com/users/0xjluis/ssh_signing_keys`, and GitHub marks the signed commits and tags of the official
repository as **Verified**.

## 1. The files match SHA256SUMS, and nothing was added

Inside the release folder:

**Linux, Tails**

```bash
sha256sum -c SHA256SUMS
```

**macOS**

```bash
shasum -a 256 -c SHA256SUMS
```

**Windows PowerShell**

```powershell
Get-Content SHA256SUMS | ForEach-Object { $hash, $path = $_ -split '  ', 2; if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $hash) { "FAILED: $path" } else { "OK: $path" } }
```

Every line must say `OK`. Any `FAILED`, or a file that is missing, means the release was modified or damaged: do not
use it.

These commands only check the files listed in `SHA256SUMS`. Check also that the folder has no other file; each
command must print nothing:

**Linux, Tails, macOS**

```bash
find . -type f ! -name SHA256SUMS ! -name SHA256SUMS.sig | cut -c3- | sort | comm -23 - <(cut -c67- SHA256SUMS | sort)
```

**Windows PowerShell**

```powershell
$listed = Get-Content SHA256SUMS | ForEach-Object { ($_ -split '  ', 2)[1] }; Get-ChildItem -Recurse -File -Force | ForEach-Object { (Resolve-Path -Relative $_.FullName).Substring(2).Replace('\', '/') } | Where-Object { $_ -notin @($listed) + @('SHA256SUMS', 'SHA256SUMS.sig') } | ForEach-Object { "NOT LISTED: $_" }
```

Never open a file that is not listed, whatever its name says (`START-HERE.html`, `README-FIRST`...).

## 2. SHA256SUMS is the published one

Step 1 only shows that the files match the list that came with them. Someone who changes a file can change the list
too. So check that the list itself comes from the maintainer.

### With the signature (releases with a `SHA256SUMS.sig` file)

`SHA256SUMS.sig` is an SSH signature of `SHA256SUMS`. `ssh-keygen` checks it; it comes with OpenSSH 8.1 or later, on
Linux, macOS and Windows (`ssh -V` shows the version).

Write the maintainer's public key to a file next to the release folder (not inside it):

**Linux, Tails, macOS**

```bash
echo '27089707+0xjluis@users.noreply.github.com namespaces="file" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILzArQIJ54lyraHcTHAq+PAmaPGsxdYGD0Iu8ie6B+QX' > ../allowed_signers
```

```bash
ssh-keygen -Y verify -f ../allowed_signers -I 27089707+0xjluis@users.noreply.github.com -n file -s SHA256SUMS.sig < SHA256SUMS
```

**Windows PowerShell**

```powershell
Set-Content ..\allowed_signers '27089707+0xjluis@users.noreply.github.com namespaces="file" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILzArQIJ54lyraHcTHAq+PAmaPGsxdYGD0Iu8ie6B+QX' -Encoding ascii
```

```powershell
cmd /c "ssh-keygen -Y verify -f ..\allowed_signers -I 27089707+0xjluis@users.noreply.github.com -n file -s SHA256SUMS.sig < SHA256SUMS"
```

It must print `Good "file" signature for 27089707+0xjluis@users.noreply.github.com with ED25519 key
SHA256:lbz25JepdbVPhbBtAfT08husAFZMmw4VppPnnLsYMV4`, with exactly that key, the one in
[The only official source](#the-only-official-source). Anything else, such as `Could not verify signature`, means the
list was not signed by the maintainer: do not use the release.

### With the published hash

Compare the SHA-256 of `SHA256SUMS` with the value published with the release (release notes and the annotated git
tag):

```bash
sha256sum SHA256SUMS
```

```powershell
Get-FileHash SHA256SUMS -Algorithm SHA256
```

The release notes are on the same page as the download, so whoever replaces the files can replace them too. Get the
value from another channel if you can, for example the signed tag (`git show v<version>`, for example
`git show v0.3.0`).

Tags and commits are signed with the maintainer's SSH key. Check the tag's signature from a clone of the repository:

```bash
git -c gpg.ssh.allowedSignersFile=.github/allowed_signers tag -v v<version>
```

It must print `Good "git" signature for 27089707+0xjluis@users.noreply.github.com with ED25519 key
SHA256:lbz25JepdbVPhbBtAfT08husAFZMmw4VppPnnLsYMV4`. `.github/allowed_signers` comes from the clone itself, so this
only means something if you cloned the official repository and the key is the one above.

## 3. The release is built from the source (reproducible build)

This proves the files contain exactly the code in the repository at that tag, nothing added. It needs git,
[Node.js](https://nodejs.org/) 26 LTS and [pnpm](https://pnpm.io/) 12.14.0. Node.js publishes signed checksums of its
downloads; the keys are in [nodejs/release-keys](https://github.com/nodejs/release-keys).

Clone the official repository, at exactly this address: `verify-release` comes from the clone, and a copy's own
`verify-release` would approve a copy.

```bash
git clone https://github.com/0xjluis/vault-recovery-for-metamask.git vault-recovery-for-metamask
```

```bash
cd vault-recovery-for-metamask
```

```bash
git checkout v<version>
```

```bash
pnpm install --frozen-lockfile
```

```bash
pnpm verify-release <path to the downloaded release folder>
```

`verify-release`:

1. Checks every file against `SHA256SUMS`, and that no file is missing or added (`SHA256SUMS.sig` aside).
2. Runs the offline audit, a heuristic check of the code: the page's Content Security Policy blocks all requests and
   its hashes match its code, the CLI imports only allowed modules and uses no known network API, the kit scripts use
   no known download command. It catches mistakes and plain additions, not code written to hide from it: the
   rebuild below is what proves the files are the reviewed source.
3. Rebuilds the whole release from the checkout in a temporary folder and compares every file.

It ends with `Release verified.` only if the three pass. It also prints the SHA-256 of `SHA256SUMS`, to compare
with the published value (level 2).

`BUILD-INFO.txt` shows the commit, the lockfile hash and the esbuild version used: if the rebuild differs, check
that your checkout is at that commit and that `pnpm install --frozen-lockfile` succeeded.

## Reading the code

The release files are not minified. `vault-recovery.mjs` and the script inside `vault-recovery.html` start each
module with a `// path` comment that points to its source file, so they can be compared with the repository.
