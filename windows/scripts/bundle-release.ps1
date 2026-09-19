$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$output = if ($env:QUOTABAR_PACKAGE_OUT) { $env:QUOTABAR_PACKAGE_OUT } else { Join-Path $root 'out' }
$version = if ($env:VERSION) { $env:VERSION -replace '^(windows-)?v', '' } else { (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version }
$installer = Join-Path $output "QuotaBar-$version-Setup-x64.exe"
if (-not (Test-Path $installer)) { throw 'Build the installer before bundling a release' }
$zip = Join-Path $output "QuotaBar-$version-win32-x64.zip"
Compress-Archive -Path (Join-Path $output 'QuotaBar-win32-x64/*') -DestinationPath $zip -Force
@($installer, $zip) | ForEach-Object {
    $hash = (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLower()
    "$hash  $([IO.Path]::GetFileName($_))"
} | Set-Content -Encoding ascii (Join-Path $output 'SHA256SUMS.txt')
