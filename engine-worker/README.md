# Always-on signal service

The existing website stays on Lovable. Scanning runs in the separate Bun worker, never Chrome or a web request. The operating budget is strictly zero: no paid or trial-only resources may be activated. The user reports an existing Railway Docker deployment; its configuration and lawful Binance access have not been verified here. Capacity, account eligibility, hosting limits and Lovable usage allowances must be checked; uninterrupted permanently free operation is not guaranteed.

Keeping Chrome open cannot start this worker. Closing or refreshing Chrome does not stop a separately running worker. Both Railway and the retained Render free-service configuration bind `PORT` and answer `ok` on `/healthz`. Only Render uses the optional `RENDER_EXTERNAL_URL` self-request every ten minutes; this depends on hosting policy and does not guarantee uptime. Checkpoints let a permitted worker resume after restart. The Windows PC option was removed at the user's request.

## Existing Railway Docker deployment
The user reports running this scanner on Railway. No provider account, subscription or region is changed by this project. Keep a single instance and the existing values of `ENGINE_APP_URL`, `ENGINE_SHARED_SECRET` and `ENGINE_HOST_KIND=hosted`. Railway supplies `PORT`; the container uses `engine-worker/Dockerfile`. Railway environment identity also defaults the host kind to `hosted` when the explicit setting is absent. No database administrator or Binance trading key is needed.

Publish the corresponding website update and deploy the matching worker revision. A fresh cloud heartbeat proves the service can reach the website, **not** that Binance permits access or that scanning is RUNNING. The service acquires its owning lease and starts dashboard heartbeat reporting before requesting Binance metadata. Public `/healthz` remains content-free liveness; `/health` needs a separate private health key.

### Missing robot module on redeployment
The Docker image must include `engine-worker`, `src/lib/config.ts`, `src/lib/engine` **and** `src/lib/robot`. An image built before the robot COPY line was added exits with `Cannot find module '../src/lib/robot/config'`; restarting that same image cannot fix it. Publish the website, then deploy the updated connected source revision in Railway with the repository root as the build context and `engine-worker/Dockerfile` as the Dockerfile path. Keep existing keys, region, port and single-instance settings. Check the new deployment's logs and `/healthz`, then confirm fresh dashboard feeds separately; liveness alone is not proof of live scanning.

The paper robot starts with 10 USDT. A correction to an unused initial allocation is recorded separately from deposits, preserves existing history and never resets an account with recorded trades. Existing backtests retain their original tested starting capital.

### Binance access restrictions
The first public request is `https://fapi.binance.com/fapi/v1/exchangeInfo`; one-minute history uses `/fapi/v1/klines` and REST connectivity uses `/fapi/v1/time`. Live data uses `wss://fstream.binance.com/market/stream?streams=<symbol>@kline_1m/…`. These are USD-M Futures trade candles; Spot, Binance.US, testnet and another exchange are not replacements.

HTTP 451 is classified as `BINANCE_ACCESS_RESTRICTED`; 418 is `BINANCE_IP_BANNED`. Both pause market requests, WebSocket reconnects, candle commits and notification-drain requests until the process is restarted after lawful access is resolved. Health reporting remains active. Logs include the public endpoint path, HTTP status, timestamp and bounded sanitized JSON explanation; query strings, raw HTML and keys are not logged. Other failures distinguish rate limits, network outages, provider outages and request rejection. Only transient startup failures retry with backoff. 429 honors Retry-After within the bounded request budget.

Restrictions abort in-flight REST work and are enforced again at database write/claim boundaries. Dashboard and Health use each symbol's durable candle age rather than treating global liveness as fresh prices. Active Trade Ledger and Signal History display saved-state warnings; completed trades and sent deliveries remain unchanged. Manual signal retries and automatic outbox claims pause on a recorded restriction even after its heartbeat expires. Explicitly labelled TEST deliveries remain independent of market scanning. A Telegram request already submitted before the pause cannot be recalled; its actual outcome is recorded without resending or rewriting SENT history.

Do not switch regions, add proxies or use alternate domains to route around restrictions. Current official permission for any of Railway's four regions has not been verified. Ask Binance to confirm eligibility for the actual residence, hosting country and source IP, including possible IP-geolocation errors. A successful request alone is not legal certification.

1. In Railway, open the scanner service's Settings and note the selected region; leave it unchanged.
2. In a terminal attached to the **running Railway container**, if available, run this read-only public check (not on your PC):

```bash
bun -e 'const r=await fetch("https://fapi.binance.com/fapi/v1/exchangeInfo",{signal:AbortSignal.timeout(15000)}); console.log("HTTP",r.status); console.log(r.ok ? "Exchange information received" : (await r.text()).slice(0,1000));'
```

3. Share only the public response and region, never variables or keys. If a terminal is unavailable, share the relevant log lines. Resolve a 451 through Binance's eligibility review, not circumvention.
4. With the reporting update deployed, verify fresh CLOUD ONLINE / SCANNER ERROR / BINANCE ACCESS RESTRICTED and no later candle commits. If the heartbeat fails, check the published website address and matching private engine key separately.
5. Only after lawful access is confirmed, restart and verify REST history, live WebSocket closed candles, advancing durable scans and checkpoint recovery. Genuine signal-to-Telegram delivery and browser-closed unattended uptime remain separate acceptance checks.

Binance's official [public data archive](https://github.com/binance/binance-public-data) provides Futures history, but daily data arrives the next day and cannot power live one-minute alerts. Live vendor candidates need explicit licensing, symbol coverage, original-candle equivalence and cost checks; no permitted identical permanently free live alternative is verified. No provider substitution is implemented.

The existing `render.yaml` remains optional free-service preparation; no paid activation is permitted under the standing zero-cost budget. Its Render-specific self-request timer is not used on Railway and cannot fix a Binance restriction.

## Trading semantics and provenance
- Original one-minute Pine defaults, without invented ADX or 5m/15m filters.
- Initial 1500-candle replay runs the entire trading state machine and cooldown. Closed replay trades are backtest-only, not live history. An open historical trade is explicitly adopted as `historical` with its original prices and without a Telegram alert, so locks are not reset arbitrarily. It is not a newly detected live entry.
- Later missing candles are processed chronologically as `recovery`; historical/recovery events do not produce stale Telegram alerts. Current confirmed WebSocket candles are `native` live signals. Sources are visible in history.
- `bun run verify:pine` executes byte-identical original uploads through test-only PineTS with isolated corrections for first-value EMA (including MACD), unrounded double storage, available-window extrema and Pine's nine-fractional-digit comparisons. Native translation uses the same documented Pine comparison semantics, without new filters or changed script conditions. It compares every bar, including startup, event prices and active levels, and exits 0 for local agreement or 2 for differences. NEAR/LINK/WIF each have 1500 real saved candles and regression tests. This is local interpreter parity, not an independently exported TradingView certification. Exact TradingView output validation remains a separate gate before deployment.
- SL beats TP on the same candle, and both precede breakeven. Moved stops take effect on the next candle. Fees and slippage produce estimated R results, not real exchange fills.
- Native calculations monitor signals only; they do not place exchange orders.

## Reliability
Versioned checkpoints commit together with events/positions/outbox entries. A database lease allows one writer; stale revisions and timestamps are rejected. REST recovery never skips a missing candle. WebSocket reconnect uses exponential backoff and jitter; no activity for 60 seconds forces reconnection. Binance 429 honors Retry-After, and regional restrictions/IP bans are surfaced rather than bypassed. Failed confirmed Telegram rejections retry at most five times; ambiguous outcomes require manual review because Telegram cannot guarantee exactly-once delivery after an interrupted response.

Shutdown releases only the instance's own lease and marks the engine STOPPED. Temporary verification services must use runtime mode `temporary`; the dashboard distinguishes these runs from permanently hosted monitoring. Saved timestamps are normalized on restart and current market rows are restored before display updates resume.

The dashboard expires heartbeat-based status after 90 seconds. RUNNING also requires connected Binance feeds and durable scan progress within three minutes. The next scan is the expected one-minute candle close, not a guaranteed execution time, and is absent while stopped or recovering. Successful candle scans count per-symbol live/recovery commits only, starting at the counter migration; initial warmup, duplicate commits and dashboard polling never increment it. Counters persist with checkpoints atomically. Returning to a visible tab or restored internet refreshes dashboard reads without spawning a scanner. Telegram status reflects the latest recorded delivery, not an ongoing API probe; successful delivery time uses its saved confirmation timestamp.

## Local observation (no writes)
`bun run engine-worker/main.ts --observe` connects to real Binance REST/WebSocket, computes historical/live signals in memory, and writes no trades or notifications. It is a historical/live calculation check, not verification of production persistence or unattended hosting.

## Isolated real-worker verification
`bun run verify:worker` runs the real service against Binance and an authenticated local test endpoint backed by disk PGlite. It loads the existing migration set into an isolated database, deliberately disconnects WebSocket, verifies later candles, stops the worker, closes/reopens the disk database and starts a new worker from persisted checkpoints. It writes `/tmp/worker-verification-report.json`; no hosted database or Telegram credentials are used and fixture signals never reach the real chat. Telegram delivery is checked separately with a clearly marked backend TEST message.

The Docker container itself cannot be validated here without a Docker daemon. Local recovery evidence is not a Railway network test, proof of permitted access or deployed 24/7 uptime.

## Validated feed monitoring
The worker keeps Bun's functioning native socket and inspects the same-path HTTP upgrade on connection errors, retaining HTTP 451/418 classification before reconnecting. It does not register Bun's unsupported rejection callback. Candle streams use Binance's documented `/market/stream` path on the same host; there is no fallback host or restriction bypass.

Socket-open is connection evidence only. Validated messages require the configured symbol, one-minute OHLCV, a current provider event time and a lawful closed-candle time. Per-feed telemetry keeps last valid reception, provider event, closed candle and successfully committed live candle separately. RUNNING requires all available feeds to have current valid messages and recent closed/live-committed candles, initialization complete, no recovery and fresh REST health. Legacy workers with no validated telemetry remain unverified.

Successful REST history refreshes REST health. The no-valid-message watchdog starts before startup recovery completes. Startup progress logs name the recovered symbol and durable candle, not credentials or backtest trades. Oldest saved candle is shown separately from last successful live scan; individual recovery counters can advance without a completed live scan. All checkpoint/event/outbox ordering and recovery notification suppression remain unchanged.

Publish the website update first, then deploy the same source revision to the existing single Railway service with `engine-worker/Dockerfile`; retain all variables and the selected region. Confirm valid-message count reaches 20/20, recovery finishes, fresh oldest saved candle and last successful scan advance, and later current closed candles commit before describing production as live. A new live breakeven delivery and unattended uptime remain separate evidence; no fake signals should be generated.