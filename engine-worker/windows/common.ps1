$ErrorActionPreference = 'Stop'
$InstallRoot = Join-Path $env:ProgramData 'CryptoSignalScanner'
$AppRoot = Join-Path $InstallRoot 'app'
$TaskName = 'CryptoSignalScanner'
function Assert-Administrator {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Open PowerShell as administrator.' }
}
function Get-BunPath {
    $bundled = Join-Path $InstallRoot 'bun.exe'
    if (-not (Test-Path $bundled)) { throw 'Install the scanner first.' }
    return $bundled
}
function Read-LocalConfig {
    $config = @{}
    foreach ($line in Get-Content (Join-Path $InstallRoot 'engine.env')) {
        if ($line -match '^([A-Z_]+)=(.*)$') { $config[$matches[1]] = $matches[2].Trim('"') }
    }
    return $config
}
function Get-ScannerHealth {
    $config = Read-LocalConfig
    return Invoke-RestMethod -Uri "http://127.0.0.1:$($config.SUPERVISOR_PORT)/health" -Headers @{ Authorization = "Bearer $($config.LOCAL_HEALTH_SECRET)" } -TimeoutSec 5
}