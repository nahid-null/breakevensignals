. "$PSScriptRoot\common.ps1"
Assert-Administrator
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) { Write-Host "Startup task: $($task.State)" } else { Write-Host 'Startup task: not installed' }
try {
    $h = Get-ScannerHealth
    [pscustomobject]@{ Supervisor=$h.supervisor; WorkerAlive=$h.workerProcessAlive; RestartCount=$h.restarts; BinanceWebSocket=$h.engine.connected; Initialized=$h.engine.initialized; AvailableCoins=$h.engine.available; ScannedCoins=$h.engine.scanned_symbols; LastSuccessfulScan=$h.engine.last_scan_at; UptimeSeconds=$h.engine.uptime_seconds; LastError=$h.lastError } | Format-List
} catch { Write-Host 'Local PC scanner: OFFLINE / health unavailable.' }