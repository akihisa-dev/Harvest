param(
  [Parameter(Mandatory = $true)][string]$SourceDirectory,
  [Parameter(Mandatory = $true)][string]$ArchivePath
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Test-Archive([string]$Path) {
  $archive = [System.IO.Compression.ZipFile]::OpenRead($Path)
  try {
    $manifestFound = $false
    foreach ($entry in $archive.Entries) {
      $name = $entry.FullName.Replace('\', '/')
      $normalized = $name.TrimEnd('/') -replace '^(?:\./)+', ''
      if (-not $normalized) { continue }
      if ($normalized.StartsWith('/') -or $normalized -match '^[A-Za-z]:' -or ($normalized -split '/') -contains '..' -or ($normalized -split '/') -contains '.') {
        throw "ZIP内に不正なパスがあります: $($entry.FullName)"
      }
      $leaf = ($normalized -split '/')[-1]
      if (@('.DS_Store', 'Thumbs.db', 'desktop.ini') -contains $leaf) {
        throw "ZIPにOSの管理ファイルが含まれています: $normalized"
      }
      if ($normalized -eq 'manifest.json') { $manifestFound = $true }
    }
    if (-not $manifestFound) { throw 'ZIPの最上位にmanifest.jsonがありません。' }
  }
  finally {
    $archive.Dispose()
  }
}

$sourcePath = [System.IO.Path]::GetFullPath($SourceDirectory)
$archivePath = [System.IO.Path]::GetFullPath($ArchivePath)
if (-not (Test-Path -LiteralPath $sourcePath -PathType Container)) {
  throw "拡張機能の出力先がありません: $sourcePath"
}

$archiveStream = [System.IO.File]::Open($archivePath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
$archive = $null
try {
  $archive = [System.IO.Compression.ZipArchive]::new($archiveStream, [System.IO.Compression.ZipArchiveMode]::Create, $false)
  $excludedNames = @('.DS_Store', 'Thumbs.db', 'desktop.ini')
  $excludedAttributes = [System.IO.FileAttributes]::Hidden -bor [System.IO.FileAttributes]::ReparsePoint
  $prefix = $sourcePath.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar

  foreach ($file in Get-ChildItem -LiteralPath $sourcePath -File -Force -Recurse) {
    if ($excludedNames -contains $file.Name) { continue }
    if (($file.Attributes -band $excludedAttributes) -ne 0) { continue }
    $relativePath = $file.FullName.Substring($prefix.Length).Replace('\', '/')
    $entry = $archive.CreateEntry($relativePath, [System.IO.Compression.CompressionLevel]::Optimal)
    $input = $null
    $output = $null
    try {
      $input = [System.IO.File]::OpenRead($file.FullName)
      $output = $entry.Open()
      $input.CopyTo($output)
    }
    finally {
      if ($output) { $output.Dispose() }
      if ($input) { $input.Dispose() }
    }
  }
}
finally {
  if ($archive) { $archive.Dispose() }
  else { $archiveStream.Dispose() }
}

Test-Archive $archivePath
