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
