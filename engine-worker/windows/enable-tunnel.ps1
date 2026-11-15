[CmdletBinding()]
param([switch]$ConfirmReadOnlyHealthExposure)
. "$PSScriptRoot\common.ps1"
Assert-Administrator
if (-not $ConfirmReadOnlyHealthExposure) { throw 'Read-only health becomes reachable at your subdomain, protected by its private bearer key. Confirm explicitly before starting.' }
if (-not (Test-Path (Join-Path $InstallRoot 'tunnel\config.yml'))) { throw 'Run configure-tunnel.ps1 first.' }
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File `"$AppRoot\engine-worker\windows\run-tunnel.ps1`"" -WorkingDirectory $AppRoot
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "$TaskName-Tunnel" -Action $action -Trigger (New-ScheduledTaskTrigger -AtStartup) -Principal (New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest) -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName "$TaskName-Tunnel"
Write-Host 'Tunnel task requested. Verify HTTPS /health rejects unauthenticated requests and returns real status with the local health key.'