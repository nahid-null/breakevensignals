<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

- Run market calculations in the separate always-on `engine-worker`, never web requests or browser components, because the web runtime cannot guarantee continuous subscriptions.
- Keep pure candle calculations in `src/lib/engine`; persist checkpoints, events and notification outbox atomically through the shared-secret engine API to prevent replay and concurrency drift.
- Tag warmup adoption and recovery separately, suppress their notifications, and keep replayed closed trades out of live history so historical events cannot masquerade as live execution.
- Keep public dashboard tables anon-readable and checkpoints service-only; all writes go through server code, and retained legacy receipts must never receive new signal traffic.
- Telegram goes through the connector gateway (`src/lib/telegram.server.ts`); chat target comes from the `TELEGRAM_CHAT_ID` secret.
- Use a publishable, no-session server client for public health reads; reserve the admin client for privileged writes so public read paths remain covered by database access policies.
- Test transaction behavior against migrations in isolated PostgreSQL, never production test trades, because persistent history must remain genuine.
- Persist service runtime identity and release only the owning lease on shutdown so temporary checks cannot be mistaken for production or block restarts.
- Derive displayed trade trigger levels from original risk and signal timestamps from entry/breakeven/exit times so replay processing time cannot masquerade as detection time.
- Keep Pine-language verification in `engine-worker/verify-pine.ts` using intact sources and identical candles; isolate documented interpreter corrections in `pine-runtime.ts`, and never treat local agreement as independently exported TradingView certification.
- Apply Pine's documented nine-fractional-digit operand comparison through `src/lib/engine/pine-numbers.ts`, without quantizing stored indicator values, because raw JavaScript noise can invent momentum on unchanged closes.
- Verify real worker restart/reconnect against disk-isolated PostgreSQL through `engine-worker/verify-worker.ts`; never direct fixture signals to the hosted database or real Telegram chat.
- Keep the Docker worker compatible with Railway and existing Render settings: one instance, bind PORT with content-free /healthz, and retain the writer lease because cloud liveness must never imply successful scanning or lawful market access.
- Worker telemetry is outbound through the authenticated engine API; the public /healthz returns only liveness, and detailed health requires the separate health key, never database keys or write controls.
- Derive public cloud connectivity from production hosted identity plus a fresh server-received heartbeat; uptime is last reported and scan time is the slowest durable configured feed, never a poll timestamp.
- Count successful per-symbol closed-candle commits atomically in market state, excluding warmup; never count browser polls or duplicate revisions as scans.
- Derive RUNNING and the next expected candle close from fresh heartbeats, validated per-feed messages and closed/live-committed candles for every available symbol; socket-open or REST recovery alone cannot certify live scanning.
- Keep the browser setup reference as a public/private discriminated list with no private value fields; copy only public values or key names because the dashboard is public and must never expose credentials.
- Acquire the owning lease and report heartbeat before market startup; keep health alive but halt market traffic on typed 451/418 errors until restart, because provider restrictions must not be hidden by a startup crash or bypassed by retry routing.
- Share stable market-access error codes between worker and health projection using existing ERROR telemetry, because distinct public restriction status must remain compatible with the deployed heartbeat schema.
- Enforce the recorded restriction at commit, price-update and signal-delivery boundaries as well as the worker; exempt explicitly labelled test deliveries, because concurrent or manual paths must not bypass the pause or alter sent history.
- Use shared per-feed freshness and saved-state notices across market screens, because a healthy global heartbeat cannot make an individual stale price or recorded trade live.
- Use Binance's documented same-host market candle path; Bun's native socket hides rejection status, so inspect a same-path HTTP upgrade on errors and hold reconnects until restriction classification completes.
- Keep bounded validated feed telemetry in owning heartbeats; show oldest saved recovery progress separately from a completed live scan, because startup commits are genuine but not live-message evidence.
- Gate scalper entries with the native MTF trend detector in `src/lib/engine/mtf-trend.ts`, persisted in checkpoints and rebuilt from Binance 1m/5m/15m candles when missing; Telegram is queued in the database only for `trend_aligned` live events, so unknown trend state fails closed.
- Run the practice simulator inside the atomic candle commit (`simulate_engine_candle`), trading only live `trend_aligned` entries that actually queued a Telegram log, with one open simulated trade, because simulated balance must follow exactly the signals sent to Telegram; signal strength comes from `signalStrength()` in `mtf-trend.ts` and missing strength fails to the lower tier.
- Run paper-only RobotService beside signals under the same lease/restriction pause; RobotCore shares live/replay sweep logic. robot_commit_verified wraps audited/robot_commit guards, saving entry evidence, funding, excursions, source fingerprint and all decisions atomically. Keep legacy evidence NULL and entries replay-only; fresh hosted byte-matching evidence, not liveness, certifies the covered release.
- Ship both pure engine trees in the worker Docker image and smoke-test that COPY set; audit unused initial-capital corrections separately from deposits to preserve ledger history.
