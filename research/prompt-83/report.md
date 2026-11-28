# Q-Trend ZigZag Big Swings v8 — 30-day Binance Spot price research

**Research only.** No website, live Simulator, account settings, trade history, Telegram, worker, database, or deployment was changed.

## Window and outcome

- **Window:** 2026-10-29T12:03:00Z to 2026-11-28T12:03:00Z UTC, using only Binance Spot prices.
- **Signals:** 38 (21 LONG, 17 SHORT).
- **Opened:** 35; **target completed:** 17; **profitable closed:** 18; **liquidated positions:** 14; **open at cutoff:** 4.
- **Skipped because all six slots were full:** 2; **other skipped:** 1.
- **Gross winning PnL:** $7.0098; **gross losing PnL:** -$16.0853; **all modeled fees:** $0.9166 (entry $0.4668, target exits $0.2510, liquidation exits $0.1989).
- **Net realized change:** -$9.9922; **final main balance:** $0.0078 (-99.92%).
- **Open unrealized gross PnL:** -$0.0043; **marked account equity:** $0.0035 (-99.97% return including open positions).
- **Maximum marked-equity drawdown:** 99.98%; **lowest minute-close equity:** $0.0023; **maximum slots used:** 6/6.
- **At cutoff:** shared available collateral $0.0020; maintenance requirement $0.0005; maintenance headroom $0.0030.

## Original screenshot labels and executable entries

The label timestamp and tick-formatted close price are recorded separately from the later confirmed alert and the 1m entry. The five visible LINK/NEAR labels in the supplied screenshots match the original Pine label text, direction, and displayed prices. The report enters only at alert confirmation; entering at an older label would use information that was not yet known.

| Coin | Side | Displayed label | Label candle UTC | Label price | Alert bar open UTC | Alert confirmed UTC | Entry UTC | Entry price |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| LINKUSDT | LONG | STRONG BUY 10.811 | 2026-10-30T03:00:00Z | 10.811 | 2026-10-31T00:00:00Z | 2026-10-31T00:30:00Z | 2026-10-31T00:30:00Z | 11.676 |
| LINKUSDT | SHORT | STRONG SELL 11.695 | 2026-10-31T23:00:00Z | 11.695 | 2026-11-04T02:30:00Z | 2026-11-04T03:00:00Z | 2026-11-04T03:00:00Z | 10.73 |
| NEARUSDT | SHORT | SELL 4.486 | 2026-10-29T01:30:00Z | 4.486 | 2026-10-29T20:30:00Z | 2026-10-29T21:00:00Z | 2026-10-29T21:00:00Z | 4.173 |
| NEARUSDT | SHORT | SELL 4.441 | 2026-10-31T19:30:00Z | 4.441 | 2026-11-02T06:30:00Z | 2026-11-02T07:00:00Z | 2026-11-02T07:00:00Z | 4.117 |
| NEARUSDT | LONG | STRONG BUY 3.886 | 2026-11-04T05:30:00Z | 3.886 | 2026-11-04T14:30:00Z | 2026-11-04T15:00:00Z | 2026-11-04T15:00:00Z | 4.15 |

**History boundary:** the replay uses 14,472 warmup 30m candles beginning 2026-01-01T00:00:00Z. This frozen boundary matches the supplied screenshot labels. The prior 1,500-bar run produced a NEAR LONG at 2026-10-31 16:00 UTC / 4.479 and omitted the screenshot's SELL 4.441; that LONG is absent from this corrected ledger. Q-Trend's state depends on the start of its loaded chart history, so exact TradingView alerts beyond the screenshot-visible labels cannot be certified without an exported TradingView alert list.

## Target completion times

- **Fastest:** NEARUSDT LONG: 2026-11-04T15:00:00Z at 4.150000000 → 2026-11-04T15:13:42.662Z at 4.260666667 (822.662 seconds)
- **Slowest:** SUSDT SHORT: 2026-11-08T22:00:00Z at 0.03519000000 → 2026-11-14T15:20:45.207Z at 0.03425160000 (494445.207 seconds)
- **Average:** 67179.349 seconds; **median:** 16478.023 seconds.
- **Targets completed within:** 30 minutes 5; 1 hour 5; 4 hours 8; 12 hours 12; 24 hours 13.

| Trade | Coin | Side | Entry UTC | Entry price | Target UTC | Target price | Duration | Gross PnL | Fees | Net PnL |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Q83-0001 | NEARUSDT | SHORT | 2026-10-29T21:00:00Z | 4.173000000 | 2026-10-29T23:08:23.069Z | 4.061720000 | 7703.069 seconds | $1.0000 | $0.0740 | $0.9260 |
| Q83-0002 | BCHUSDT | SHORT | 2026-10-29T21:00:00Z | 270.7000000 | 2026-10-30T00:31:25.147Z | 263.4813333 | 12685.147 seconds | $0.9962 | $0.0737 | $0.9225 |
| Q83-0005 | NEARUSDT | SHORT | 2026-11-02T07:00:00Z | 4.117000000 | 2026-11-02T15:58:21.811Z | 4.007213333 | 32301.811 seconds | $1.1760 | $0.0870 | $1.0890 |
| Q83-0008 | NEARUSDT | LONG | 2026-11-04T15:00:00Z | 4.150000000 | 2026-11-04T15:13:42.662Z | 4.260666667 | 822.662 seconds | $1.2753 | $0.0969 | $1.1783 |
| Q83-0007 | SUSDT | LONG | 2026-11-04T15:00:00Z | 0.04162000000 | 2026-11-04T15:14:49.788Z | 0.04272986667 | 889.788 seconds | $1.2801 | $0.0973 | $1.1828 |
| Q83-0010 | SUSDT | SHORT | 2026-11-05T16:00:00Z | 0.03736000000 | 2026-11-08T21:47:52.878Z | 0.03636373333 | 280072.878 seconds | $0.0680 | $0.0050 | $0.0629 |
| Q83-0011 | DOTUSDT | SHORT | 2026-11-07T21:30:00Z | 0.8820000000 | 2026-11-08T21:55:23.369Z | 0.8584800000 | 87923.369 seconds | $0.0677 | $0.0050 | $0.0627 |
| Q83-0013 | NEARUSDT | SHORT | 2026-11-12T13:00:00Z | 3.408000000 | 2026-11-13T03:51:22.235Z | 3.317120000 | 53482.235 seconds | $0.0802 | $0.0059 | $0.0743 |
| Q83-0012 | SUSDT | SHORT | 2026-11-08T22:00:00Z | 0.03519000000 | 2026-11-14T15:20:45.207Z | 0.03425160000 | 494445.207 seconds | $0.0805 | $0.0060 | $0.0746 |
| Q83-0014 | NEARUSDT | SHORT | 2026-11-20T02:00:00Z | 3.084000000 | 2026-11-20T09:01:46.565Z | 3.001760000 | 25306.565 seconds | $0.0954 | $0.0071 | $0.0884 |
| Q83-0015 | XRPUSDT | SHORT | 2026-11-20T16:00:00Z | 0.9105000000 | 2026-11-20T20:34:38.023Z | 0.8862200000 | 16478.023 seconds | $0.1042 | $0.0077 | $0.0965 |
| Q83-0016 | NEARUSDT | LONG | 2026-11-22T09:00:00Z | 2.922000000 | 2026-11-22T10:55:14.272Z | 2.999920000 | 6914.272 seconds | $0.1139 | $0.0087 | $0.1052 |
| Q83-0017 | SUSDT | LONG | 2026-11-23T14:00:00Z | 0.02908000000 | 2026-11-23T14:16:11.820Z | 0.02985546667 | 971.820 seconds | $0.1244 | $0.0095 | $0.1150 |
| Q83-0019 | XRPUSDT | LONG | 2026-11-23T14:00:00Z | 0.9882000000 | 2026-11-23T14:25:32.145Z | 1.014552000 | 1532.145 seconds | $0.1235 | $0.0094 | $0.1141 |
| Q83-0022 | ADAUSDT | LONG | 2026-11-23T14:00:00Z | 0.1517000000 | 2026-11-23T14:25:56.043Z | 0.1557453333 | 1556.043 seconds | $0.1221 | $0.0093 | $0.1128 |
| Q83-0030 | NEARUSDT | LONG | 2026-11-26T00:30:00Z | 3.080000000 | 2026-11-27T02:26:21.787Z | 3.162133333 | 93381.787 seconds | $0.0007 | $0.0001 | $0.0006 |
| Q83-0032 | LINKUSDT | LONG | 2026-11-26T22:00:00Z | 9.403000000 | 2026-11-27T05:06:22.110Z | 9.653746667 | 25582.110 seconds | $0.0007 | $0.0001 | $0.0006 |

## Coin-wise results

Coins are ranked by closed net result plus open gross mark-to-market less entry fees; open positions are shown separately in the ledger.

| Rank | Coin | Signals | LONG | SHORT | Opened | Target hit | Profitable closed | Liquidated | Open | Net incl. open mark | Avg. target time |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | NEARUSDT | 8 | 3 | 5 | 8 | 7 | 7 | 1 | 0 | $3.4505 | 31416.057 seconds |
| 2 | BCHUSDT | 4 | 2 | 2 | 3 | 1 | 1 | 1 | 1 | $0.6344 | 12685.147 seconds |
| 3 | ADAUSDT | 3 | 2 | 1 | 3 | 1 | 1 | 1 | 1 | $0.0982 | 1556.043 seconds |
| 4 | DOTUSDT | 3 | 1 | 2 | 2 | 1 | 1 | 1 | 0 | $0.0479 | 87923.369 seconds |
| 5 | BNBUSDT | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | $0.0000 | N/A |
| 6 | ETHUSDT | 2 | 1 | 1 | 2 | 0 | 0 | 2 | 0 | -$0.4500 | N/A |
| 7 | LTCUSDT | 1 | 1 | 0 | 1 | 0 | 0 | 1 | 0 | -$0.4663 | N/A |
| 8 | XRPUSDT | 5 | 3 | 2 | 5 | 2 | 2 | 2 | 1 | -$3.3860 | 9005.084 seconds |
| 9 | LINKUSDT | 4 | 3 | 1 | 4 | 1 | 2 | 3 | 0 | -$4.0368 | 25582.110 seconds |
| 10 | SUSDT | 7 | 4 | 3 | 7 | 4 | 4 | 2 | 1 | -$5.8883 | 194094.923 seconds |

## Cross-margin liquidation review

- **Account-level liquidation events:** 3; every event closes all positions open at the breach, rather than liquidating each position in isolation.
- **Synthetic maintenance requirement:** 0.5% of total marked open notional. This is an explicit modeling assumption because Binance Spot does not offer 75x cross margin; it is not an exchange rule.
- **Shared available collateral** below means account equity less the open positions' allocated initial margin; maintenance headroom is equity less the synthetic maintenance requirement. The account-level liquidation test uses all wallet equity and all open-position unrealized PnL as shared support.

| Event | UTC | Trigger symbol(s) | Equity before | Shared available collateral | Initial margin reserved | Combined exposure | Maintenance | Maintenance headroom | Affected positions |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Q83-L001 | 2026-11-05T15:52:11.321Z | SUSDT, XRPUSDT | $0.8585 | -$1.7246 | $2.5832 | $178.8887 | $0.8944 | -$0.0359 | Q83-0003 SUSDT LONG; Q83-0004 LINKUSDT LONG; Q83-0006 LINKUSDT SHORT; Q83-0009 XRPUSDT LONG |
| Q83-L002 | 2026-11-25T07:36:50.071Z | ETHUSDT, LINKUSDT | $0.0913 | -$0.1721 | $0.2634 | $18.2793 | $0.0914 | -$0.0001 | Q83-0018 ETHUSDT LONG; Q83-0020 LINKUSDT LONG; Q83-0021 BCHUSDT LONG; Q83-0023 LTCUSDT LONG |
| Q83-L003 | 2026-11-25T18:16:13.269Z | NEARUSDT | $0.0084 | -$0.0133 | $0.0217 | $1.6904 | $0.0085 | -$0.0001 | Q83-0024 SUSDT SHORT; Q83-0025 NEARUSDT SHORT; Q83-0026 ADAUSDT SHORT; Q83-0027 DOTUSDT SHORT; Q83-0028 ETHUSDT SHORT; Q83-0029 XRPUSDT SHORT |

## Method and limitations

- The attached Pine v5 source was preserved unchanged. PineTS ran its confirmed Big Swings alerts on Binance Spot 30m candles with 14,472 warmup bars from 2026-01-01T00:00:00Z. The actual backdated label bar and displayed close price are recorded, but never used as the executable entry.
- Entry occurs at the first 1m Spot candle open at the alert confirmation time. Quantity is continuous synthetic exposure: 5% of then-current main balance × 75 ÷ entry price. No actual Spot order, Futures price, exchange leverage tier, or minimum-order filter is used.
- A target is fixed at gross profit equal to 200% of the initial entry margin, before fees. Target executions are checked against Spot aggregate-trade prices and correctly directed trade volume. Actual queue priority and personal account fills cannot be reconstructed.
- Baseline Spot fees are 0.10% per side; personal discounts are unknown. No borrowing interest is charged because the 75x position is synthetic, not a Binance Margin loan. No spread/slippage is invented.
- 1m candles screen for possible exits. Every candidate minute is resolved by time-ordered official Spot aggregate trades for all open symbols; missing detail stops the run instead of granting a favorable exit. At the same millisecond, a cross-maintenance breach is checked before target fills.
- Cross margin is modeled portfolio-wide: equity is wallet balance plus all unrealized PnL; maintenance is the stated synthetic rate over combined marked notional. When breached, every open position is closed at the latest observed Spot prices. The chosen maintenance rate and lack of an actual 75x Spot product mean this is a reproducible scenario, not an exchange-certified liquidation model.
- The screenshot labels are checked against the exact text, direction, and price produced by the intact Pine source and frozen Binance Spot candles. This local PineTS comparison is not independent TradingView-exported verification; Q-Trend's persistent state is history-start-sensitive, so the same 30-day candles can produce different results with a different loaded-history boundary. Candle coverage and all input hashes are retained with the result.

## Reproducibility

- Complete trade ledger: trades.csv; all confirmed signals and skipped outcomes: signals.csv; machine-readable details, equity series, per-coin ranking and liquidation events: result.json.
- Input source hashes and detailed aggregate-trade archive list are in result.json. Frozen candles are under data/ and may be rechecked with bun research/prompt-83/backtest.ts.
