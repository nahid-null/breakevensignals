# Independent Crypto Signal Terminal

## What will change
- Replace TradingView monitoring and the 42-alert setup with a native Binance Futures signal engine.
- Preserve both original Pine scripts and translate their complete trading calculations without adding filters. The supplied scripts use confirmed one-minute candles only; they contain no ADX/DI or higher-timeframe confirmation.
- Keep all 21 configured coins visible. Binance currently lists 20 contracts; WILDUSDT will show UNAVAILABLE, not fabricated prices or a replacement coin.
- Preserve all existing records and notification defaults. Add optional LONG/SHORT entry, stop-loss and take-profit notifications; breakeven remains enabled by default.
- Redesign the terminal with live price, trend, separate LONG/SHORT views, active/completed trades, statistics, histories and service health.

## Hosting and activation
Prepare a Render background worker in Frankfurt, starting around $7/month, with one instance. It continuously receives Binance WebSocket candles and uses REST for warm-up and missing-candle recovery. The website stays on Lovable; calculations and persistence stay server-side, independent of browser visits. Deployment requires your Render account, connecting the project source, a shared private engine key and publishing the website. No paid service will be provisioned without you.

## Technical details
- A pure TypeScript incremental engine implements Pine EMA, Wilder RSI/ATR, MACD, volume, confirmed swing pivots, weighted confirmation, ATR/swing risk, separate direction locks and cooldowns.
- Existing stops beat targets on ambiguous candles; both beat breakeven activation. A moved stop applies on the next confirmed candle. Fee/slippage-adjusted results follow the original scripts.
- Store versioned engine checkpoints and commit candle results, trades, events and notification outbox entries together. Reject duplicate/out-of-order candles and concurrent stale revisions.
- Keep raw checkpoints private. Public prices, health and trade data remain read-only; trusted engine requests use a secret in a header, never in a URL.
- Initial historical replay warms calculations without creating live trade records or sending notifications. Label recovery/historical processing separately from current live signals.
- Automatic reconnect/backoff, rate-limit handling, missing-candle recovery, single-instance lease and restart recovery protect continuous operation. Telegram retries use a claimed outbox; ambiguous delivery is flagged rather than blindly resent.

## Verification and completion boundaries
Run deterministic calculation/entry/exit tests and real Binance history/WebSocket checks. Verify dashboard interactions and settings read-back. Actual Pine-output parity requires reference exports on identical candles and cannot be claimed from tests alone. Unattended production monitoring remains pending until the Render worker is deployed and the published app receives real candles with the browser closed. The reported `src/pages/Index.tsx` is not present in this project, so no unrelated file or invented fix will be introduced.