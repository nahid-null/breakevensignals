[CmdletBinding()]
param([switch]$ReferenceParityConfirmed)
. "$PSScriptRoot\common.ps1"
Assert-Administrator
if (-not $ReferenceParityConfirmed) { throw 'Blocked: independent original-Pine reference certification must pass first. Local interpreter agreement alone is not certification.' }
Get-BunPath | Out-Null
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File `"$AppRoot\engine-worker\windows\run.ps1`"" -WorkingDirectory $AppRoot
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = 'PT30S'
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Independent Binance scanner: outbound HTTPS, no browser dependency' -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Host 'Startup task registered and requested. Use status.ps1; a task start alone does not prove scanning.'