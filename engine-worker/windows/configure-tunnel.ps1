[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$TunnelId, [Parameter(Mandatory=$true)][string]$Hostname, [Parameter(Mandatory=$true)][string]$CredentialsFile)
. "$PSScriptRoot\common.ps1"
Assert-Administrator
$uuid = [guid]::Empty
if (-not [guid]::TryParse($TunnelId, [ref]$uuid)) { throw 'Use the existing tunnel UUID.' }
if ($Hostname -notmatch '^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$' -or $Hostname -notmatch '\.') { throw 'Use an existing health subdomain in your Cloudflare zone.' }
if (-not (Test-Path $CredentialsFile)) { throw 'Existing tunnel credentials file not found. Create a named tunnel in your own Cloudflare account first.' }
$client = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
if (-not $client) { throw 'Install the official cloudflared Windows client first.' }
$TunnelRoot = Join-Path $InstallRoot 'tunnel'
New-Item -ItemType Directory -Force $TunnelRoot | Out-Null
Copy-Item $CredentialsFile (Join-Path $TunnelRoot 'credentials.json') -Force
Copy-Item $client.Source (Join-Path $TunnelRoot 'cloudflared.exe') -Force
$config = Read-LocalConfig
@("tunnel: $TunnelId", "credentials-file: '$TunnelRoot\credentials.json'", "logfile: '$InstallRoot\logs\tunnel.log'", 'loglevel: info', 'ingress:', "  - hostname: $Hostname", "    path: '^/health$'", "    service: http://127.0.0.1:$($config.SUPERVISOR_PORT)", '  - service: http_status:404') | Set-Content (Join-Path $TunnelRoot 'config.yml') -Encoding ASCII
Write-Host 'Local tunnel configuration saved. No domain/DNS/account resources changed. Run enable-tunnel.ps1 after DNS is configured and you approve exposure of read-only authenticated health.'