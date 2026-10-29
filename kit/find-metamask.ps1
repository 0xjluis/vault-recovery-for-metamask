<#
.SYNOPSIS
Finds MetaMask's data folders on a disk and copies them.

.DESCRIPTION
Searches Chromium-based browser profiles (Chrome, Brave, Edge, Chromium...) under -Root for:
  ...\Local Extension Settings\<id>                        (storage.local: the vault)
  ...\IndexedDB\chrome-extension_<id>_0.indexeddb.leveldb  (metamask-backup copy)
with <id> = nkbihfbeogaeaoehlefnkodbefgpgknn (Chrome Web Store build)
         or ejbalbakoplchlghecdalmeeeajnimhm (Edge Add-ons build).

Without -Destination it only lists the folders found. With -Destination it copies them to
<Destination>\metamask-data-<time>\ with a SHA256SUMS file computed from the SOURCE files,
then checks the copy against it. It only reads the source and never uses the network.
Works with Windows PowerShell 5.1 and PowerShell 7.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File find-metamask.ps1 -Root E:\Users

.EXAMPLE
powershell -ExecutionPolicy Bypass -File find-metamask.ps1 -Root E:\Users -Destination F:\
#>
param(
  [Parameter(Mandatory = $true)][string]$Root,
  [string]$Destination
)

$ErrorActionPreference = 'Stop'

$ids = @('nkbihfbeogaeaoehlefnkodbefgpgknn', 'ejbalbakoplchlghecdalmeeeajnimhm')
$indexedDbNames = $ids | ForEach-Object { "chrome-extension_$($_)_0.indexeddb.leveldb" }

$rootDir = Get-Item -LiteralPath $Root
if (-not $rootDir.PSIsContainer) {
  Write-Error "Not a folder: $Root"
}
$rootPath = $rootDir.FullName.TrimEnd('\')

function Get-RelativePath([string]$path) {
  return $path.Substring($rootPath.Length).TrimStart('\')
}

# Names can hold control characters and bidi overrides that fake the output
function Get-Printable([string]$text) {
  return $text -replace '[\x00-\x1f\x7f-\x9f\u200e\u200f\u202a-\u202e\u2066-\u2069]', '?'
}

# Folders that cannot be read are reported: on a disk from another computer, MetaMask's
# folders are often in a user folder that only its owner can read
$unreadable = New-Object System.Collections.Generic.List[string]

# Regular files under a MetaMask folder, without following junctions or symbolic links:
# they can loop, or point anywhere on this computer and copy its files to the destination
function Get-RegularFiles([System.IO.DirectoryInfo]$top) {
  $files = New-Object System.Collections.Generic.List[System.IO.FileInfo]
  $pending = New-Object System.Collections.Generic.Stack[System.IO.DirectoryInfo]
  $pending.Push($top)
  while ($pending.Count -gt 0) {
    $dir = $pending.Pop()
    try {
      $entries = $dir.GetFileSystemInfos()
    } catch {
      $unreadable.Add($dir.FullName)
      continue
    }
    foreach ($entry in $entries) {
      if ($entry.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        Write-Warning "Not copied, junction or symbolic link: $(Get-Printable (Get-RelativePath $entry.FullName))"
      } elseif ($entry -is [System.IO.DirectoryInfo]) {
        $pending.Push($entry)
      } else {
        $files.Add($entry)
      }
    }
  }
  return ,$files
}

Write-Host "Searching $rootPath (this can take a few minutes on a whole disk)..."
# Depth-first walk that skips junctions and symlinks: profiles contain junctions such as
# 'Application Data' that point to their own parent and would loop forever
$found = New-Object System.Collections.Generic.List[System.IO.DirectoryInfo]
$stack = New-Object System.Collections.Generic.Stack[System.IO.DirectoryInfo]
$stack.Push($rootDir)
while ($stack.Count -gt 0) {
  $dir = $stack.Pop()
  try {
    $children = $dir.GetDirectories()
  } catch {
    $unreadable.Add($dir.FullName)
    continue
  }
  foreach ($child in $children) {
    if ($child.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
      continue
    }
    $isStorage = $child.Parent.Name -eq 'Local Extension Settings' -and $ids -contains $child.Name
    $isBackup = $child.Parent.Name -eq 'IndexedDB' -and $indexedDbNames -contains $child.Name
    if ($isStorage -or $isBackup) {
      $found.Add($child)
    } else {
      $stack.Push($child)
    }
  }
}

$regularFiles = @{}
foreach ($dir in $found) {
  $regularFiles[$dir.FullName] = Get-RegularFiles $dir
}

if ($unreadable.Count -gt 0) {
  Write-Warning "$($unreadable.Count) folder(s) could not be read, and were not searched:"
  foreach ($path in ($unreadable | Select-Object -First 10)) {
    Write-Host "  $(Get-Printable $path)"
  }
  Write-Host 'Run PowerShell as administrator, or give your user access to those folders.'
}

if ($found.Count -eq 0) {
  Write-Host "No MetaMask folders found under $rootPath"
  exit 1
}

Write-Host "Found $($found.Count) MetaMask folder(s):"
foreach ($dir in $found) {
  $files = $regularFiles[$dir.FullName]
  $size = ($files | Measure-Object -Property Length -Sum).Sum
  Write-Host ("  {0}  ({1} files, {2:N0} KB)" -f (Get-Printable (Get-RelativePath $dir.FullName)), $files.Count, ($size / 1KB))
}

if (-not $Destination) {
  Write-Host 'Run again with -Destination to copy them.'
  exit 0
}

$out = Join-Path $Destination ("metamask-data-" + (Get-Date).ToUniversalTime().ToString("yyyyMMdd'T'HHmmss'Z'"))
New-Item -ItemType Directory -Path $out -Force | Out-Null

$sums = New-Object System.Collections.Generic.List[string]
foreach ($dir in $found) {
  # File by file, only the regular files found above
  foreach ($file in $regularFiles[$dir.FullName]) {
    $rel = Get-RelativePath $file.FullName
    $target = Join-Path $out $rel
    New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $target -Force
    # Checksums of the SOURCE files, with the paths they have in the copy
    $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $sums.Add("$hash  ./" + $rel.Replace('\', '/'))
  }
}

# Same format as sha256sum, sorted by path, UTF-8 without BOM and LF line endings
$sorted = $sums | Sort-Object { $_.Substring(66) } -CaseSensitive
$text = ($sorted -join "`n") + "`n"
[System.IO.File]::WriteAllText((Join-Path $out 'SHA256SUMS'), $text, (New-Object System.Text.UTF8Encoding $false))

Write-Host "Copied to $out"
$mismatches = 0
foreach ($line in $sorted) {
  $expected = $line.Substring(0, 64)
  $copy = Join-Path $out ($line.Substring(68).Replace('/', '\'))
  if (-not (Test-Path -LiteralPath $copy) -or (Get-FileHash -LiteralPath $copy -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
    Write-Warning "Does not match its source: $copy"
    $mismatches++
  }
}
if ($mismatches -gt 0) {
  exit 2
}
Write-Host 'Copy verified: every file matches its source (SHA256SUMS).'
