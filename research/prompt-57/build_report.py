import json, hashlib, numpy as np, pandas as pd
O = '/tmp/r57/out'
V = json.load(open(f'{O}/validation.json')); Q = json.load(open(f'{O}/oos.json')); R = json.load(open(f'{O}/robustness.json'))
sel = json.load(open('selection-frozen.json')); proto = json.load(open('protocol.json'))
T = pd.read_csv(f'{O}/all-trades.csv')
def f(x, d=2, pct=False):
    if x is None or (isinstance(x, float) and np.isnan(x)): return '–'
    return f'{x*100:.{d}f}%' if pct else f'{x:,.{d}f}'
NM = {'A_sweep': 'A Liquidity sweep + reclaim', 'B_ema_momentum': 'B EMA trend + RSI momentum pullback', 'C_vwap_volume': 'C VWAP reclaim + volume/taker flow',
      'D_rsi_macd_vol': 'D RSI/MACD reversal + volatility band', 'E_mtf_price_action': 'E Multi-timeframe trend + engulfing',
      'F_fvg_orderflow': 'F Fair-value-gap retrace', 'I_momentum_regime': 'I 3-day momentum + calm volatility (data-mined)',
      'G_hybrid_score': 'G Hybrid confidence score (logistic)', 'H_live_obvp': 'H Your live OB + Weighted VP indicator'}
L = []; w = L.append
w('# prompt-57 — Independent entry-strategy research (75x, +25% margin target, 6 slots × 5%, 12 coins)\n')
w('**Research only.** Nothing in the live Simulator, scanner, database, balance, slots or Telegram was changed, activated or published. All results come from real Binance USD-M Futures history replayed offline.\n')
w('## Bottom line\n')
w('**No strategy passed the validation requirements.** Every one of the 9 strategy families (139 parameter sets plus a hybrid confidence model) lost money after costs on the October validation period, and 8 of 9 also lost on the unseen Oct 26 – Nov 18 period. None beat random entries by a statistically meaningful margin in both test periods. I am not recommending any of them for paper trading in their current form.\n')
w('The reason is structural, not a missing indicator. At 75x a +25% margin target needs only a **0.474% price move** (after 0.05% fees and 0.02% slippage on each side), while any loss limit that protects the account sits **2–4% away**. With no stop-loss, a winning trade earns +25% of margin but a losing one costs 100–300% of margin (or the whole account at liquidation). The break-even win rate is therefore **80–92%**, and random entries already hit the target first about **84–86%** of the time. A strategy needs a lasting edge of roughly 4–6 extra percentage points of win rate. The best candidates found 1–3 points in some weeks and lost them in others.\n')
w('## 1. Data and setup\n')
w(f"- Window: {proto['data']['window_utc'][0]} → {proto['data']['window_utc'][1]} (110 days), all 12 coins, **zero missing 1-minute candles** and zero missing mark-price candles (158,400 per coin).")
w('- Data: Binance Futures 1m candles + taker-buy volume, 1m **mark-price** candles, 8-hour funding rates, 5-minute open interest (data.binance.vision archives, fapi funding for November), Binance public leverage/maintenance-margin brackets, exchange lot rules. Your live OB+VP indicator was replayed unchanged on Binance **spot** 5m candles (same as live) and traded on futures prices. SHA-256 of every raw file is saved in `raw-file-hashes.json`.')
w('- Market conditions: **development Aug 1 – Sep 30 was a strong bull market** (BTC +33%, SOL +62%, AVAX +71%); **validation Oct 1 – 25 a mild bear** (BTC −4%, AVAX −18%); **unseen Oct 26 – Nov 18 a strong bear** (BTC −21%, ETH −24%, SOL −27%). That is a good stress test across regimes.')
w('- Rules: 75x, 6 slots, margin = 5% of the wallet at entry, one trade per coin, cross margin, no stop-loss, no time close. Entry fills at the open of the 1-minute candle starting **60 seconds after** the 5m signal close, plus slippage — never the signal close. Target fills when the 1m high/low reaches the trigger. Funding charged at actual rates. Account liquidation checked every minute on the worst mark price against Binance tier-1 maintenance margin (0.4% BTC/ETH, 0.5% most coins, 0.65% DOGE, 1.0% NEAR). Ties within one minute are always resolved against the trade.')
w('- Emergency exit (research only, required by you): close a position when its loss incl. costs reaches **2× its margin** (= 10% of the wallet, ≈2.6% adverse price). Sensitivity also run at 1×, 3× and none. Emergency exits are counted as losses, never wins.')
w('- Research balance $1,000 (so every coin meets Binance minimums). **Your real Simulator balance is $10.64:** 5% = $0.53 margin = $39.9 position, which is below Binance\'s minimum order for BTC ($50 and 0.001 BTC) — BTC trades could not be placed on a real account at that size.\n')
w('### Margin ROI vs price movement (75x)\n')
w('| | Margin ROI | Price move needed |\n|---|---|---|')
w('| Target (net of fees + slippage) | +25% | **+0.474%** in your favour |')
w('| Fees + slippage per round trip | −10.5% of margin | 0.14% of position |')
w('| Emergency 1× / 2× / 3× | −100% / −200% / −300% | ≈1.3% / ≈2.6% / ≈3.9% against |')
w('| Isolated-margin liquidation (75x, 0.5% MMR) | −100% | ≈0.83% against |')
w('| Cross margin, 6 trades open, all moving together | whole account | ≈3.9–4.4% against |\n')
w('Break-even win rate = loss ÷ (loss + 0.25): **80% at 1×, 89% at 2×, 92% at 3×**.\n')
w('## 2. Method (registered before any result)\n')
w(f"- Protocol `protocol.json` (sha256 {hashlib.sha256(open('protocol.json','rb').read()).hexdigest()[:16]}…) fixed periods, costs and pass rules first.")
w('- Development (Aug–Sep): every parameter set of every family tested; the best per family (≥175 trades) kept. Development trades still open on Sep 30 were treated as unresolved, so no October price leaked in.')
w('- Validation (Oct 1–25): family winners ranked; selection frozen in `selection-frozen.json` and committed to git **before** the unseen period was read.')
w('- Unseen out-of-sample (Oct 26 – Nov 18): evaluated once, no tuning afterwards.')
w('- Walk-forward: 6 folds, re-select on the previous 28 days, test the next 14 days.')
w('- Costed coin-flip baseline: random side at random 5m closes with the same exits, 100 seeds per period.')
w('- Two research rounds: round 1 = families A–F + your live indicator; round 2 = analysis of why trades failed (51,373 development candidates), which produced family I (3-day momentum + calm volatility) and G (logistic confidence score over 18 market features + family flags, fitted on development only).\n')
w('## 3. Research comparison (portfolio: 6 slots × 5%, 75x, emergency 2×, $1,000 start)\n')
w('| Strategy | Dev pick | Val trades | Val win | Val net | Val weeks ≥20? | OOS trades | OOS win | OOS net | OOS max DD | Walk-forward +folds |')
w('|---|---|---|---|---|---|---|---|---|---|---|')
for n in sel['dev_picks']:
    v, q = V[n], Q[n]; wf = R['walk_forward'][n]
    pos = sum(1 for x in wf if (x.get('net') or 0) > 0)
    w(f"| {NM[n]} | `{json.dumps(sel['dev_picks'][n])}` | {v['portfolio']['completed']} | {f(v['portfolio']['win_rate'],1,True)} | ${f(v['portfolio']['net'])} | {'yes' if all(b['completed']>=20 for b in v['batches']) else 'no'} {[b['completed'] for b in v['batches']]} | {q['portfolio']['completed']} | {f(q['portfolio']['win_rate'],1,True)} | ${f(q['portfolio']['net'])} | {f(q['max_dd'],1,True)} | {pos}/6 |")
w('\n**Entry quality, one trade per coin, no slot limit (net margin per trade, emergency 2×):**\n')
w('| Strategy | Dev win / per trade | Val win / per trade | OOS win / per trade |\n|---|---|---|---|')
cf = R['coinflip']
w(f"| Coin-flip baseline (mean; 95th pct) | {f(cf['dev']['win_mean'],1,True)} / {f(cf['dev']['per_trade_mean']*100,1)}% ({f(cf['dev']['per_trade_p95']*100,1)}%) | {f(cf['validation']['win_mean'],1,True)} / {f(cf['validation']['per_trade_mean']*100,1)}% ({f(cf['validation']['per_trade_p95']*100,1)}%) | {f(cf['oos']['win_mean'],1,True)} / {f(cf['oos']['per_trade_mean']*100,1)}% ({f(cf['oos']['per_trade_p95']*100,1)}%) |")
for n in sel['dev_picks']:
    c = R['chain'][n]
    cell = lambda p: f"{f(c[p]['win_rate'],1,True)} / {f((c[p]['per_trade'] or 0)*100,1)}% (n={c[p]['completed']})"
    w(f"| {NM[n]} | {cell('dev')} | {cell('validation')} | {cell('oos')} |")
w('\nPer-trade values are % of that trade\'s margin. To pass, a strategy had to beat the coin-flip 95th percentile in the unseen period. In the unseen bear market **B (+1.9%), I (+2.5%) and C (−0.4%)** beat that line on entry quality, but in validation all three were at or below random (−8% to −12% per trade), and once the 6-slot account was applied only I finished the unseen period positive (+$11, +1.1%) after a 56% drawdown.\n')
s = sel['selected']; v, q = V[s], Q[s]
w(f"## 4. Best candidate under the frozen protocol: {NM[s]}\n")
w('Chosen because it had the smallest validation loss among families with ≥20 trades in every week. **It did not pass** (validation and unseen both negative). Exact rules, for the record:\n')
w('- **Timeframes:** signal on closed Binance Futures 5m candles; trend filter on the last closed 4h candle.')
w('- **Session VWAP:** typical price × volume, reset every UTC midnight.')
w('- **LONG:** previous 5m close below its VWAP AND this 5m close above VWAP AND volume ≥ 2.0× the average of the previous 20 candles AND taker flow (2×taker-buy − volume) ÷ volume > +0.30 AND 4h close above 4h EMA50 with EMA50 higher than 6 candles ago.')
w('- **SHORT:** mirror: close crosses below VWAP, volume ≥ 2.0×, taker flow < −0.30, 4h close below a falling 4h EMA50.')
w('- **Skip:** coin already open, all 6 slots used, 4h trend not aligned, volume or taker flow below threshold.')
w('- **Exit:** +25% net margin target; emergency at 2× margin loss (research only).\n')
w('## 5. Full statistics — best candidate and your live indicator\n')
def block(name, st, rr, title):
    w(f'**{title}**\n'); w('| Metric | Value |\n|---|---|')
    rows = [('Completed trades', st['completed']), ('Winning / losing', f"{st['wins']} / {st['losses']}"), ('Win rate', f(st['win_rate'], 1, True)),
            ('Gross profit / gross loss', f"${f(st['gross_profit'])} / ${f(st['gross_loss'])}"), ('Net profit after all costs', f"${f(st['net'])}"),
            ('Average win / average loss', f"${f(st['avg_win'])} / ${f(st['avg_loss'])}"), ('Profit factor', f(st['pf'])),
            ('Max drawdown (worst-mark equity)', f(rr['max_dd'], 1, True)), ('Highest unrealized loss', f"${f(rr['max_unreal_loss'])}"),
            ('Lowest account liquidation distance', f(rr['min_liq_dist'], 2, True) + ' uniform adverse move'),
            ('Max adverse excursion (worst / median)', f"{f(st['mae_max'],2,True)} / {f(st['mae_med'],2,True)}"), ('Max favourable excursion', f(st['mfe_max'], 2, True)),
            ('Emergency exits', st['emergency']), ('Liquidations', st['liquidated'] + (0 if not rr.get('liquidation') else 0)),
            ('Average / median duration', f"{f(st['dur_mean_h'],1)} h / {f(st['dur_med_h'],1)} h"), ('Trades reaching +25%', f(st['pct_reach_target'], 1, True)),
            ('Reaching +25% within 4h (of all completed)', f(st['pct_target_within_4h_of_all'], 1, True)),
            ('Time to target: mean / median', f"{f(st['tp_mean_h'],2)} h / {f(st['tp_med_h'],2)} h"),
            ('Target hit ≤30 min / ≤1h / ≤2h / ≤4h / >4h', ' / '.join(f(st[k], 0, True) for k in ['tp_30m', 'tp_1h', 'tp_2h', 'tp_4h', 'tp_over_4h'])),
            ('Still open at period end (not counted)', rr.get('open_end', st.get('still_open')))]
    for a, b in rows: w(f'| {a} | {b} |')
    w('')
for n in [s, 'H_live_obvp', 'I_momentum_regime']:
    block(n, V[n]['portfolio'], V[n], f'{NM[n]} — validation Oct 1–25')
    block(n, Q[n]['portfolio'], Q[n], f'{NM[n]} — unseen Oct 26 – Nov 18')
w('### Validation batches (≥20 completed trades required in each)\n')
w('| Strategy | Batch | Completed | Win rate | Net |\n|---|---|---|---|---|')
for n in [s, 'H_live_obvp', 'I_momentum_regime']:
    for lbl, D in [('val', V), ('oos', Q)]:
        for b in D[n]['batches']: w(f"| {NM[n]} | {lbl} {b['batch']} | {b['completed']} | {f(b['win_rate'],1,True)} | ${f(b['net'])} |")
w('')
w('## 6. Twelve-coin performance (validation + unseen, portfolio trades)\n')
for n in [s, 'H_live_obvp', 'I_momentum_regime']:
    w(f'**{NM[n]}**\n'); w('| Coin | Trades | Wins | Win rate | Net $ | Median duration h | Worst MAE |\n|---|---|---|---|---|---|---|')
    d = T[(T.strategy == n) & (T.result != 'OPEN')].copy(); d['pnl'] = d.pnl_usd.astype(float)
    for sym in ['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','BNBUSDT','DOGEUSDT','LINKUSDT','NEARUSDT','BCHUSDT','LTCUSDT','ADAUSDT','AVAXUSDT']:
        x = d[d.symbol == sym]
        if x.empty: w(f'| {sym} | 0 | – | – | – | – | – |'); continue
        w(f"| {sym} | {len(x)} | {(x.pnl>0).sum()} | {f((x.pnl>0).mean(),1,True)} | {f(x.pnl.sum())} | {f(x.minutes.median()/60,1)} | {f(x.mae_pct.max(),2)}% |")
    w('')
w('## 7. Market conditions (validation + unseen, portfolio trades)\n')
w('| Strategy | Condition | Trades | Win rate | Net $ |\n|---|---|---|---|---|')
for n in [s, 'H_live_obvp', 'I_momentum_regime']:
    d = T[(T.strategy == n) & (T.result != 'OPEN')].copy(); d['pnl'] = d.pnl_usd.astype(float)
    for col, vals in [('trend_regime', ['bullish', 'bearish', 'sideways']), ('vol_regime', ['high', 'normal', 'low'])]:
        for val in vals:
            x = d[d[col] == val]
            w(f"| {NM[n]} | {val} {'trend' if col=='trend_regime' else 'volatility'} | {len(x)} | {f((x.pnl>0).mean(),1,True) if len(x) else '–'} | {f(x.pnl.sum()) if len(x) else '–'} |")
w('\nTrend regime = last closed 4h candle vs a rising/falling 4h EMA50 at entry. Volatility = 1h ATR% rank over the previous 30 days (high > 70th, low < 30th percentile).\n')
w('## 8. Why losing trades failed\n')
b = R['breakdown'][s]
for n in [s, 'H_live_obvp', 'I_momentum_regime', 'B_ema_momentum']:
    for per in ['validation', 'oos']:
        lo = R['breakdown'][n][per].get('losers', {})
        if lo: w(f"- {NM[n]}, {per}: {lo['n']} losers — {lo['counter_4h']} against the 4h trend, {lo['with_4h']} with it, {lo['high_vol']} in high volatility; average {f(lo['mean_mins_h'],1)} h until the emergency level; up to {lo['same_day_cluster']} losers on a single day. Winners' median adverse move before target: {f((R['breakdown'][n][per].get('winners_mae_med') or 0)*100,2)}%.")
w('\nWhat the 51,373 development candidates showed: no single condition — trend alignment, volume, taker flow, RSI, open-interest change, VWAP distance, hour of day — moved the target-first rate above ~87%. The strongest effects were funding direction and the 3-day move (up to 87%) and calm volatility (88%). Losses come in **clusters**: one sharp market-wide move hits several open trades on correlated coins at once, which is why the 6-slot account loses far more in a bad hour than single trades suggest. Most losers were entered **with** the 4h trend (the filters required it); they failed when the trend turned after entry, typically 8–18 hours later. A trend filter alone does not fix this.\n')
w('## 9. Risk analysis\n')
w('**Emergency-exit sensitivity (Oct 1 – Nov 18, $1,000 start):**\n')
w('| Strategy | Emergency level | Completed | Win rate | Net $ | Max DD | Account liquidated? | Lowest liquidation distance |\n|---|---|---|---|---|---|---|---|')
for n, D in R['emergency'].items():
    for k, x in D.items():
        st = x['stats']; lq = x['liquidation']
        w(f"| {NM[n]} | {'none (live)' if k=='None' else k+'× margin'} | {st['completed']} | {f(st['win_rate'],1,True)} | {f(st['net'])} | {f(x['max_dd'],1,True)} | {'YES' if lq and lq!='None' else 'no'} | {f(x['min_liq_dist'],2,True) if x['min_liq_dist'] not in (None,'None') else '–'} |")
ll = R['live_like_full']
w(f"\n**Your live rules (no emergency exit) on the whole window with your live indicator:** the first 99 completed trades all hit the target, then one move against the 6 open trades (5 SHORTs during the August rally) wiped the account — **liquidated on {pd.Timestamp(int(json.loads(ll['liquidation'].replace(chr(39),chr(34)).replace('(','[').replace(')',']'))['time']) if isinstance(ll['liquidation'],str) else ll['liquidation']['time'],unit='ms')} UTC** after {ll['stats']['completed']} trades. A near-100% win rate before that point comes from having no exit for losing trades, not from accurate entries.\n")
w('- At 75x with 6 × 5% slots in cross margin, open positions total **22.5× the wallet**. A 4.4% move against all of them together wipes the account even with no single trade "liquidated" on its own.')
w('- An isolated 75x position would liquidate after ≈0.83% against; cross margin only postpones this by using the rest of the wallet, so a loser drains the whole account rather than its own 5%.')
w('- Emergency exits avoided account liquidation at 1× and 2× in every test, but turned the same entries into steady losses because each one costs 4–8 winning trades.\n')
w('## 10. Implementation plan (only if you later approve a strategy — not recommended now)\n')
w('- New pure rule file `src/lib/engine/vwap-volume.ts` (same pattern as `ob-vp.ts`), unit tests next to `src/test/ob-vp.test.ts`.')
w('- `src/lib/engine/model.ts` Candle needs taker-buy volume; `engine-worker/binance.ts` must parse kline field 9 for futures 5m candles.')
w('- `src/lib/engine/five-minute.ts`: call the new rule on each futures 5m close instead of (or beside) `advanceObvp`; 4h EMA50 state rebuilt from history on restart in `engine-worker/service.ts`.')
w('- Database rule `simulate_engine_candle`: add the new entry source label next to OBVP5_CROSS; keep 75x, 6 × 5%, +25% target.')
w('- Simulator page text in `src/routes/simulator.tsx`. Nothing here has been changed.\n')
w('## 11. Final recommendation\n')
w('**More research is required; none of these strategies is validated for paper trading.** The tested entries — including your live OB + VP indicator — do not overcome the fixed cost of 10.5% of margin per trade and the 8-to-1 loss-to-win size that 75x + 25% target + no stop-loss creates. With no loss limit (your live rules) the account was liquidated in this replay; with a loss limit it bled. A genuinely different result would require changing the trade structure (for example a lower leverage, a larger target, a maker-fee entry, or an explicit loss limit), which you asked me not to change — I have not changed anything.\n')
w('**Statistical limits:** 110 days, one bull and one bear phase; trades on correlated coins are not independent, so the effective sample is smaller than the trade counts suggest. A strategy that looks profitable for one 12–14 day fold (for example B or F in the final walk-forward fold) is not evidence of a lasting edge.\n')
w('## Files\n- `prompt57-research-report.md` (this report)\n- `prompt57-all-trades.csv` — every validation and unseen trade of every strategy, including losses, emergency exits, liquidations and open trades\n- `prompt57-summary.json` — all metrics, walk-forward folds, coin-flip baseline, emergency sensitivity\n- `prompt57-evidence.zip` — protocol, frozen selection, code, raw-file hashes')
open(f'{O}/prompt57-research-report.md', 'w').write('\n'.join(L))
print(len('\n'.join(L)))
