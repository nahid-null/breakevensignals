# Independent Crypto Signal Terminal

- [x] Inspect current application, full LONG/SHORT Pine scripts, database and preferences.
- [x] Check real Binance Futures availability for the existing 21 symbols.
- [x] Recommend Render background-worker hosting (paid, approximately $7/month); prepare deployment without provisioning an account.
- [x] Implement source-derived Pine defaults, confirmed-candle processing and independent LONG/SHORT state; reference-output parity remains separate below.
- [x] Implement REST warm-up, WebSocket subscriptions, gap recovery, reconnects, restart persistence and deduplication.
- [x] Add non-destructive persistence and configurable Telegram notifications, preserving current defaults.
- [x] Redesign dashboard, histories, positions/statistics, settings and service health without TradingView configuration.
- [x] Test source-derived rules and isolated persistence; real observation of 20 listed symbols plus unavailable WILD; real Telegram test. Production end-to-end validation remains below.
- [ ] Compare against original Pine outputs on identical candles — requires matching reference calculation exports.
- [ ] Deploy and verify real live monitoring continues with the browser closed — requires user-created Render service, shared engine credential and publishing.
- [x] Update chat.md and document verified results and remaining blockers.