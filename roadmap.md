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
- [ ] Deploy and verify permanent live monitoring continues with the browser closed — shared key is saved; requires user-created Render service with matching key and publishing. Temporary real saved-candle/restart checks passed but do not fulfill permanent hosting.
- [x] Update chat.md and document verified results and remaining blockers.
- [x] Finish uploaded-requirements verification after key setup: 20 real saved candle streams, restart recovery, four genuine recovered trades read back, stopped temporary-test status, 40 passing tests and browser checks.
- [x] Diagnose offline report and verify Telegram separately — engine STOPPED since 14:29 UTC, website never published, labelled TEST delivered and read back SENT; no matching src/main.tsx / React.queryClient error found.
- [ ] Activate unattended monitoring and signal notifications — requires permission to publish and user-created paid Render service with matching shared key; no temporary process can fulfill this requirement.
- [ ] Follow final architecture confirmation: verify original-script/native parity on identical historical candles before deployment; prepare paid hosting only, never activate without separate final confirmation.