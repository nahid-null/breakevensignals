[CmdletBinding()]
param([switch]$CrashWorker, [string]$TunnelHealthUrl)
. "$PSScriptRoot\common.ps1"
Assert-Administrator
$result = [ordered]@{ Time=(Get-Date).ToUniversalTime().ToString('o'); Scope='Actual Windows acceptance on this PC, not indefinite 24/7 certification'; BrowserClosed=$false; ScanAdvanced=$false; CrashRecovery='NOT REQUESTED'; Tunnel='NOT REQUESTED'; Reboot='MANUAL CHECK REQUIRED'; InternetInterruption='MANUAL CHECK REQUIRED' }
$answer = Read-Host 'Close every browser before continuing. Are all browsers closed? Type YES'
if ($answer -ne 'YES') { throw 'Browser-closed acceptance was not confirmed.' }
$result.BrowserClosed = $true
$first = Get-ScannerHealth
if (-not $first.workerProcessAlive -or -not $first.engine.initialized -or -not $first.engine.connected -or -not $first.engine.last_scan_at) { throw 'Worker is not yet scanning. Check status/logs and allow recovery.' }
$firstScan = [datetime]$first.engine.last_scan_at
$deadline = (Get-Date).AddSeconds(180)
do {
    Start-Sleep -Seconds 15
    $current = Get-ScannerHealth
    if ($current.engine.last_scan_at -and [datetime]$current.engine.last_scan_at -gt $firstScan) { $result.ScanAdvanced=$true; break }
} while ((Get-Date) -lt $deadline)
if (-not $result.ScanAdvanced) { throw 'No later completed scan was observed within three minutes.' }
if ($CrashWorker) {
    # Verify PID belongs to the scanner executable before stopping just the worker.
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($current.workerPid)"
    if ($process.ExecutablePath -ne (Get-BunPath) -or $process.CommandLine -notlike '*engine-worker*main.ts*') { throw 'PID ownership not established; crash test blocked.' }
    Stop-Process -Id $current.workerPid -Force
    $deadline = (Get-Date).AddSeconds(240)
    do {
        Start-Sleep -Seconds 15
        $after = Get-ScannerHealth
        if ($after.workerProcessAlive -and $after.workerPid -ne $current.workerPid -and $after.engine.initialized -and $after.engine.connected -and $after.engine.last_scan_at) { $result.CrashRecovery='PASSED'; break }
    } while ((Get-Date) -lt $deadline)
    if ($result.CrashRecovery -ne 'PASSED') { $result.CrashRecovery='FAILED' }
}
if ($TunnelHealthUrl) {
    $uri = [uri]$TunnelHealthUrl
    if ($uri.Scheme -ne 'https' -or $uri.AbsolutePath -ne '/health' -or $uri.Query -or $uri.Fragment -or $uri.UserInfo) { throw 'Use your real HTTPS /health address only.' }
    $rejected=$false
    try { Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 15 | Out-Null }
    catch { if ($_.Exception.Response.StatusCode.value__ -eq 401) { $rejected=$true } }
    $config = Read-LocalConfig
    $remote = Invoke-RestMethod -Uri $uri -Headers @{ Authorization="Bearer $($config.LOCAL_HEALTH_SECRET)" } -TimeoutSec 15
    $result.Tunnel = if ($rejected -and $remote.workerProcessAlive -and $remote.engine.initialized) { 'PASSED' } else { 'FAILED' }
}
$result | ConvertTo-Json | Set-Content (Join-Path $InstallRoot 'windows-acceptance.json') -Encoding UTF8
$result | Format-List
Write-Host 'Report saved privately. Reboot/network-interruption/24-hour checks remain separate; no fake signals were created.'