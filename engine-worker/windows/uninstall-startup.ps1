. "$PSScriptRoot\stop.ps1"
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Write-Host 'Startup removed. Installed files, configuration, logs and all database history kept.'