. "$PSScriptRoot\common.ps1"
Assert-Administrator
Stop-ScheduledTask -TaskName "$TaskName-Tunnel" -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName "$TaskName-Tunnel" -Confirm:$false -ErrorAction SilentlyContinue
$exe = Join-Path $InstallRoot 'tunnel\cloudflared.exe'
Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $exe } | ForEach-Object { & taskkill.exe /PID $_.ProcessId /T /F | Out-Null }
Write-Host 'Local tunnel stopped; existing Cloudflare DNS and account resources were not deleted.'