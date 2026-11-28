# Q-Trend ZigZag Big Swings v9 — 30-day Binance Spot price research

**Research only.** No website, live Simulator, account settings, trade history, Telegram, worker, database, or deployment was changed.

## Window and outcome

- **Window:** 2026-10-29T13:33:00Z to 2026-11-28T13:33:00Z UTC, using only Binance Spot prices.
- **Signals:** 33 (19 LONG, 14 SHORT).
- **Opened:** 28; **completed:** 24; **target completed:** 15; **profitable closed:** 15; **liquidated positions:** 9; **open at cutoff:** 4.
- **Skipped because all six slots were full:** 3; **other skipped:** 2.
- **Gross winning PnL:** $7.3442; **gross losing PnL:** -$16.3551; **all modeled fees:** $0.8911 (entry $0.4517, target exits $0.2734, liquidation exits $0.1659).
- **Net realized change:** -$9.9020; **final main balance:** $0.0980 (-99.02%).
- **Open unrealized gross PnL:** -$0.0616; **marked account equity:** $0.0364 (-99.64% return including open positions).
- **Maximum marked-equity drawdown:** 99.76%; **lowest minute-close equity:** $0.0285; **maximum slots used:** 6/6.
- **At cutoff:** shared available collateral $0.0182; maintenance requirement $0.0065; maintenance headroom $0.0299.

## Attached screenshot signal and executable entry

NO EXACT MATCH: expected STRONG BUY 1.1473; nearest same-direction source label was STRONG BUY 1.2473 at 2026-10-30T03:30:00Z. The backdated label time and display price are recorded separately from the later confirmed alert and 1m entry; entries occur only once confirmation is knowable.

| Coin | Side | Expected label | Closest source label | Exact match | Label candle UTC | Alert confirmed UTC | Entry UTC | Entry price |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| XRPUSDT | LONG | STRONG BUY 1.1473 | STRONG BUY 1.2473 | NO | 2026-10-30T03:30:00Z | 2026-11-04T15:30:00Z | 2026-11-04T15:30:00Z | 1.3242 |

**History boundary:** the replay uses 14,475 warmup 30m candles beginning 2026-01-01T00:00:00Z. Q-Trend's state depends on the start of loaded chart history, so exact TradingView alerts beyond the screenshot-visible signal cannot be independently certified without an exported TradingView alert list.

## Target completion times

- **Fastest:** NEARUSDT LONG: 2026-11-04T15:00:00Z at 4.150000000 → 2026-11-04T15:13:42.662Z at 4.260666667 (822.662 seconds)
- **Slowest:** LINKUSDT SHORT: 2026-11-04T03:00:00Z at 10.73000000 → 2026-11-08T21:53:03.222Z at 10.44386667 (413583.222 seconds)
- **Average:** 64629.029 seconds; **median:** 16478.023 seconds.
- **Targets completed within:** 30 minutes 5; 1 hour 5; 4 hours 7; 12 hours 11; 24 hours 12.

| Trade | Coin | Side | Entry UTC | Entry price | Initial margin | Target gross profit | Target UTC | Target price | Duration | Gross PnL | Fees | Net PnL |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Q84-0001 | BCHUSDT | SHORT | 2026-10-29T21:00:00Z | 270.7000000 | 0.5 | 1 | 2026-10-30T00:31:25.147Z | 263.4813333 | 12685.147 seconds | $1.0000 | $0.0740 | $0.9260 |
| Q84-0003 | NEARUSDT | SHORT | 2026-11-02T07:00:00Z | 4.117000000 | 0.5442513749999999 | 1.0885027499999997 | 2026-11-02T15:58:21.811Z | 4.007213333 | 32301.811 seconds | $1.0885 | $0.0805 | $1.0080 |
| Q84-0007 | NEARUSDT | LONG | 2026-11-04T15:00:00Z | 4.150000000 | 0.5879843058847924 | 1.175968611769585 | 2026-11-04T15:13:42.662Z | 4.260666667 | 822.662 seconds | $1.1760 | $0.0894 | $1.0866 |
| Q84-0006 | SUSDT | LONG | 2026-11-04T15:00:00Z | 0.04162000000 | 0.5901975466848607 | 1.1803950933697214 | 2026-11-04T15:14:49.788Z | 0.04272986667 | 889.788 seconds | $1.1804 | $0.0897 | $1.0907 |
| Q84-0005 | BCHUSDT | SHORT | 2026-11-04T03:00:00Z | 267.3000000 | 0.592419118378781 | 1.184838236757562 | 2026-11-07T09:52:28.086Z | 260.1720000 | 283948.086 seconds | $1.1848 | $0.0877 | $1.0972 |
| Q84-0004 | LINKUSDT | SHORT | 2026-11-04T03:00:00Z | 10.73000000 | 0.5946490523249998 | 1.1892981046499995 | 2026-11-08T21:53:03.222Z | 10.44386667 | 413583.222 seconds | $1.1893 | $0.0880 | $1.1013 |
| Q84-0010 | NEARUSDT | SHORT | 2026-11-12T13:00:00Z | 3.408000000 | 0.028797734745008043 | 0.05759546949001609 | 2026-11-13T03:51:22.235Z | 3.317120000 | 53482.235 seconds | $0.0576 | $0.0043 | $0.0533 |
| Q84-0011 | NEARUSDT | SHORT | 2026-11-20T02:00:00Z | 3.084000000 | 0.031464404982395784 | 0.06292880996479157 | 2026-11-20T09:01:46.565Z | 3.001760000 | 25306.565 seconds | $0.0629 | $0.0047 | $0.0583 |
| Q84-0012 | XRPUSDT | SHORT | 2026-11-20T16:00:00Z | 0.9105000000 | 0.03437800888376564 | 0.06875601776753128 | 2026-11-20T20:34:38.023Z | 0.8862200000 | 16478.023 seconds | $0.0688 | $0.0051 | $0.0637 |
| Q84-0013 | NEARUSDT | LONG | 2026-11-22T09:00:00Z | 2.922000000 | 0.03756141250640233 | 0.07512282501280466 | 2026-11-22T10:55:14.272Z | 2.999920000 | 6914.272 seconds | $0.0751 | $0.0057 | $0.0694 |
| Q84-0014 | SUSDT | LONG | 2026-11-23T14:00:00Z | 0.02908000000 | 0.04103208702199392 | 0.08206417404398784 | 2026-11-23T14:16:11.541Z | 0.02985546667 | 971.541 seconds | $0.0821 | $0.0062 | $0.0758 |
| Q84-0016 | XRPUSDT | LONG | 2026-11-23T14:00:00Z | 0.9882000000 | 0.04072492338305271 | 0.08144984676610542 | 2026-11-23T14:25:32.145Z | 1.014552000 | 1532.145 seconds | $0.0814 | $0.0062 | $0.0753 |
| Q84-0019 | ADAUSDT | LONG | 2026-11-23T14:00:00Z | 0.1517000000 | 0.04026848393009521 | 0.08053696786019042 | 2026-11-23T14:25:56.043Z | 0.1557453333 | 1556.043 seconds | $0.0805 | $0.0061 | $0.0744 |
| Q84-0023 | NEARUSDT | LONG | 2026-11-26T00:30:00Z | 3.080000000 | 0.004195223898220877 | 0.008390447796441753 | 2026-11-27T02:26:21.787Z | 3.162133333 | 93381.787 seconds | $0.0084 | $0.0006 | $0.0078 |
| Q84-0025 | LINKUSDT | LONG | 2026-11-26T22:00:00Z | 9.403000000 | 0.004163818714320289 | 0.008327637428640578 | 2026-11-27T05:06:22.110Z | 9.653746667 | 25582.110 seconds | $0.0083 | $0.0006 | $0.0077 |

## Coin-wise results

Coins are ranked by closed net result plus open gross mark-to-market less entry fees; open positions are shown separately in the ledger.

| Rank | Coin | Signals | LONG | SHORT | Opened | Completed | Target hit | Profitable closed | Liquidated | Open | Net incl. open mark | Avg. target time |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | NEARUSDT | 7 | 3 | 4 | 7 | 7 | 6 | 6 | 1 | 0 | $1.9912 | 35368.222 seconds |
| 2 | BCHUSDT | 4 | 2 | 2 | 4 | 3 | 2 | 2 | 1 | 1 | $1.9436 | 148316.617 seconds |
| 3 | ADAUSDT | 3 | 2 | 1 | 2 | 1 | 1 | 1 | 0 | 1 | $0.0615 | 1556.043 seconds |
| 4 | LTCUSDT | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | $0.0000 | N/A |
| 5 | BNBUSDT | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | $0.0000 | N/A |
| 6 | DOTUSDT | 2 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | $0.0000 | N/A |
| 7 | ETHUSDT | 2 | 1 | 1 | 2 | 2 | 0 | 0 | 2 | 0 | -$0.3178 | N/A |
| 8 | SUSDT | 5 | 3 | 2 | 5 | 4 | 2 | 2 | 2 | 1 | -$2.2287 | 930.664 seconds |
| 9 | LINKUSDT | 4 | 3 | 1 | 4 | 4 | 2 | 2 | 2 | 0 | -$2.7782 | 219582.666 seconds |
| 10 | XRPUSDT | 5 | 3 | 2 | 4 | 3 | 2 | 2 | 1 | 1 | -$8.6353 | 9005.084 seconds |

## Cross-margin liquidation review

- **Account-level liquidation events:** 2; every event closes all positions open at the breach, rather than liquidating each position in isolation.
- **Synthetic maintenance requirement:** 0.5% of total marked open notional. This is an explicit modeling assumption because Binance Spot does not offer 75x cross margin; it is not an exchange rule.
- **Shared available collateral** below means account equity less the open positions' allocated initial margin; maintenance headroom is equity less the synthetic maintenance requirement. The account-level liquidation test uses all wallet equity and all open-position unrealized PnL as shared support.

| Event | UTC | Trigger symbol(s) | Equity before | Shared available collateral | Initial margin reserved | Combined exposure | Maintenance | Maintenance headroom | Affected positions | Target touched at same timestamp |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Q84-L001 | 2026-11-09T13:02:25.783Z | SUSDT | $0.7208 | -$1.3354 | $2.0562 | $144.8614 | $0.7243 | -$0.0035 | Q84-0002 LINKUSDT LONG; Q84-0008 XRPUSDT LONG; Q84-0009 SUSDT SHORT | None |
| Q84-L002 | 2026-11-25T20:17:46.421Z | NEARUSDT | $0.1049 | -$0.1719 | $0.2768 | $21.0120 | $0.1051 | -$0.0001 | Q84-0015 ETHUSDT LONG; Q84-0017 LINKUSDT LONG; Q84-0018 BCHUSDT LONG; Q84-0020 SUSDT SHORT; Q84-0021 NEARUSDT SHORT; Q84-0022 ETHUSDT SHORT | None |

**Target/liquidation audit:** 9 positions were liquidated; 0 had an earlier target-price trade; 0 had a target trade in the same millisecond as the account breach. Earlier target touches are a hard failure; same-millisecond order remains conservative because Spot data cannot establish which event came first.

## Method and limitations

- The newly attached Pine v5 source was preserved unchanged. PineTS ran its confirmed Big Swings alerts on Binance Spot 30m candles with 14,475 warmup bars from 2026-01-01T00:00:00Z. The actual backdated label bar and displayed close price are recorded, but never used as the executable entry.
- Entry occurs at the first 1m Spot candle open at the alert confirmation time. Quantity is continuous synthetic exposure: 5% of then-current main balance × 75 ÷ entry price. No actual Spot order, Futures price, exchange leverage tier, or minimum-order filter is used.
- A target is fixed at gross profit equal to 200% of the initial entry margin, before fees. Any actual Spot aggregate-trade price at or through the target triggers a full synthetic close at the target; the prior backtest's aggressor-direction and volume gates are intentionally removed. Actual queue priority and personal account fills cannot be reconstructed.
- Baseline Spot fees are 0.10% per side; personal discounts are unknown. No borrowing interest is charged because the 75x position is synthetic, not a Binance Margin loan. No spread/slippage is invented.
- 1m candles screen for possible exits. Every candidate minute is resolved by time-ordered official Spot aggregate trades for all open symbols; a candle wick without supporting trade-price evidence aborts the run. At the same millisecond, a cross-maintenance breach is checked before target fills. A runtime invariant rejects any liquidation after an earlier target-price trade.
- Cross margin is modeled portfolio-wide: equity is wallet balance plus all unrealized PnL; maintenance is the stated synthetic rate over combined marked notional. When breached, every open position is closed at the latest observed Spot prices. The chosen maintenance rate and lack of an actual 75x Spot product mean this is a reproducible scenario, not an exchange-certified liquidation model.
- The screenshot-visible label is compared with the exact text, direction, and price produced by the attached Pine source and frozen Binance Spot candles; any mismatch is shown rather than tuned away. This local PineTS comparison is not independent TradingView-exported verification. Candle coverage and all input hashes are retained with the result.

## Reproducibility

- Complete trade ledger: trades.csv; all confirmed signals and skipped outcomes: signals.csv; machine-readable details, equity series, per-coin ranking, liquidation events, and the target/liquidation audit: result.json.
- Input source hashes and detailed aggregate-trade archive list are in result.json. Frozen candles are under data/ and may be rechecked with bun research/prompt-84/backtest.ts.
