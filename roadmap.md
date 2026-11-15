# Independent Crypto Signal Terminal

- [x] Inspect current application, full LONG/SHORT Pine scripts, database and preferences.
- [x] Check real Binance Futures availability for the existing 21 symbols.
- [x] Recommend Render background-worker hosting (paid, approximately $7/month); prepare deployment without provisioning an account.
- [x] Implement source-derived Pine defaults, confirmed-candle processing and independent LONG/SHORT state; reference-output parity remains separate below.
- [x] Implement REST warm-up, WebSocket subscriptions, gap recovery, reconnects, restart persistence and deduplication.
- [x] Add non-destructive persistence and configurable Telegram notifications, preserving current defaults.
- [x] Redesign dashboard, histories, positions/statistics, settings and service health without TradingView configuration.
- [x] Test source-derived rules and isolated persistence; real observation of 20 listed symbols plus unavailable WILD; real Telegram test. Production end-to-end validation remains below.
- [x] Add candidate Pine-language comparison using exact original uploads and 1500 identical real NEARUSDT candles; 44 tests pass, no production trading-rule changes.
- [ ] Pass trustworthy original-Pine parity before deployment — candidate interpreter has incorrect EMA seeding; require validated oracle or identical-candle reference outputs. Current command deliberately exits blocked.
- [ ] Deploy and verify permanent live monitoring and Telegram with the browser closed — only after parity, separate final paid-service approval, user-created Render service with matching key, and permission to publish. Temporary runs do not fulfill this task.
- [x] Update chat.md and document verified results and remaining blockers.
- [x] Finish uploaded-requirements verification after key setup: 20 real saved candle streams, restart recovery, four genuine recovered trades read back, stopped temporary-test status, 40 passing tests and browser checks.
- [x] Diagnose offline report and verify Telegram separately — engine STOPPED since 14:29 UTC, website never published, labelled TEST delivered and read back SENT; no matching src/main.tsx / React.queryClient error found.
- [x] Record final independent architecture and paid-service/predeployment verification restrictions; Render configuration remains prepared, not activated.