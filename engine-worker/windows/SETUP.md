# Windows PC scanner — setup and verification

## Current state and cost

Code and installation scripts are prepared. They have **not** been installed on your Windows PC. No paid worker, VPS, subscription, tunnel resource, DNS change or website publication was activated. Do not call this system deployed or 24/7 verified yet.

The primary architecture uses no paid scanner hosting. Your PC still needs electricity, an awake Windows session (the worker does not need a logged-in user), reliable internet and the existing Lovable website/database. Existing Lovable plan/storage limits still apply. A stable optional Cloudflare Tunnel hostname needs a domain you already own; domain purchase is not free. Quick Tunnels have changing addresses and no uptime guarantee, so they are not the permanent monitoring solution.

## Architecture

```text
Windows boot -> Task Scheduler (SYSTEM, no user login needed)
              -> Bun supervisor -> original scanner worker
                                  -> Binance REST + WebSocket, 21 pairs, 1m
                                  -> outbound HTTPS + private engine key
Existing Lovable public website <- cloud checkpoints/events/outbox/health
                                  -> Telegram connector (existing preferences)

Optional: named Cloudflare Tunnel -> 127.0.0.1:8787/health (read-only + separate key)
```

The dashboard does not connect to localhost in a visitor's browser. PC updates go outward over HTTPS to the existing `/api/public/engine` endpoint. This preserves history, atomic checkpoints, one-writer ownership and notification handling. It needs no inbound router ports and **no mandatory tunnel**. Market calculations run only in the PC worker; no browser or website login drives them. There is intentionally no app login/logout system.

Database checkpoints remain in the existing cloud database, not a second local trade database. Restart resumes the same durable history; internet/cloud downtime pauses accepted commits and recovers missing Binance candles afterward. Historical/recovered trades remain tagged and their old notifications suppressed. Do not copy database administrator credentials to your PC.

## 1. Prerequisites and verification gate

- Windows 10/11 x64, administrator rights, a supported Bun Windows release and sufficient disk space for project dependencies. Install Bun from <https://bun.sh/docs/installation>; reopen PowerShell afterward.
- Download/extract the prepared source bundle to a permanent folder. Do not put secrets into that folder before sharing it.
- Complete independent original-Pine output certification on identical candles/start/inputs. Local PineTS agreement alone is not this certification. The current independent certificate is still pending.
- Publish the existing website in Lovable **only after this gate and your permission**. Use its published HTTPS origin, not the editor preview URL.
- Keep the same private `ENGINE_SHARED_SECRET` saved in Lovable and on the PC. If its value was not retained, generate/save a new one securely in Lovable and paste it into the installation prompt; do not share it in chat. Do not run another worker using the old key.
- Review scripts and use `Unblock-File` on your trusted extracted `.ps1` scripts if Windows marked the downloaded ZIP. Scripts use RemoteSigned, not a global execution-policy change.

## 2. Install (does not start production)

Open PowerShell **as administrator** in the extracted project folder:

```powershell
.\engine-worker\windows\install.ps1
```

Enter your published website address and the matching private engine key in the hidden prompt. The installer copies the required source and Bun executable to `C:\ProgramData\CryptoSignalScanner`, installs locked dependencies and generates a different private local-health key. It restricts the installation folder to Administrators and SYSTEM. No registry password or cloud admin key is needed. Existing configuration/logs are preserved on upgrade; stop/remove startup before reinstalling. Do not overwrite an active installation.

The `engine.env.example` contains intentionally empty values, not real credentials. The actual file is `C:\ProgramData\CryptoSignalScanner\engine.env`; never publish/upload it. To change the website/key, stop the scanner, edit that private file locally as administrator, then restart. `ENGINE_LOG_DIR` optionally sets an absolute local log folder; otherwise operational logs are in the installed app's `logs` folder.

## 3. Run nonproduction checks

```powershell
& 'C:\ProgramData\CryptoSignalScanner\app\engine-worker\windows\verify.ps1'
```

This runs local intact-source parity and actual Binance reconnect/restart against disk-isolated PostgreSQL. It sends no fixture signals to the hosted database or Telegram. Reports are saved in the Windows temporary directory. These checks are not a Windows reboot/24-hour/independent TradingView certificate.

## 4. Enable startup only after the reference gate passes

```powershell
& 'C:\ProgramData\CryptoSignalScanner\app\engine-worker\windows\enable-startup.ps1' -ReferenceParityConfirmed
& 'C:\ProgramData\CryptoSignalScanner\app\engine-worker\windows\status.ps1'
```

Do not set the confirmation flag unless independent certification has actually passed. The boot task runs as SYSTEM, 30 seconds after startup, hidden with no login needed. The task forbids duplicate task instances and restarts an exited supervisor every minute. The supervisor restarts crashed workers with bounded backoff; Binance handles reconnect and chronological recovery. An unresponsive startup is restarted after ten minutes and three failed health probes. The worker exits after losing its supervisor's ownership for 45 seconds, limiting orphan overlap after a supervisor crash. A second supervisor/worker cannot bind the occupied loopback port; the database lease remains the cross-PC protection against duplicate commits.

Use Windows power settings to disable sleep/hibernation while plugged in. This is **not done automatically**; review power use and laptop battery safety. A sleeping, powered-off or disconnected PC cannot scan. A power outage requires the PC/BIOS to power back on; software cannot guarantee that.

## 5. Confirm real operation

In System Health check **Local PC Server ONLINE**, actual scanner state, Binance/WebSocket, scanned count, active LONG/SHORT, last successful scan, uptime and errors. WILDUSDT stays configured but unavailable when Binance does not list it. Startup/RECOVERING is not RUNNING. Uptime is the last reported value, not an invented counter. After 90 seconds without a received heartbeat the PC and engine become offline/stopped, even if old data remains.

After installation and reference validation, run `acceptance.ps1` with all browsers closed. It checks two later complete scan timestamps and writes an actual local result. The opt-in crash check stops only the scanner-owned worker and confirms restart. It never creates fake signals. Then manually test reboot and a real network interruption and run acceptance again. No test alone proves indefinite 24/7 uptime; observe at least 24 hours, retain logs and verify actual later candles/events.

## Optional Cloudflare Tunnel (read-only health only)

No Cloudflare account access was requested or used for preparation. The optional scripts only configure your PC using tunnel resources **you already created**. They do not deploy the Lovable website to Cloudflare, and do not create zones/tunnels or alter DNS. If you want account/DNS changes through Lovable, explicitly request the exact changes and connect/confirm them separately.

Cloudflare's supported named-tunnel setup uses a tunnel UUID, credentials file, ingress hostname and a final `http_status:404` fallback. Official references: <https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/create-local-tunnel/>, <https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/configuration-file/>, <https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/as-a-service/windows/>.

1. Optional client installation: pass `-InstallTunnelClient` to the installer (uses official winget Cloudflare package), or install the official cloudflared Windows executable yourself.
2. In your own Cloudflare account use an existing zone/domain. Follow the named locally-managed tunnel guide. Authorize and create your named tunnel, retaining the credentials JSON securely. Route only the desired health hostname to that tunnel after reviewing DNS effects. Do not use quick-tunnel URLs as permanent service endpoints.
3. Run the configuration script with **your real values**, not example IDs:

```powershell
& 'C:\ProgramData\CryptoSignalScanner\app\engine-worker\windows\configure-tunnel.ps1'
```

PowerShell prompts for TunnelId, Hostname and CredentialsFile. The template is read-only `/health`, points to `127.0.0.1:8787` and defaults other paths to 404. It preserves a distinct `LOCAL_HEALTH_SECRET`, never the cloud engine key. Do not expose the child port, `/owner`, trade history, writes or secrets.

4. After approving read-only health exposure and reviewing any account/domain charges:

```powershell
& 'C:\ProgramData\CryptoSignalScanner\app\engine-worker\windows\enable-tunnel.ps1' -ConfirmReadOnlyHealthExposure
```

This starts a separate hidden boot task, with a named mutex, retry loop and task restart. Cloudflare reconnects outbound; no router port-forwarding needed. Operational tunnel logs persist, with size rotation checked between tunnel restarts; review disk use during long sessions. No tunnel link/status is painted green merely because a task exists.

5. Confirm your public `https://YOUR-REAL-HEALTH-HOST/health` rejects missing/wrong authorization (401) and returns actual scanner health only using the separate local-health bearer key. Supply it through a hidden local PowerShell prompt or a trusted HTTP client; never put it into dashboard JavaScript/URL/query or chat. `acceptance.ps1 -TunnelHealthUrl` performs both checks using local protected config. Public tunnel, DNS, Windows reboot and crash behavior remain unverified until tested on your PC.

## Stop/remove startup without deleting history

```powershell
& 'C:\ProgramData\CryptoSignalScanner\app\engine-worker\windows\stop.ps1'
& 'C:\ProgramData\CryptoSignalScanner\app\engine-worker\windows\uninstall-startup.ps1'
# Optional tunnel only:
& 'C:\ProgramData\CryptoSignalScanner\app\engine-worker\windows\disable-tunnel.ps1'
```

These stop only installed scanner executables/tasks. Trade history, checkpoints, preferences, installed files and local credentials remain. Tunnel disable does not remove your DNS/tunnel from Cloudflare. Check public status after its 90-second freshness window.

## Troubleshooting

| Symptom | Check / remedy |
|---|---|
| PC remains OFFLINE | Verify task and `status.ps1`; correct published origin/key, internet and no sleep. Preview publication is not hosting the scanner. |
| API rejects 401 | Stop, securely align the engine key in Lovable and PC, then restart. Never use Telegram or database keys. |
| Another instance owns lease | Stop the previous worker/PC; wait at least 90 seconds for lease expiry. Never erase checkpoints to bypass ownership. |
| Port already in use | Inspect Windows processes; run the scanner stop script. Do not change only one port to defeat duplicate protection. |
| Binance 451/418 | Regional policy or IP ban; report the real restriction. No proxy/geo bypass is added. |
| RECOVERING after outage | Let chronological recovery complete; inspect operational error log, do not reset data. Old notifications are suppressed. |
| Startup task fails | Inspect Task Scheduler result; ensure trusted scripts unblocked, SYSTEM can access installed Bun/config, and dependencies installed. |
| No Telegram entry/SL/TP | Existing breakeven-only defaults remain. Review separate LONG/SHORT settings; no false test trades are inserted. |
| Tunnel 404/502 | Check exact hostname, ingress path, credentials, running scanner/tunnel task and loopback health. Missing authorization must fail 401. |
| No last scan/uptime | Legacy heartbeats have no new telemetry. Do not infer a Windows PC from old hosted/temporary records. |

Supervisor/engine logs are size-rotated (5 MB, four previous files) without deleting any trading history. Keep reports and operational logs private. This is a personal public dashboard, not a broker/order execution system.