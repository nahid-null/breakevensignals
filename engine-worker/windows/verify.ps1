. "$PSScriptRoot\common.ps1"
Assert-Administrator
$oldLocation = Get-Location
try {
    Set-Location $AppRoot
    & (Get-BunPath) run verify:pine
    if ($LASTEXITCODE -ne 0) { throw 'Local Pine comparison failed. Do not enable production startup.' }
    & (Get-BunPath) run verify:worker
    if ($LASTEXITCODE -ne 0) { throw 'Isolated actual Binance reconnect/restart check failed.' }
} finally { Set-Location $oldLocation }
Write-Host 'Local comparison and isolated worker checks passed. These do not certify TradingView or Windows reboot/tunnel/24-hour operation.'