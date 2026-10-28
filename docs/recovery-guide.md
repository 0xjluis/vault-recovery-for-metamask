# Recovery guide

How to get your MetaMask accounts back from a computer that no longer starts, step by step. You need:

- The **MetaMask password** you used to unlock the extension on that computer.
- A **Tails** USB stick (or any Linux live USB), to start the broken computer.
- A **second USB stick** for the copy.
- A **release** of this tool, verified as explained in [verifying-a-release.md](verifying-a-release.md).

If the computer still starts, skip to [Step 3](#3-find-and-copy-metamasks-data) and run the kit from there.

## 1. Start the computer from Tails

1. Plug the Tails stick and choose it in the boot menu (usually F12, F11, F8 or Esc at power on).
2. In the Welcome Screen, under **Additional Settings** (`+`), set an **Administration Password**. Tails needs one to
   open the internal disk; it lasts only for this session.
3. In **Language & Region**, pick your keyboard layout.
4. Start Tails. You can leave the network off: nothing below needs it.

## 2. Mount the Windows disk read-only

Open a **Terminal** and list the partitions:

```bash
lsblk -f
```

The Windows partition is the large one with `ntfs` as FSTYPE, for example `nvme0n1p3` or `sda3`. If it shows
`BitLocker`, you need the BitLocker recovery key first (account.microsoft.com/devices/recoverykey).

Mount it read-only (change `nvme0n1p3` to your partition):

```bash
sudo mkdir -p /mnt/win
```

```bash
sudo mount -t ntfs-3g -o ro,uid=1000,gid=1000 /dev/nvme0n1p3 /mnt/win
```

`ro` means nothing on the disk can change. If Windows was hibernated or used Fast Startup, a read-only mount still
works. Do not run `ntfsfix` or delete `hiberfil.sys`: both write to the disk.

## 3. Find and copy MetaMask's data

Copy the release folder to the Tails session (for example to `~/Tor Browser/`) and plug the second USB stick; it
appears under `/media/amnesia/<name>`.

List what the kit finds (this can take a few minutes):

```bash
bash find-metamask.sh /mnt/win/Users
```

Then copy it to the USB stick:

```bash
bash find-metamask.sh /mnt/win/Users /media/amnesia/<name>
```

The kit copies, for every browser profile that had MetaMask (Chrome, Brave, Edge, Chromium...):

| Folder | What it holds |
| --- | --- |
| `Local Extension Settings/<id>` | MetaMask's storage, with the vault and its older copies |
| `IndexedDB/chrome-extension_<id>_0.indexeddb.leveldb` | The `metamask-backup` copy of the vault, in recent versions |

It writes them to `metamask-data-<date>/` keeping their original paths, so you can tell which user, browser and
profile each one comes from. `SHA256SUMS` in that folder holds the hash of every **source** file, and the kit checks
that the copy matches: the copy is exact even if the disk is failing.

On Windows (the disk plugged into another computer), the same with PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File find-metamask.ps1 -Root E:\Users -Destination F:\
```

## 4. Decrypt, offline

Use a computer that is **disconnected from the internet**: the Tails session itself, or another one.

**With the web page**: open `vault-recovery.html` in Chrome, Edge, Brave or Firefox, click **Choose folder**, pick
`metamask-data-<date>`, type the password, click **Decrypt**.

- In Tails, Tor Browser can only open files inside `~/Tor Browser/`: copy the release and the `metamask-data`
  folder there first. This combination has not been tested yet; if the page does not load, use another computer.

**With the command line** (Node.js 26.12.1 or later):

```bash
node vault-recovery.mjs metamask-data-<date>
```

Both tools:

- Show every distinct vault found, newest first, and where each one was found.
- Ask for another password when some vaults do not open with the first one (each profile can have its own).
- Show the addresses first. The secret recovery phrase and the private keys appear only when you tick
  **Show the secret recovery phrase and the private keys** in the page, or add `--show-secrets` to the command.
- Group older copies that hold the same accounts as "Same contents as vault N".

Accounts of type **Simple Key Pair** are the ones imported with a private key: the recovery phrase does not bring
them back, so write their private keys down.

## 5. Finish

1. Write the phrase and the imported private keys on paper or in a password manager.
2. In a fresh MetaMask, **Import an existing wallet** with the phrase, then **Add account > Import account** with
   each private key. Check that the addresses match.
3. Delete `metamask-data-<date>` from the USB stick, and from any other place you copied it to: with the password,
   it gives access to everything.
4. If the phrase or keys were shown on a computer you do not trust, create a new wallet and move the funds.

## If nothing is found

- The kit finds no folder: search a wider root (`/mnt/win` instead of `/mnt/win/Users`), and check the browser.
  Firefox keeps extension data in a different format that this tool does not read yet.
- A vault is found but no password opens it: it may come from another profile or an older installation with
  another password. Every vault is independent; try the passwords you may have used.
- The page or CLI reports files "scanned as raw bytes": those files are damaged. Vaults are still searched in them,
  but older copies may be lost.
