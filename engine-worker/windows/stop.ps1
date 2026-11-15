. "$PSScriptRoot\common.ps1"
Assert-Administrator
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
# Only our copied executable; never stop unrelated Bun/website processes.
$exe = Get-BunPath
Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $exe } | ForEach-Object { & taskkill.exe /PID $_.ProcessId /T /F | Out-Null }
Write-Host 'Scanner stopped. Public health expires within 90 seconds; checkpoints and history are preserved.'