. "$PSScriptRoot\common.ps1"
$oldLocation = Get-Location
try {
    Set-Location $AppRoot
    & (Get-BunPath) "--env-file=$(Join-Path $InstallRoot 'engine.env')" (Join-Path $AppRoot 'engine-worker\supervisor.ts')
    exit $LASTEXITCODE
} finally { Set-Location $oldLocation }