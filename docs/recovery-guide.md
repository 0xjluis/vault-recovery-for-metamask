# Recovery guide

How to get MetaMask's data out of a browser profile and decrypt it. The steps are the same whatever went wrong;
only the way you reach the files changes.

## What you need

- The **MetaMask password** used in that browser profile. Each profile, and each reinstall, can have its own.
- A **verified release** of this tool ([verifying-a-release.md](verifying-a-release.md)).
- A place to copy the data to, such as a USB stick.
- A computer that you can **disconnect from every network** to decrypt.

Work on a copy, never on the original disk, and keep the original read-only: a damaged disk can get worse with
every write.

## 1. Reach the browser profile

### Where profiles are

A Chromium browser keeps one folder per profile (`Default`, `Profile 1`, `Profile 2`...) inside its user data
folder:

| Browser | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Chrome | `%LOCALAPPDATA%\Google\Chrome\User Data\` | `~/Library/Application Support/Google/Chrome/` | `~/.config/google-chrome/` |
| Brave | `%LOCALAPPDATA%\BraveSoftware\Brave-Browser\User Data\` | `~/Library/Application Support/BraveSoftware/Brave-Browser/` | `~/.config/BraveSoftware/Brave-Browser/` |
| Edge | `%LOCALAPPDATA%\Microsoft\Edge\User Data\` | `~/Library/Application Support/Microsoft Edge/` | `~/.config/microsoft-edge/` |
| Chromium | `%LOCALAPPDATA%\Chromium\User Data\` | `~/Library/Application Support/Chromium/` | `~/.config/chromium/` |

`%LOCALAPPDATA%` is `C:\Users\<user>\AppData\Local`. On a disk read from another system, look under `Users/<user>/`
(Windows, macOS) or `home/<user>/` (Linux). Other Chromium-based browsers follow the same layout under their own
folder; `find-metamask` finds them all by folder name.

### If the computer starts

Close the browser first (it keeps its database files locked and may write to them), disconnect the computer from
every network, then go to step 2 and run the kit on the user's home folder.

### If the computer does not start

Two options:

- **Start it from a live USB system**, which runs from the stick without touching the internal disk.
  [Tails](https://tails.net/) is designed to leave no trace and to work offline; any Linux live system works too,
  for example [Ubuntu](https://ubuntu.com/tutorials/try-ubuntu-before-you-install). In Tails, opening the internal
  disk needs an [administration password](https://tails.net/doc/first_steps/welcome_screen/administration_password/index.en.html)
  set in the Welcome Screen; see [Accessing the internal hard disk](https://tails.net/doc/advanced_topics/internal_hard_disk/index.en.html).
- **Move the disk to another computer**, with a USB adapter or enclosure for its type (SATA, NVMe).

### Encrypted disks

You need the disk's own key before anything else:

| Encryption | What unlocks it |
| --- | --- |
| BitLocker (Windows) | The recovery key: [Find your BitLocker recovery key](https://support.microsoft.com/en-us/windows/find-your-bitlocker-recovery-key-6b71ad27-0b89-ea08-f143-056f5ab347d6) |
| FileVault (macOS) | The user's login password or the recovery key: [FileVault](https://support.apple.com/guide/mac-help/protect-data-on-your-mac-with-filevault-mh11785/mac). Usually easiest from another Mac or macOS Recovery |
| LUKS (Linux) | The passphrase, with [cryptsetup](https://gitlab.com/cryptsetup/cryptsetup) |

### Mount read-only

On Linux, list the partitions with `lsblk -f`, then mount the one that holds the users' folders read-only, for
example:

```bash
sudo mkdir -p /mnt/disk
```

```bash
sudo mount -o ro /dev/sdX2 /mnt/disk
```

For a Windows (NTFS) partition use the [ntfs-3g](https://github.com/tuxera/ntfs-3g) driver, which also mounts
read-only a volume left hibernated by Windows' Fast Startup:

```bash
sudo mount -t ntfs-3g -o ro /dev/sdX2 /mnt/disk
```

Do not run repair tools (`ntfsfix`, `chkdsk`, `fsck`) before you have your copy: they write to the disk.

## 2. Find and copy MetaMask's data

Run the kit only from a release you have verified ([verifying-a-release.md](verifying-a-release.md)), with the
computer already disconnected: it needs no network, and a tampered kit would run with your user's rights.

The kit looks for MetaMask's two data folders in every profile under the folder you give it, and copies them:

| Folder | What it holds |
| --- | --- |
| `Local Extension Settings/<id>` | MetaMask's storage: the vault and its older copies |
| `IndexedDB/chrome-extension_<id>_0.indexeddb.leveldb` | The `metamask-backup` copy of the vault, in recent versions |

with `<id>` = `nkbihfbeogaeaoehlefnkodbefgpgknn` (Chrome Web Store build) or `ejbalbakoplchlghecdalmeeeajnimhm`
(Edge Add-ons build).

Linux, macOS and live systems:

```bash
bash find-metamask.sh /mnt/disk/Users
```

```bash
bash find-metamask.sh /mnt/disk/Users /media/<usb stick>
```

Windows:

```powershell
powershell -ExecutionPolicy Bypass -File find-metamask.ps1 -Root D:\Users
```

```powershell
powershell -ExecutionPolicy Bypass -File find-metamask.ps1 -Root D:\Users -Destination E:\
```

Without a destination the kit only lists what it finds. With one, it writes `metamask-data-<date>/`:

- the folders keep their original paths, so you can tell which user, browser and profile each comes from;
- `SHA256SUMS` lists the hash of every **source** file, and the kit checks the copy against it, so the copy is
  exact even from a failing disk.

Searching a whole disk takes a few minutes; start from the users' folder when you can. Copying by hand works too:
copy the two folders above for each profile.

## 3. Decrypt, offline

On a computer **disconnected from every network** (Wi-Fi off, cable unplugged, or airplane mode):

**Web page**: open `vault-recovery.html` in a current browser, click **Choose folder**, pick the copied folder,
type the password, click **Decrypt**. The page is locked while the browser reports a network connection, and if a
connection appears it clears everything it holds.

**Command line** ([Node.js](https://nodejs.org/) 26.12.1 or later):

```bash
node vault-recovery.mjs <copied folder>
```

Both tools:

- show every distinct vault and where each one was found: first those found where MetaMask keeps its vault, newest
  first, then those marked "Not where MetaMask keeps its vault" (damaged copies, or text a website wrote);
- ask for another password when some vaults do not open with the first one;
- show the addresses first; the secret recovery phrase and the private keys appear only when you tick **Show the
  secret recovery phrase and the private keys** in the page, or add `--show-secrets` to the command;
- mark older copies that hold the same accounts as "Same contents as vault N".

| Keyring shown | What it is | What to keep |
| --- | --- | --- |
| HD Key Tree | Accounts created in MetaMask | The secret recovery phrase |
| Simple Key Pair | Accounts imported with a private key | Each private key: the phrase does not restore them |
| Ledger, Trezor, QR, Snap... | Hardware or external accounts | Nothing: only addresses are in the vault |

## 4. Restore and clean up

1. Write the phrase and the imported private keys down, on paper or in a password manager.
2. In a fresh MetaMask, **Import an existing wallet** with the phrase, then **Add account > Import account** with
   each private key, and check that the addresses match.
3. Delete every copy of the data folders: with the password, they give access to everything.
4. If the secrets were shown on a computer you do not trust, create a new wallet and move the funds to it.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| The kit finds nothing | Search a wider folder (the whole disk), check the user and browser. Firefox keeps extension data in a different format that this tool does not read yet |
| The kit says some folders could not be read | On a disk from another computer, user folders belong to that computer's users. Run the kit as root (`sudo`) on Linux and macOS, or PowerShell as administrator on Windows; MetaMask's folders may be among those it could not search |
| The kit or the command line skip links | Links and junctions are not followed, so they cannot loop or lead to files outside the copy. MetaMask's own folders never contain them |
| A vault does not open with any password | It may come from another profile or an older installation with another password. Every vault is independent |
| Files are reported as "scanned as raw bytes" | They are damaged. Vaults are still searched in them, but some older copies may be lost |
| The page stays locked offline | The browser still reports a connection, often because of a virtual network adapter (VPN, virtual machines, WSL). Disable it, or use the command-line tool |
