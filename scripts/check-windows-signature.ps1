# Inspect Authenticode signature and Mark of the Web on Windows POS binaries.
# Usage:
#   npm run verify:win-sign
#   powershell -NoProfile -File scripts/check-windows-signature.ps1 -Path "release\RestoNiti Setup 0.6.0.exe"
#   powershell -NoProfile -File scripts/check-windows-signature.ps1 -Unblock

param(
  [string]$Path,
  [switch]$Unblock
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

function Resolve-DefaultTargets {
  $releaseDir = Join-Path $root "release"
  $targets = @()
  if (Test-Path $releaseDir) {
    $setup = Get-ChildItem -LiteralPath $releaseDir -Filter "RestoNiti Setup *.exe" -File -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if ($setup) {
      $targets += $setup.FullName
    }
    $unpacked = Join-Path $releaseDir "win-unpacked\RestoNiti.exe"
    if (Test-Path $unpacked) {
      $targets += $unpacked
    }
    $elevate = Join-Path $releaseDir "win-unpacked\resources\elevate.exe"
    if (Test-Path $elevate) {
      $targets += $elevate
    }
  }
  return $targets
}

$files = @()
if ($Path) {
  $files = @(Resolve-Path -LiteralPath $Path)
} else {
  $files = Resolve-DefaultTargets
}

if (-not $files -or $files.Count -eq 0) {
  Write-Error "No EXE found. Pass -Path or build the installer first (release\RestoNiti Setup *.exe)."
}

$unsigned = 0
foreach ($file in $files) {
  $fullName = [string]$file
  Write-Host ""
  Write-Host "=== $fullName ==="
  $item = Get-Item -LiteralPath $fullName
  Write-Host ("Size: {0:N0} bytes  Modified: {1}" -f $item.Length, $item.LastWriteTime)

  $hasMotw = $false
  try {
    Get-Item -LiteralPath $fullName -Stream Zone.Identifier -ErrorAction Stop | Out-Null
    $hasMotw = $true
  } catch {
    $hasMotw = $false
  }

  if ($hasMotw) {
    Write-Host "Mark of the Web: PRESENT (Windows treats this as an untrusted download)"
    Get-Content -LiteralPath $fullName -Stream Zone.Identifier
    if ($Unblock) {
      Unblock-File -LiteralPath $fullName
      Write-Host "Unblocked Mark of the Web."
    }
  } else {
    Write-Host "Mark of the Web: none"
  }

  $sig = Get-AuthenticodeSignature -LiteralPath $fullName
  Write-Host "Signature status: $($sig.Status)"
  if ($sig.SignerCertificate) {
    Write-Host "Signer: $($sig.SignerCertificate.Subject)"
    Write-Host "Thumbprint: $($sig.SignerCertificate.Thumbprint)"
    Write-Host "Not after: $($sig.SignerCertificate.NotAfter)"
  } else {
    Write-Host "Signer: (none - unsigned)"
    $unsigned += 1
  }
}

Write-Host ""
if ($unsigned -gt 0) {
  Write-Host "RESULT: $unsigned unsigned file(s). Windows Security/SmartScreen will warn or block these."
  Write-Host "Fix: set WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD on the build machine, then rebuild."
  exit 1
}

Write-Host "RESULT: all checked files are signed."
exit 0
