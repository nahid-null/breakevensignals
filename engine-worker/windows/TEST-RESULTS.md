# Windows scanner preparation — actual test results

Date: 15 November 2026 (UTC).

## Verified here

- All **61 tests across 10 files passed**: original trading rules/parity, persistence, notification controls, worker recovery, PC heartbeat freshness, private local health and actual supervisor subprocess tests. Original LONG/SHORT logic and uploaded Pine sources were not modified in this task.
- Three saved markets (NEAR/LINK/WIF), 1,500 real candles each, both directions: zero local interpreter parity mismatches. **This is not independently exported TradingView certification.**
- Actual Binance worker check, 15:28:41–15:30:10 UTC: 20 available of 21 configured contracts, forced WebSocket reconnect, later candle advancement, disk database reopen and recovery of all 20 checkpoints. No hosted writes; no Telegram fixture messages.
- Actual Bun supervisor observation on this Linux sandbox, finished 15:33:00 UTC: real Binance 20 feeds initialized, authenticated local health returned real state, missing authorization rejected 401, second supervisor rejected before spawning, forcibly killed worker replaced with a different PID and reinitialized all 20 feeds. No browser was running, zero production writes. Operational logs were written. This is **not** execution of Windows Task Scheduler.
- All Windows PowerShell scripts parsed without syntax errors using PowerShell 7 on Linux. Windows 5.1/SYSTEM execution and platform cmdlets were not executed here.
- New health fields confirmed present in the hosted database. Additive migration retains existing data and ownership safeguards; isolated PostgreSQL tests prove a second owner cannot overwrite PC telemetry.
- Real preview dashboard and System Health read the existing saved history and show **Local PC OFFLINE**, **scanner STOPPED**, no invented uptime/scan timestamp, 0 active LONG and 4 retained genuine SHORT positions. Current 847×656, desktop 1280×1800 and phone 390×844 checks show no document overflow or browser runtime errors. All content pages retain unique title/description/social metadata.
- Latest automatic app compilation succeeded. The reported `src/App.tsx` does not exist in this TanStack app; no matching undefined `variant` error was reproduced. No fake file or fix was created.

## Not verified / not activated

- Installation on the user's Windows PC, automatic boot before login, Windows crash restart and actual internet disconnection/recovery. Scripts and an acceptance check are supplied; these require that PC.
- PC-to-published-dashboard end-to-end new Windows telemetry. The website is not published; only existing real saved history and isolated worker telemetry were verified.
- Cloudflare account, DNS, named tunnel or public health hostname. Configuration and startup scripts are optional preparation, not an activated or verified tunnel. No Cloudflare resources were mutated.
- Actual Windows browser-closed 24-hour operation, power-outage reboot or Windows sleep behavior. A sandbox subprocess test cannot certify these.
- Independent TradingView output certification and deployed genuine signal-to-Telegram flow. Previous labelled Telegram delivery checks remain separate; no new message or trading event was sent in this task.
- No paid VPS, Render activation, subscription or automatic publication occurred. Lovable plan/storage limits and PC internet/electricity still apply; a stable optional domain must already be owned to avoid a domain purchase.

## Changed files and corrected behavior

- Worker: `service.ts` (host/uptime/durable scan telemetry only), `main.ts`, new `supervisor.ts`, `local-health.ts`; verification runners now use platform temporary paths.
- Windows: installation, boot/task control, private config template, status, isolated verification, acceptance/crash checks, optional tunnel config/start/stop and setup/troubleshooting guide under `engine-worker/windows`.
- Website: new `engine/health.ts`, `PcMonitor.tsx`; health/API presentation in `ops.functions.ts`, `data.ts`, shell/badges, dashboard/health/setup pages. Cached heartbeats now expire independently of successful next reads; database failures cannot retain fake online status. Existing filters, trade history, positions, Telegram and settings remain.
- Database: additive `0006_windows_pc_engine_telemetry.sql` and generated schema types/metadata.
- Tests: new PC health and supervisor tests, expanded isolated persistence and worker telemetry assertions. Architecture, roadmap and central `chat.md` updated.
- No undefined-variant bug was reproduced; operational fixes are platform-neutral temporary reports and truthful freshness/host detection, not changes to indicator calculations.

## Release blockers

Independent reference certification; permission to publish; matching private key and installation on the user's PC; Windows reboot/network/24-hour checks; optional user-approved existing Cloudflare domain/tunnel setup. Keep production startup disabled until the reference gate passes.