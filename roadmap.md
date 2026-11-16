# Independent Crypto Signal Terminal

## Deployed sweep validation (prompt-18, 2026-11-16)
- [x] Inspect genuine hosted evidence:40/40feeds, both directions evaluated; current decisions/trades still use old families, zero audited completed new sweeps. Actual paper leverage50x,target10,valid stops; open margin58.37% at18:13UTC. No thresholds/history changed.
- [x] Add exact covered-source fingerprint and deployment status, full per-candle LONG/SHORT decisions, atomic runtime receipt and separate30-completed-new-sweep progress/performance. Old or temporary results excluded.
- [x] Website published:public/robot HTTP200, new version panel+0/30 visible, no runtime errors.184tests pass/buildOK; isolated real40feeds,160durableLONG/SHORTdecisions,0forcedtrades; desktop/602/390 actual empty new-version panel verified.
- [ ] Redeploy/verify Railway active source — requires Railway service access or the user's active-deployment evidence.
- [ ] Collect at least30 genuine completed new-strategy paper trades — requires deployed corrected worker and future qualified opportunities; never force entries.

## Entry audit and liquidity sweep (prompt-17, 2026-11-16)
- [x] Audit actual entry/execution/accounting code: five genuine LONG pullbacks at initial observation; source-derived fees/sign/quantity/ROI reconcile; entry quote/MAE/MFE absent. Retrospective candles labelled separately.
- [x] Show findings before replacing entries; add ENTRY AUDIT & LIQUIDITY SWEEP REPORT with old conditions, real frozen evidence and latest up-to20 trades.
- [x] Implement confirmed sweep-only entries, fresh executable-price checks, cost-aware structural stops/targets and atomic entry/MAE/MFE/funding diagnostics; preserve existing systems/history. Exactly40 configurable coins, open coins protected.
- [x] Compare old/new LONG/SHORT historical replays with costs (old370 trades−19.29, sweep4 trades−0.44; both unprofitable, later slice0; loose0.5 sensitivity116 trades−9.89). Isolated real40/40 live feeds,240 decisions all rejected, no qualifying trade or message fabricated.178 tests and desktop/602/390 report read-back passed.
- [ ] Verify deployed new-strategy paper outcomes — requires updated Railway deployment and genuinely qualified future entries.

## Paper robot rebuild (prompt-16, 2026-11-16)
- [x] Exactly 50x on every paper trade (code, message check and database guard); take profit at 10% net ROI on margin after fees/funding; 70% combined margin cap split across up to 5 slots (max 10).
- [x] Removed daily loss limit, loss-streak pause and daily trade cap from paper mode; queue refills a slot as soon as a trade closes.
- [x] Six setup families with weighted 0-100 score; separate LONG/SHORT score and reason per coin; scanner diagnostics (evaluated, candidates, rejections with reasons, orders submitted/filled/partial/rejected, queue).
- [x] Realistic simulated fills: live order-book walk, partial fills, Binance tick/step/min-notional rules, maker TP / taker stop fees, slippage, live funding.
- [x] Two-week replay through the same pipeline: not profitable (full -19.29 of 20 USDT, PF 0.40; unseen Nov 12-16 -19.29, PF 0.52). Saved to Robot Backtest page.
- [ ] Publish website, then redeploy Railway worker so the rebuilt robot runs — needs the user.
- [ ] Real-money execution — not built; only after paper results show an edge and the user explicitly approves.

## Railway crash and paper starting balance (prompt-15, 2026-11-16)
- [x] Reproduce the missing-module crash from the old Docker COPY set, include src/lib/robot, and verify the packaged main with Railway's exact Bun 1.3.10: health 200, safe isolated 451 pause, owning shutdown, no production signals.
- [x] Set new-account defaults and unused initial allocation to 10 USDT through a guarded audited correction; preserved 10 USDT deposit gives 20 USDT current balance, deposit receipt unchanged, no robot trades erased. All 160 tests pass.
- [x] Verify actual balance read-back, robot confirmation/cancel and invalid deposit, all robot sections and 15 settings, linked backtest and coin monitor, original Simulator; desktop/602px/390px dark-only pages have no runtime errors or overflow; website build OK. Explain updated-source deployment, not restart of the broken image.
- [ ] Verify actual Railway container startup after publishing website and deploying updated source — no Railway connection available; user deployment required. No uptime guarantee or production live-scan claim.

## Paper trading robot (prompt-14, 2026-11-16)
- [x] Runs alongside existing signals, Telegram and Simulator (unchanged); own paper account (10 USDT start, corrected by prompt-15), 40 coins (20 existing available + 20 top-volume; WILD unavailable).
- [x] Independent liquidity-sweep / pullback strategy on 5m with 15m/1h trend, 0-100 score (75 trade, 85 high quality), risk-based sizing, dynamic leverage max 50x, 70% total margin cap, TP1 half + breakeven, early/time exits, daily loss limit, loss-streak pause, correlation limit.
- [x] 3-month backtest (Aug-Oct 2026, fees + slippage, October unseen): 127 trades, net -13.11 USDT, PF 0.95 — no proven edge; saved and shown on Robot Backtest page.
- [x] Database-guarded commits, STOP ALL, resume, deposits, settings; PAPER ROBOT Telegram receipts on open, TP1 and close; 18 new tests, 153 total pass.
- [ ] Publish website, then redeploy Railway worker so the robot starts — needs the user.
- [ ] Real-money execution — only after the user reviews paper results and explicitly approves.

## MTF trend filter (prompt-12, 2026-11-16)
- [x] Native 15M/5M/1M trend detector from user's Trend_Identify_Indicator; LONG entries only when all three BULLISH, SHORT only when all three BEARISH; mixed/sideways = no signal.
- [x] Telegram labels NORMAL SIGNAL (entry) and BREAKEVEN; only trend-approved trades are sent; entry alerts enabled.
- [x] Dashboard shows per-coin 15M/5M/1M trend; 119 tests + isolated real-Binance 20-feed worker check pass (all 20 checkpoints carry trend state).
- [ ] User publishes website, then redeploys Railway; until then the old worker's alerts are held (fail closed). Upgrade of existing saved coins happens on first new-worker start — verify trend badges appear afterwards.

## Railway redeployment investigation (prompt-10, 2026-11-16)
- [x] Read-only check: new hosted owner started 09:33:51, renewed heartbeat/90-second lease through 09:38:11; matching owner, no recorded restriction. Recovery counters increased 12581 to 12890; 12/20 symbols have commits, oldest saved candle remains yesterday, no completed live scan or validated feed telemetry. Existing Telegram has only four TEST/SENT receipts (latest 11); no message sent.
- [x] Explain expected overlapping/retrying startup lease denial versus unknown replica count; current evidence strongly indicates pre-fix worker despite website published 09:31:47 and database supporting feed evidence. 26 isolated tests pass, published/preview browser health agree, no runtime errors; application/configuration/history unchanged; chat.md updated.
- [ ] Identify Railway active source revision and deployment/replica state — needs user screenshot of active deployment repository/branch/commit before any deployment or termination advice.

## Current deployed-status diagnosis (prompt-9, 2026-11-16)
- [x] Investigate without application changes: hosted recovery advances; REST heartbeat expires during successful history; completed-scan timestamp awaits initialization; SYSTEM depends on RUNNING, not cloud/Telegram alone; WILD absent from listed trading contracts.
- [x] Reproduce silent legacy candle connection against the same Binance host and verify the maintained SDK's market path: Node and Docker Bun 1.3.10 each receive zero frames on /stream and 26 valid frames on /market/stream during paired 18-second checks. This is sandbox evidence, not Railway live-feed certification.
- [x] Implement approved same-host feed path, REST freshness, valid per-feed telemetry, startup watchdog, oldest saved recovery view and strict live-readiness gating; 113 tests pass and Docker Bun real isolated 20-feed message/reconnect/disk restart passes, no production fixtures or Telegram. Preview health/dashboard desktop/current/phone checked; latest build OK.
- [ ] Verify actual Railway live frames after matching website/worker deployment — needs user to deploy the updated worker and share actual hosted results.
- [ ] Verify all 20 fresh durable feeds and genuine hosted breakeven delivery — depends on completed recovery, correct live feed and real deployed observations.

## Deployed Railway monitoring investigation (prompt-8, 2026-11-16)
- [x] Observe actual hosted heartbeat (20-second progress) and serial durable recovery: 3632 commits across four symbols by 09:06:49; published UI correctly shows CLOUD ONLINE / WEBSOCKET CONNECTED / SCANNER RECOVERING and stale feeds. No current complete scan or recorded 451; REST label expires during recovery because successful history does not refresh REST health.
- [x] Verify one explicitly labelled non-trading Telegram TEST via published Settings: message 11 SENT and read back; settings unchanged, no fixture signals. Bun 1.3.10 isolated messages/reconnect pass but unsupported unexpected-response loses HTTP rejection status. Real sandbox Bun/Node probes both connect with no frames during observation, not Railway proof. 37 targeted tests pass; build OK; app/worker unchanged.
- [x] Record evidence, monitoring limitations and the next user check in chat.md.
- [ ] Inspect the running Railway container's private market-message telemetry and deployment revision — needs access to Railway or a redacted user-provided result; do not expose keys.
- [ ] Verify completed catch-up followed by fresh per-symbol live prices/candles and genuine breakeven delivery — needs the deployed worker to complete recovery and actual live results; do not fabricate signals or restart it as a substitute.

## Restriction flow sweep (2026-11-16)
- [x] Read all seven screens, shared header/monitor/setup/details, scanner startup/history/recovery/live/reconnect/price/delivery/shutdown paths, alert send/retry/test functions, health reads and all current database functions.
- [x] Fix abort handling and stale-socket events, per-symbol saved-state labels, active ledger/history notices, setup ERROR and manual/background delivery pause; additive 0008 guards market writes and signal claims with existing lease serialization. Sent/closed records, permissions, preferences and calculations unchanged.
- [x] Verify 103 tests, real isolated 20-feed reconnect/disk restart and all seven screens on desktop/phone; no overflow/runtime errors; build OK 08:39:27 UTC. chat.md updated; no real messages sent, hosted access/deployment/certification blockers retained.

## Railway Binance access investigation (2026-11-16)
- [x] Inspect public Futures endpoints, startup failures, hosting configuration and dashboard status: sandbox requests return 200; isolated 451 fails before heartbeat; 13 targeted tests pass; preview/published retain STOPPED status and four genuine SHORT positions. Official current regional permission remains unverified; official archives are historical-only and live provider candidates exceed the $0 budget.
- [x] Prepare a safe proposal and read-only Railway verification procedure; no production code, hosting settings, strategy, history or Telegram changes.
- [x] Implement approved restriction-aware health/logging and Railway-compatible presentation; 89 tests pass, including concurrent heartbeat serialization; isolated real 20-feed Binance reconnect/disk restart passes, restricted desktop/current/phone checks have no overflow/runtime errors, latest build OK; chat.md updated. No production deployment or provider change.
- [ ] Verify permitted market access and genuine deployed scanning — needs Railway's chosen region/public 451 response, Binance eligibility confirmation and access to real hosted results; no verified free equivalent live replacement.

## Safe setup reference request (2026-11-16)
- [x] Add all required Render setup names, safe public values and copy buttons; private values never appear on the public website, and forgotten keys use the secure replacement form.
- [x] Verify copy actions and private-value protection: 9 targeted tests passed, all 8 copy buttons verified in browser, desktop/current/phone layouts have no overflow or runtime errors; latest build OK. Mobile hook imports React correctly and quoted diagnostic is absent; no invented hook fix or trading-rule changes.
- [x] Handle prompt-5 key request safely: secure replacement form confirmed ENGINE_SHARED_SECRET saved; user must copy it into Render and republish. No private value exposed, matching error reproduced, application changes or deployment performed; chat.md updated.

## Render free hosting request (2026-11-16)
- [x] Remove PC connection from website and package; replace with cloud scanner status.
- [x] Run scanner as a Render free web service with health check and self keep-awake; tested locally (65 tests, real Binance connect, /healthz ok, private health 401).
- [x] Defer Render account/blueprint creation — superseded by the user's reported Railway Docker deployment; no account or subscription activated here.
- [x] Verify republication and matching-key hosted communication — published 2026-11-16 08:52:05 UTC; actual Railway heartbeat and durable recovery accepted by the published engine API in prompt-8 investigation.

## Current zero-cost reliability request
- [x] Inspect the reported mobile-hook error and actual scanner/Telegram state without modifying strategies — hook correctly imports React, quoted text absent, no matching error; live engine STOPPED.
- [x] Improve truthful scan status, next candle schedule, durable scan counts and delivery timestamps; preserve layout and recovery protections.
- [x] Verify isolated startup/repeated scanning/reconnect/restart/deduplication, dashboard refresh and one labelled Telegram test — 64 tests pass; real 20-feed Binance recovery, 31 durable candle scans and reopened counters/checkpoints; safe TEST ID 10 SENT.
- [x] Explain browser/PC shutdown limits and zero-cost deployment blockers without activating infrastructure — current web hosting does not run the separate continuous worker; an eligible free always-on host is still required.
- [ ] Verify deployed genuine signal/breakeven Telegram delivery and unattended uptime — matching-key hosted recovery and standalone TEST delivery verified; actual live all-feed scanning, lawful access, independent certification and genuine signal delivery remain unverified.

- [x] Inspect current application, full LONG/SHORT Pine scripts, database and preferences.
- [x] Check real Binance Futures availability for the existing 21 symbols.
- [x] Recommend Render background-worker hosting (paid, approximately $7/month); prepare deployment without provisioning an account.
- [x] Implement source-derived Pine defaults, confirmed-candle processing and independent LONG/SHORT state; reference-output parity remains separate below.
- [x] Implement REST warm-up, WebSocket subscriptions, gap recovery, reconnects, restart persistence and deduplication.
- [x] Add non-destructive persistence and configurable Telegram notifications, preserving current defaults.
- [x] Redesign dashboard, histories, positions/statistics, settings and service health without TradingView configuration.
- [x] Test source-derived rules and isolated persistence; real observation of 20 listed symbols plus unavailable WILD; real Telegram test. Production end-to-end validation remains below.
- [x] Add candidate Pine-language comparison using exact original uploads and 1500 identical real NEARUSDT candles; 44 tests pass, no production trading-rule changes.
- [x] Correct comparison interpreter EMA/MACD startup, storage precision, extrema startup and float-comparison semantics; both intact originals match native results across 4500 real NEAR/LINK/WIF candles.
- [ ] Certify exact TradingView outputs before deployment — local interpreter agreement passes, but independent TradingView exports on identical candles/start/inputs are still unavailable.
- [ ] Verify permanent free cloud monitoring with the browser closed — actual hosted heartbeat/recovery and matching credentials verified in prompt-8; still needs zero-cost eligibility, lawful access, independent parity certification, all-feed live data and unattended results. The user rejected PC hosting; no hosting settings changed here.
- [x] Update chat.md and document verified results and remaining blockers.
- [x] Finish uploaded-requirements verification after key setup: 20 real saved candle streams, restart recovery, four genuine recovered trades read back, stopped temporary-test status, 40 passing tests and browser checks.
- [x] Diagnose offline report and verify Telegram separately — engine STOPPED since 14:29 UTC, website never published, labelled TEST delivered and read back SENT; no matching src/main.tsx / React.queryClient error found.
- [x] Record final independent architecture and paid-service/predeployment verification restrictions; Render configuration remains prepared, not activated.
- [x] Produce detailed per-field parity report with zero local mismatches and explicit independent-certification boundary.
- [x] Reverify real Binance reconnection/candle advance on 20 feeds, disk database reopening and 20-checkpoint worker restart; standalone real Telegram TEST delivered. No production fixture signals or paid activation.
- [x] Add Windows boot task, crash supervisor, duplicate-process protection, private local health, persistent logs and setup/troubleshooting scripts.
- [x] Add truthful PC/engine status, uptime, last successful scan and directional active counts to dashboard and health.
- [x] Document outbound-only secure communication and optional Cloudflare Tunnel configuration without provisioning external resources.
- [x] Test changed rules and isolated restart/reconnect; deliver clean Windows source/setup bundle and actual results (61 tests, actual isolated Binance recovery and supervisor crash restart; Files package inspected).
- [x] Defer Windows reboot, crash and tunnel activation — superseded by the user's 2026-11-16 request for free cloud hosting; preserve existing Windows files without activating them.
- [x] Diagnose PC-key request: secure replacement/copy form confirmed a new engine key saved; never expose it in chat. Reported NotFound file/error is not present; no application changes needed. chat.md updated.
- [x] Guide free PC-independent hosting and diagnose the reported mobile-hook UMD error — Oracle Always Free is conditional on capacity/account eligibility and idle-reclamation limits; Render free workers are unavailable. Actual hook already imports React; no quoted diagnostic reproduced. Routing test and live desktop/current-screen checks passed; no application changes or activation.
## Simulator trading (prompt-13)
- [x] Simulator balance, 80% margin, STRONG 50x / NORMAL 20x, fees + liquidation, one trade at a time
- [x] Simple dashboard; other pages under "More"
- [ ] Publish website, then redeploy Railway so signals carry STRONG/NORMAL (until then all simulated trades use 20x) — waits on user
- [ ] User adds practice balance on the Simulator page — waits on user
