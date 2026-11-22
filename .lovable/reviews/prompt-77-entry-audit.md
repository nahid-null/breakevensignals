# prompt-77: entry independence audit

## Reported hook diagnostic
`src/hooks/use-mobile.tsx` already explicitly imports React and uses that imported namespace for both hooks. The quoted “Carry out what is required in the file.” identifier is absent. No React-global workaround or trading-code change is justified by that diagnostic; it was not reproduced from the current source.

## Old filters
The old configuration still exists for retained legacy features, but it is not consulted by CSTF entries. No active old-filter dependency was found, so no hosted settings were changed.

- The original CSTF indicator supplies confirmed 30-minute LONG/SHORT signals.
- `engine-worker/cstf-service.ts` passes those signals directly into `processCstfAccount`, then commits the resulting batch using `cstf-commit`.
- Neither the worker nor account transition reads old trend, score, confirmation, entry-quality or entry-switch settings.
- The authenticated engine API sends the CSTF batch directly to `cstf_commit`. It strips `simulator_entries` from legacy candle commits so old strategies cannot create new Simulator trades.
- `cstf_commit` saves admissions as `OPENED`, with no old-filter gate. Its `app_settings` read only controls Telegram result delivery, not admission.

## Genuine hosted evidence
Read-only inspection at 2026-11-22 07:47 UTC found:

- CSTF status RUNNING, revision 998, no account error; latest server commit recorded at 07:46:06 UTC.
- 9 recorded CSTF signals: 2 LONG and 7 SHORT, all OPENED with null rejection reasons; no SKIPPED decisions recorded.
- The legacy robot was disabled and both legacy LONG/SHORT entry switches were false while those trades opened.
- Every recorded entry time is exactly 1800 seconds after its signal candle's opening timestamp: the 30-minute confirmation boundary, not an additional 30-minute confirmation wait.

## Remaining safety boundaries
Independence does not remove seven-slot capacity, available cross-margin checks, 75x availability, complete candle/funding requirements, recovery-entry suppression, market-access pause, authentication, lease ownership, revision checks or duplicate prevention. These protect accounting/data integrity and are not old indicator filters. Execution retains next-minute-open fills; persistence follows receipt of complete closed-minute data, not guaranteed zero wall-clock latency.

## Changes for this request
Extend the real-migration isolated database tests so both LONG and SHORT still open on the first eligible minute with opposing trend, score 100, skipped legacy confirmation, disabled legacy account and disabled entry switches all present simultaneously. Preserve the original indicator, production settings, history and running service. No publish, restart, trade injection or Telegram test delivery.

## Verification results
- All 60 tests in `cstf.test.ts`, `cstf-sql.test.ts` and `cstf-live.test.ts` pass, including the new combined-filter LONG/SHORT cases.
- Real Simulator page at 626×585 displays 6 genuine open trades, both directions, 3 take profits, $10.30 main balance and $0.5150 next margin; zero browser page errors.
- Automatic build log reports build OK at 07:47:32 UTC. The reported hook diagnostic was not reproduced; its correct React import was left unchanged.
- Tests write only to isolated PostgreSQL and rollback each scenario. The retired robot remains disabled with emergency stop enabled; no retirement guard was weakened.