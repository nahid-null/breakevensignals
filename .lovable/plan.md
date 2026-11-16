# Restore the verified Binance candle feed and truthful monitoring

## Findings
- Hosted recovery is advancing, not stuck; seven symbols have begun catch-up, but no feed is current yet.
- The existing candle connection uses Binance's legacy `/stream` path. Binance's maintained connector routes candles through `/market/stream` on the same host. Paired sandbox checks in both Node and Docker Bun received zero frames on the old path and 26 valid updates on the current path. Railway reception still needs verification.
- REST shows DISCONNECTED because successful history downloads do not refresh its connection timestamp.
- The completed-scan timestamp is not calculated during startup recovery; cloud and Telegram availability do not imply scanner readiness.
- WILDUSDT is not listed as a trading USD-M Futures contract; retain it as unavailable.

## Proposed changes
1. Correct only the documented Binance candle connection path. Preserve Binance USD-M Futures, the 21 configured symbols, one-minute candles and every trading calculation.
2. Refresh REST health after successful market-data requests. Keep 451/418 restrictions visible and enforce the existing pause everywhere.
3. Distinguish an open connection from validated market messages. Track per-coin valid-message freshness and confirmed-candle progress; socket-open must never count as data received.
4. Report startup recovery progress and the oldest durable available feed separately from a completed live scan. Activate the no-data watchdog during startup as well as after initialization.
5. Keep RUNNING dependent on fresh valid data and recent durable scans for every available feed, with no incomplete recovery or recorded restriction. Do not promote an old recovery close to a live signal.
6. Preserve trade/history records, checkpoint ordering, single-writer ownership, recovery notification suppression and current Telegram preferences.

## Verification
- Add targeted tests for feed routing, REST freshness, open-but-silent connections, stale individual feeds and restriction handling.
- Run real isolated Binance message/reconnect and durable recovery checks without production fixtures or Telegram trading tests.
- After approval, explain publishing and the matching Railway deployment. Verify actual hosted intrabar messages, later closed-candle commits and all available feed freshness before claiming live operation.
- Genuine breakeven delivery and unattended uptime remain separate real-world checks; do not fabricate signals to satisfy them.

## Technical details
- Keep calculations in the existing separate worker and pure engine modules; no browser scanning, generic replacement rules or new login system.
- Use the same `fstream.binance.com` host and its maintained candle path, not alternate hosts, geographic routing, proxies or restriction workarounds.
- Store only bounded safe health evidence. Public liveness stays content-free; credentials never appear in dashboard responses or logs.
- Handle Bun's unsupported rejection callback separately from valid message reception; verify runtime behavior before choosing a compatibility change, and preserve fail-closed restriction handling.

## Not included
- No paid service activation, hosting-region changes, signal fixtures, deletion of records, Pine-rule changes or claim of independent TradingView certification.
- No application or worker code has changed during this investigation. Implementation awaits approval.