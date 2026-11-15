# Always-on signal service

The existing website stays on Lovable. The primary scanner host is now the user's own Windows PC, using the same separate Bun worker. See [Windows setup guide](windows/SETUP.md). No paid VPS or Render service is required. A sandbox process is only a temporary test and is not production hosting; the Windows installation has not been performed or verified here.

## Optional legacy Render deployment (not the primary choice)
Do not deploy until original-Pine parity is validated. Render configuration is preparation only; paid activation requires the user's separate final confirmation.

1. Set `ENGINE_SHARED_SECRET` using Lovable's secure secret form (Generate + copy), then paste that same private value into Render. Publish the website after saving the key to activate it at the public HTTPS URL. Never put it in chat or source.
2. Connect the project source repository to Render and create a Blueprint from `render.yaml`. It requests one Frankfurt background-worker instance on the 0.5c-512mb plan (approximately $7/month; confirm current pricing in Render before approving).
3. Set `ENGINE_APP_URL` to the published website origin (no trailing path) and `ENGINE_SHARED_SECRET` to the same private value saved in Lovable. No database administrator key or Binance trading key is required.
4. Deploy. Verify System Health shows a fresh heartbeat, Binance connected, WebSocket connected and 20 available / 21 configured contracts. WILDUSDT is not currently listed and is deliberately unavailable.
5. Close every browser, wait for multiple confirmed minutes, reopen and verify later candle timestamps and genuine new events. Restart the worker and verify checkpoint recovery. This step is required before claiming unattended operation.

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

## Local observation (no writes)
`bun run engine-worker/main.ts --observe` connects to real Binance REST/WebSocket, computes historical/live signals in memory, and writes no trades or notifications. It is a historical/live calculation check, not verification of production persistence or unattended hosting.

## Isolated real-worker verification
`bun run verify:worker` runs the real service against Binance and an authenticated local test endpoint backed by disk PGlite. It loads the existing migration set into an isolated database, deliberately disconnects WebSocket, verifies later candles, stops the worker, closes/reopens the disk database and starts a new worker from persisted checkpoints. It writes `/tmp/worker-verification-report.json`; no hosted database or Telegram credentials are used and fixture signals never reach the real chat. Telegram delivery is checked separately with a clearly marked backend TEST message.

Render remains one Docker background worker with auto-deploy off; applying the Blueprint can incur the paid cost and must wait for final confirmation. The Docker container itself cannot be validated here without a Docker daemon. Local recovery evidence is not a deployed 24/7 uptime test.