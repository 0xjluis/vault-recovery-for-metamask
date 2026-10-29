#!/usr/bin/env bash
# find-metamask.sh - Finds MetaMask's data folders on a disk and copies them.
#
# Searches Chromium-based browser profiles (Chrome, Brave, Edge, Chromium...) under
# <search-root> for:
#   .../Local Extension Settings/<id>                        (storage.local: the vault)
#   .../IndexedDB/chrome-extension_<id>_0.indexeddb.leveldb  (metamask-backup copy)
# with <id> = nkbihfbeogaeaoehlefnkodbefgpgknn (Chrome Web Store build)
#          or ejbalbakoplchlghecdalmeeeajnimhm (Edge Add-ons build).
#
# It only reads the source (find, cp and a SHA-256 tool) and never uses the network.
# Mount the source disk read-only anyway, e.g.: sudo mount -o ro /dev/sdX2 /mnt/disk
#
# Usage:
#   find-metamask.sh <search-root>                 List the folders found
#   find-metamask.sh <search-root> <destination>   Copy them to <destination>/metamask-data-<time>/
#                                                  with a SHA256SUMS file of the source files,
#                                                  then check the copy against it

set -euo pipefail

IDS=(nkbihfbeogaeaoehlefnkodbefgpgknn ejbalbakoplchlghecdalmeeeajnimhm)

# Prints the comment block above, up to the first line that is not a comment
usage() {
  awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"
  exit "${1:-0}"
}

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ] || [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
  usage $(( $# == 1 ? 0 : 1 ))
fi

root=${1%/}
dest=${2:-}
if [ ! -d "$root" ]; then
  echo "Not a folder: $root" >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  sha256() { sha256sum "$@"; }
elif command -v shasum >/dev/null 2>&1; then
  sha256() { shasum -a 256 "$@"; }
else
  echo "No SHA-256 tool found (sha256sum or shasum)" >&2
  exit 1
fi

# find predicate: any of the MetaMask folders, without descending into them
predicate=()
for id in "${IDS[@]}"; do
  predicate+=(-path "*/Local Extension Settings/$id" -o -path "*/IndexedDB/chrome-extension_${id}_0.indexeddb.leveldb" -o)
done
unset 'predicate[${#predicate[@]}-1]'

echo "Searching $root (this can take a few minutes on a whole disk)..." >&2
found=()
while IFS= read -r -d '' dir; do
  found+=("$dir")
done < <(find "$root" -type d \( "${predicate[@]}" \) -prune -print0 2>/dev/null || true)

if [ "${#found[@]}" -eq 0 ]; then
  echo "No MetaMask folders found under $root" >&2
  exit 1
fi

echo "Found ${#found[@]} MetaMask folder(s):"
for dir in "${found[@]}"; do
  files=$(find "$dir" -type f | wc -l | tr -d ' ')
  size=$(du -sh "$dir" 2>/dev/null | cut -f1)
  # Folder names can hold terminal escape sequences: show control characters as '?'
  name=$(printf '%s' "${dir#"$root"/}" | LC_ALL=C tr '[:cntrl:]' '?')
  echo "  $name  ($files files, $size)"
done

if [ -z "$dest" ]; then
  echo "Run again with a destination folder to copy them."
  exit 0
fi

out="$dest/metamask-data-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$out"

for dir in "${found[@]}"; do
  rel=${dir#"$root"/}
  mkdir -p "$out/$(dirname "$rel")"
  cp -R "$dir" "$out/$(dirname "$rel")/"
done

# Checksums of the SOURCE files, with the paths they have in the copy
(
  for dir in "${found[@]}"; do
    rel=${dir#"$root"/}
    find "$dir" -type f -print0 | while IFS= read -r -d '' file; do
      # Read from stdin: sha256sum escapes names that contain a backslash
      hash=$(sha256 < "$file" | cut -d' ' -f1)
      printf '%s  ./%s\n' "$hash" "$rel${file#"$dir"}"
    done
  done
) | LC_ALL=C sort -k2 > "$out/SHA256SUMS"

echo "Copied to $out"
if (cd "$out" && sha256 -c SHA256SUMS >/dev/null); then
  echo "Copy verified: every file matches its source (SHA256SUMS)."
else
  echo "WARNING: the copy does not match the source, see: (cd \"$out\" && sha256sum -c SHA256SUMS)" >&2
  exit 2
fi
