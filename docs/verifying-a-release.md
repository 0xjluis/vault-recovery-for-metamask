# Verifying a release

Check a release **before** you use it, ideally on the computer where you will use it. There are three levels; the
first two need no tools beyond the operating system.

## 1. The files match SHA256SUMS

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

## 2. SHA256SUMS is the published one

Step 1 only shows that the files match the list that came with them. Someone who changes a file can change the list
too. So compare the SHA-256 of `SHA256SUMS` itself with the value published with the release (release notes and
the annotated git tag):

```bash
sha256sum SHA256SUMS
```

```powershell
Get-FileHash SHA256SUMS -Algorithm SHA256
```

Get the published value from a different channel than the download if you can, for example the repository page
and the tag message (`git show v0.1.0`).

## 3. The release is built from the source (reproducible build)

This proves the files contain exactly the code in the repository at that tag, nothing added. It needs git,
Node.js 26 LTS and pnpm 12.14.0:

```bash
git clone <repository url> metamask-vault-recovery
```

```bash
cd metamask-vault-recovery
```

```bash
git checkout v0.1.0
```

```bash
pnpm install --frozen-lockfile
```

```bash
pnpm verify-release <path to the downloaded release folder>
```

`verify-release`:

1. Checks every file against `SHA256SUMS`, and that no file is missing or added.
2. Runs the offline audit: the page's Content Security Policy blocks all requests and its hashes match its code, the
   CLI imports no network module and calls no network API, the kit scripts use no download command.
3. Rebuilds the whole release from the checkout in a temporary folder and compares every file.

It ends with `Release verified.` only if the three pass. It also prints the SHA-256 of `SHA256SUMS`, to compare
with the published value (level 2).

`BUILD-INFO.txt` shows the commit, the lockfile hash and the esbuild version used: if the rebuild differs, check
that your checkout is at that commit and that `pnpm install --frozen-lockfile` succeeded.

## Reading the code

The release files are not minified. `vault-recovery.mjs` and the script inside `vault-recovery.html` start each
module with a `// path` comment that points to its source file, so they can be compared with the repository.
