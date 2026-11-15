[CmdletBinding()]
param([string]$WebsiteUrl, [switch]$InstallTunnelClient)
. "$PSScriptRoot\common.ps1"
Assert-Administrator
$SourceRoot = (Resolve-Path "$PSScriptRoot\..\..").Path
if ($SourceRoot -eq $AppRoot) { throw 'Run installation from the extracted source bundle, not the installed app folder.' }
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { throw 'Stop and uninstall startup before upgrading. Logs and configuration will be kept.' }
$bun = Get-Command bun.exe -ErrorAction SilentlyContinue
if (-not $bun) { throw 'Install Bun for Windows from https://bun.sh/docs/installation, reopen PowerShell, then retry. No paid software is required.' }
if ([string]::IsNullOrWhiteSpace($WebsiteUrl)) { $WebsiteUrl = Read-Host 'Published website address (https://...)' }
$parsed = $null
if (-not [Uri]::TryCreate($WebsiteUrl, [UriKind]::Absolute, [ref]$parsed) -or $parsed.Scheme -ne 'https' -or $parsed.AbsolutePath -ne '/' -or $parsed.Query -or $parsed.Fragment -or $parsed.UserInfo) { throw 'Enter only the published HTTPS website origin, without a path or credentials.' }
New-Item -ItemType Directory -Force $InstallRoot, $AppRoot, (Join-Path $InstallRoot 'logs') | Out-Null
# Protect the entire installation, including secret configuration and operational logs.
& icacls.exe $InstallRoot /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Unable to restrict local folder permissions.' }
Copy-Item $bun.Source (Join-Path $InstallRoot 'bun.exe') -Force
foreach ($item in @('engine-worker','src','drizzle','package.json','bun.lock','bunfig.toml')) {
    $destination = Join-Path $AppRoot $item
    if (Test-Path $destination) { Remove-Item $destination -Recurse -Force }
    Copy-Item (Join-Path $SourceRoot $item) $destination -Recurse -Force
}
$EnvPath = Join-Path $InstallRoot 'engine.env'
if (-not (Test-Path $EnvPath)) {
    $secure = Read-Host 'Matching private engine key from Lovable (not your Telegram key)' -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    if ($key.Length -lt 32 -or $key -notmatch '^[A-Za-z0-9_-]+$') { throw 'Use a private random engine key of at least 32 letters/numbers. Save the same value in Lovable.' }
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes); $rng.Dispose()
    $localKey = -join ($bytes | ForEach-Object { $_.ToString('x2') })
    @("ENGINE_APP_URL=$($WebsiteUrl.TrimEnd('/'))", "ENGINE_SHARED_SECRET=$key", 'ENGINE_HOST_KIND=windows_pc', "LOCAL_HEALTH_SECRET=$localKey", 'SUPERVISOR_PORT=8787', 'ENGINE_HEALTH_PORT=8788') | Set-Content $EnvPath -Encoding ASCII
    $key = $null; $localKey = $null
}
$oldLocation = Get-Location
try {
    Set-Location $AppRoot
    & (Get-BunPath) install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed; startup not configured.' }
} finally { Set-Location $oldLocation }
if ($InstallTunnelClient) {
    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if (-not $winget) { throw 'Install cloudflared from official Cloudflare downloads, then run configure-tunnel.ps1.' }
    & $winget.Source install --id Cloudflare.cloudflared --exact --source winget --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw 'Tunnel client installation failed; scanner files remain installed.' }
}
Write-Host 'Installed, not started. Run verify.ps1. Independent Pine certification must pass before enable-startup.ps1.'