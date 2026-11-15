. "$PSScriptRoot\common.ps1"
$TunnelRoot = Join-Path $InstallRoot 'tunnel'
$mutex = New-Object Threading.Mutex($false, 'Global\CryptoSignalScannerTunnel')
if (-not $mutex.WaitOne(0)) { exit 0 }
try {
    while ($true) {
        foreach ($name in @('tunnel.log','tunnel-runner.log')) {
            $file = Join-Path $InstallRoot "logs\$name"
            if ((Test-Path $file) -and (Get-Item $file).Length -gt 5MB) { Move-Item $file "$file.1" -Force }
        }
        & (Join-Path $TunnelRoot 'cloudflared.exe') tunnel --config (Join-Path $TunnelRoot 'config.yml') run 2>&1 | Out-File (Join-Path $InstallRoot 'logs\tunnel-runner.log') -Append -Encoding UTF8
        Start-Sleep -Seconds 15
    }
} finally { $mutex.ReleaseMutex(); $mutex.Dispose() }