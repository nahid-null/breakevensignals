# Q-Trend ZigZag Big Swings v8 — 30-day Futures backtest

**Research only.** No live website, Simulator, balances, saved trades, Telegram, worker, or deployment was changed.

## Window and headline

- **Period:** 2026-10-29T11:39:00Z to 2026-11-28T11:39:00Z UTC (the latest 30 days ending at the user message time).
- **Signals generated:** 34; **trades opened:** 30; **signals skipped:** 4.
- **Trades closed:** 30 (3 target hits; 27 forced liquidations).
- **Profitable closed trades after modeled costs:** 3.
- **Still open at cutoff:** 0.
- **Net realized account change:** -$6.7240; **final main balance:** $3.2760 (**-67.24%**).
- **Mark-to-market equity including open gross P&L:** $3.2760 (**-67.24%** from $10).
- **Entry and target-exit fees modeled:** $0.3536; **net funding received/(paid):** $0.0000.
- **Target completion duration:** fastest 14m 49.792s (SUSDT LONG, entry 2026-11-04T15:00:00Z, first target-cross trade 2026-11-04T15:14:49.792Z); slowest 1h 15m 1.191s (ADAUSDT SHORT, entry 2026-11-25T13:30:00Z, first target-cross trade 2026-11-25T14:45:01.191Z); average 35m 31.071s.
- **Maximum slots used:** 6 of 6.

| Pair | Signals | Opened | Skipped | Target closes | Liquidated | Profitable | Open | Closed net | Fees | Funding net | Open gross P&L |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SUSDT | 6 | 6 | 0 | 1 | 5 | 1 | 0 | -$0.7215 | $0.0738 | $0.0000 | $0.0000 |
| ETHUSDT | 1 | 0 | 1 | 0 | 0 | 0 | 0 | $0.0000 | $0.0000 | $0.0000 | $0.0000 |
| XRPUSDT | 3 | 3 | 0 | 0 | 3 | 0 | 0 | -$0.7171 | $0.0259 | $0.0000 | $0.0000 |
| LINKUSDT | 4 | 3 | 1 | 0 | 3 | 0 | 0 | -$1.2072 | $0.0436 | $0.0000 | $0.0000 |
| NEARUSDT | 8 | 8 | 0 | 0 | 8 | 0 | 0 | -$2.6762 | $0.0967 | $0.0000 | $0.0000 |
| BCHUSDT | 3 | 2 | 1 | 0 | 2 | 0 | 0 | -$0.8071 | $0.0292 | $0.0000 | $0.0000 |
| LTCUSDT | 1 | 0 | 1 | 0 | 0 | 0 | 0 | $0.0000 | $0.0000 | $0.0000 | $0.0000 |
| ADAUSDT | 3 | 3 | 0 | 1 | 2 | 1 | 0 | -$0.0391 | $0.0296 | $0.0000 | $0.0000 |
| BNBUSDT | 1 | 1 | 0 | 0 | 1 | 0 | 0 | -$0.2322 | $0.0084 | $0.0000 | $0.0000 |
| DOTUSDT | 4 | 4 | 0 | 1 | 3 | 1 | 0 | -$0.3236 | $0.0465 | $0.0000 | $0.0000 |

## Fastest target completions

Target completion time is the first Binance aggregate trade in the required aggressor direction that reaches the limit and has cumulative volume at least as large as the simulated position. This gives millisecond timestamps from the official historical trade archives; actual queue position and a personal account fill cannot be reconstructed. The attached CSV contains every closed trade; this table lists the 3 shortest target hits.

| # | Pair | Side | Entry UTC | Entry | Target-cross trade UTC | Limit fill assumption | Observed trade price | Duration | Margin | Target price | Net trade result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | SUSDT | LONG | 2026-11-04T15:00:00Z | 0.04153000000 | 2026-11-04T15:14:49.792Z | 0.04264000000 | 0.04264000000 | 14m 49.792s | $0.3865 | 0.04264000000 | $0.7543 |
| 2 | DOTUSDT | LONG | 2026-11-23T14:00:00Z | 0.6988000000 | 2026-11-23T14:16:42.229Z | 0.7175000000 | 0.7175000000 | 16m 42.229s | $0.2814 | 0.7175000000 | $0.5499 |
| 3 | ADAUSDT | SHORT | 2026-11-25T13:30:00Z | 0.1394000000 | 2026-11-25T14:45:01.191Z | 0.1356000000 | 0.1356000000 | 1h 15m 1.191s | $0.2268 | 0.1356000000 | $0.4518 |

## Rules and execution

- **Indicator:** the exact attached Pine v5 source, using its defaults without edits: close source; trend period 300; ATR 20; multiplier 2.2; Type A; no EMA smoothing; Big swings (confirmed); normal and strong Buy/Sell accepted; 10% big swing; 20-bar signal tolerance; 7% minimum favorable move.
- **Confirmation timing:** labels are drawn on the earlier signal candle, but the indicator's alert is delayed until pivot and minimum-run confirmation. Entries therefore occur at the first 1-minute Futures candle open after the alert. No entry is backdated to the label candle.
- **Pairs:** SUSDT, ETHUSDT, XRPUSDT, LINKUSDT, NEARUSDT, BCHUSDT, LTCUSDT, ADAUSDT, BNBUSDT, DOTUSDT only. Signals and execution use Binance USDⓈ-M Futures candles.
- **Account model:** $10 start; six simultaneous slots; each new trade requests 5% of the current main balance; 75x; quantity rounded down to the current exchange market step. The margin for the target calculation is the actual rounded notional divided by 75.
- **Target:** a resting limit target at 200% gross profit on allocated margin. Fees and funding reduce realized net results; they do not move the user's specified gross target.
- **Fees:** modeled as VIP-0 market taker 0.05% on entries and resting maker 0.02% on target exits, with no BNB/VIP discount. Binance's fees vary by account tier and the exchange lists commission, funding, and forced-liquidation clearance as distinct cost types; actual account-specific fees may differ ([fee schedule](https://www.binance.com/en/support/faq/detail/360033544231), [fee types](https://www.binance.com/en/support/faq/detail/98488a516eb84e3eb34605683dffd554)).
- **Funding and liquidation:** actual historical funding rates and published mark prices are applied. Public maintenance tiers are a current snapshot, not an archived tier history. A forced liquidation is an exchange event, not an added stop-loss; it is recorded separately. For this isolated-margin model, liquidation consumes remaining allocated collateral, capped at the position margin; no additional account-specific liquidation-clearance rate is separately assessed.
- **Parallel positions:** each slot is treated as an independent isolated position, so same-pair or opposite-direction alerts can coexist (hedge-mode assumption). The plan did not define a per-pair limit or one-way netting rule.
- **Balance:** fees and funding update the main balance as incurred; open unrealized P&L is excluded from that main-balance figure and shown separately as mark-to-market equity.

## Data integrity and limitations

- All requested symbols returned active USDⓈ-M perpetual contracts and complete data for the full execution window. Each pair has 43,200 of 43,200 last-price 1m bars and the same number of mark-price bars, plus 2,940 30m bars including 1500 pre-window warmup bars. No candles were interpolated or synthesized.
- Target hits and liquidations are first detected from 1-minute OHLC. If both target and liquidation fall inside the same minute, liquidation is chosen conservatively because candle data cannot establish event order. The three target hits were then checked against the official daily aggregate-trade archives, which provide millisecond crossing times and aggressor-side volume.
- Target completion time assumes a resting order fills once the first qualifying aggregate trade reaches the limit and its cumulative volume covers the simulated quantity. Order-book queue priority, partial-fill timing and personal account execution are unavailable; timestamps are therefore reproducible market-cross/fill-model times, not a claim about a real account fill.
- No market-order slippage, bid/ask spread, partial fills, or user-specific fee discount is invented. Actual fills may differ from candle opens and resting targets.
- The source was executed using the local PineTS interpreter against identical official Binance Futures candles; this is not an independent TradingView-exported alert parity certification. Pine runtime warnings: 0.
- Current Binance exchange lot/minimum-notional filters and maintenance tiers were used for this historical replay; they may differ from their exact historical values.
- Liquidation clearance is a distinct Binance charge, but its account/contract-specific rate is unavailable in this public historical dataset. The model caps isolated forced loss at allocated margin and does not add a separate clearance fee; liquidation results should therefore be treated as an estimate.

## Reproducibility

- Original indicator and plan are retained byte-for-byte in this research folder.
- Run: bun research/prompt-82/backtest.ts (uses the frozen, compressed Binance data); add --refresh to fetch the same fixed window again.
- Files: result.json (full signals, skipped entries, trade ledger, open positions, hashes), trades.csv (all closed and open trades), data/*.json.gz (frozen candles/funding), and data/aggTrades/ (official target-date tick archives).
- SHA-256 fingerprints of the source, plan, market data and exchange metadata are in result.json.
