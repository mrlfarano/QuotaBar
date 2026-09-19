$ErrorActionPreference = 'Stop'
$testId = 'QuotaBarInstallerTest-' + [guid]::NewGuid().ToString('N')
$testRoot = Join-Path ([IO.Path]::GetTempPath()) $testId
$installDir = Join-Path $testRoot 'Installed App'
$registration = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\${testId}_is1"
$startup = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) "$testId.lnk"
$desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) "$testId.lnk"
$savedVersion = $env:VERSION
$savedOutput = $env:QUOTABAR_INSTALLER_OUT
$savedId = $env:QUOTABAR_INSTALLER_TEST_ID
$version = if ($savedVersion) { $savedVersion -replace '^(windows-)?v', '' } else { (Get-Content (Join-Path $PSScriptRoot '../package.json') -Raw | ConvertFrom-Json).version }
$sourceRoot = if ($env:QUOTABAR_PACKAGE_OUT) { $env:QUOTABAR_PACKAGE_OUT } else { Join-Path $PSScriptRoot '../out' }
$expectedHash = (Get-FileHash (Join-Path $sourceRoot 'QuotaBar-win32-x64/resources/app.asar')).Hash

function Assert-True($Value, $Message) { if (-not $Value) { throw $Message } }
function Run-Setup($File, $Arguments) {
    $run = Start-Process -FilePath $File -ArgumentList $Arguments -WindowStyle Hidden -Wait -PassThru
    Assert-True ($run.ExitCode -eq 0) "Installer exited $($run.ExitCode)"
}
function Build-TestInstaller($BuildVersion) {
    $env:VERSION = $BuildVersion
    node (Join-Path $PSScriptRoot 'package-installer.js')
    Assert-True ($LASTEXITCODE -eq 0) 'Test installer compilation failed'
}

New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
try {
    $env:QUOTABAR_INSTALLER_TEST_ID = $testId
    $env:QUOTABAR_INSTALLER_OUT = $testRoot
    Build-TestInstaller '0.0.0'
    $common = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', ('/DIR="' + $installDir + '"'), '/TASKS=desktopicon')
    Run-Setup (Join-Path $testRoot 'QuotaBar-0.0.0-Setup-x64.exe') $common
    $installed = Join-Path $installDir 'QuotaBar.exe'
    Assert-True (Test-Path $installed) 'Executable missing after installation'
    Assert-True ((Get-ItemProperty $registration).DisplayVersion -eq '0.0.0') 'Uninstall registration missing'
    Assert-True ((Get-FileHash (Join-Path $installDir 'resources/app.asar')).Hash -eq $expectedHash) 'Installed payload differs'
    $link = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut)
    Assert-True ($link.TargetPath -eq $installed -and $link.Arguments -eq '--panel') 'Start menu shortcut incorrect'
    Assert-True (Test-Path $desktop) 'Optional desktop shortcut missing'
    $fixture = (Resolve-Path (Join-Path $PSScriptRoot '../../testdata/codex-pro-weekly.json')).Path
    $output = & $installed --parse-codex $fixture
    Assert-True ($LASTEXITCODE -eq 0 -and "$output" -match 'codex-weekly=10%') 'Installed application failed offline check'
    Write-Output 'PASS: per-user install, payload, shortcuts, registration, installed executable'

    $sentinel = Join-Path $installDir 'user-file.txt'
    Set-Content -LiteralPath $sentinel -Value 'preserve me'
    Set-Content -LiteralPath (Join-Path $installDir 'resources/app.asar') -Value 'replace during upgrade'
    Build-TestInstaller $version
    Run-Setup (Join-Path $testRoot "QuotaBar-$version-Setup-x64.exe") $common
    Assert-True ((Get-ItemProperty $registration).DisplayVersion -eq $version) 'Upgrade version incorrect'
    Assert-True ((Get-FileHash (Join-Path $installDir 'resources/app.asar')).Hash -eq $expectedHash) 'Upgrade failed to replace payload'
    Assert-True ((Get-Content $sentinel) -eq 'preserve me') 'Upgrade removed a user file'
    Write-Output 'PASS: in-place version upgrade and user-file preservation'

    New-Item -Path $startup -Force | Out-Null
    New-ItemProperty -Path $startup -Name $testId -Value ('"' + $installed + '"') -PropertyType String -Force | Out-Null
    Run-Setup (Join-Path $installDir 'unins000.exe') @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART')
    Assert-True (-not (Test-Path $installed)) 'Uninstall left executable'
    Assert-True (-not (Test-Path $registration)) 'Uninstall left registration'
    Assert-True (-not (Test-Path $shortcut) -and -not (Test-Path $desktop)) 'Uninstall left shortcuts'
    Assert-True ($null -eq (Get-ItemProperty $startup).PSObject.Properties[$testId]) 'Uninstall left its startup entry'
    Assert-True ((Get-Content $sentinel) -eq 'preserve me') 'Uninstall removed a user file'
    Write-Output 'PASS: uninstall removes installed files, shortcuts, registration, and owned startup entry'

    Run-Setup (Join-Path $testRoot "QuotaBar-$version-Setup-x64.exe") $common
    New-ItemProperty -Path $startup -Name $testId -Value '"C:\Other\QuotaBar.exe"' -PropertyType String -Force | Out-Null
    Run-Setup (Join-Path $installDir 'unins000.exe') @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART')
    Assert-True ((Get-ItemProperty $startup).PSObject.Properties[$testId].Value -eq '"C:\Other\QuotaBar.exe"') 'Uninstall changed another installation startup entry'
    Write-Output 'PASS: uninstall preserves another installation startup entry'
} finally {
    $env:VERSION = $savedVersion
    $env:QUOTABAR_INSTALLER_OUT = $savedOutput
    $env:QUOTABAR_INSTALLER_TEST_ID = $savedId
    $uninstaller = Join-Path $installDir 'unins000.exe'
    if (Test-Path $uninstaller) { Run-Setup $uninstaller @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART') }
    Remove-ItemProperty -Path $startup -Name $testId -ErrorAction SilentlyContinue
    # Recursive cleanup is restricted to this test's freshly created temp root.
    $resolved = [IO.Path]::GetFullPath($testRoot)
    Assert-True ($resolved -eq (Join-Path ([IO.Path]::GetTempPath()) $testId)) 'Unsafe test cleanup path'
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
