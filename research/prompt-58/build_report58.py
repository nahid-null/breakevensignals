"""Assemble the prompt-58 report, summary and evidence bundle from /tmp/r58 outputs."""
import json, hashlib, numpy as np
MR = json.load(open('/tmp/r58/model_results.json')); O = json.load(open('/tmp/r58/oos.json')); RB = json.load(open('/tmp/r58/robust.json'))
SEL = json.load(open('selection-frozen.json')); SELS = json.load(open('/tmp/r58/select.json'))
h = lambda f: hashlib.sha256(open(f, 'rb').read()).hexdigest()
L = []; w = L.append
w('# Prompt-58 research: can conditions before entry predict which trades reach +25% before a dangerous move?\n')
w('**Result: no model passed.** The new adverse-movement model (C) made +52.6% in validation but lost 50.0% on the unseen Oct 26 – Nov 18 period. '
  'It did far better than random entries (random lost about 94%), so the features carry a small real signal, but not enough to overcome 75x costs. Nothing live was changed.\n')
w('## Setup (identical to prompt-57)\n- 12 coins, 75x, 6 slots, 5% wallet margin per slot, +25% net margin target after 0.05% taker fee and 0.02% slippage per side, fills 60 s after the 5m close, real funding, mark-price exits, Binance tier-1 maintenance margin, cross-margin account liquidation check every minute. $1,000 simulated wallet.\n'
  '- Periods: development Aug 1 – Sep 30 (rising), validation Oct 1 – 25, unseen Oct 26 – Nov 18 (falling). Test rules committed before any test (protocol.json sha256 ' + h('protocol.json')[:16] + '…); chosen settings frozen before the unseen run (selection-frozen.json sha256 ' + h('selection-frozen.json')[:16] + '…).\n'
  '- Same hashed Binance archives as prompt-57 (raw-file-hashes.json).\n')
w('## 1. Each feature tested alone (AUC for "target before 1% adverse", 0.5 = no skill)\n\n| feature | dev | validation | unseen |\n|---|---|---|---|')
for n, v in MR['univariate']['1.0'].items(): w(f"| {n} | {v['dev']:.3f} | {v['validation']:.3f} | {v['oos']:.3f} |")
w('\nOnly open-interest rising with the trade (oi1_s, 0.523/0.526/0.529) and trading with the 4h trend (h4_trend_s, 0.512/0.514/0.524) stayed on the same side in all three periods, and both are tiny. '
  'Funding flipped sign (0.478 in dev, 0.550 unseen). Distance to swing highs/lows, resting-stop concentration, stop-hunt rate, false-breakout rate, BTC volatility, correlation, volatility expansion and structure flips were all within ±0.03 of 0.5. '
  'Direction-free features (volatility, correlation) cannot separate LONG from SHORT on their own, so their value shows up in the combined model below.\n\n'
  '**Liquidation clusters were not tested:** Binance has no reliable free history of liquidations (its liquidation feed is live-only and sampled). Building one from it would be guesswork.\n')
w('## 2. Target-first probability model (fitted on development only)\n\n| adverse limit | base rate unseen | AUC dev | AUC validation | AUC unseen (95% CI) | top 1% hit unseen | break-even hit rate | Brier unseen vs base |\n|---|---|---|---|---|---|---|---|')
for a, r in MR['models'].items():
    be = (float(a) * 0.75 + 0.105) / (float(a) * 0.75 + 0.105 + 0.25)
    w(f"| {a}% | {r['oos']['base_rate']:.3f} | {r['dev']['auc']:.3f} | {r['validation']['auc']:.3f} | {r['oos']['auc']:.3f} ({r['oos']['auc_ci95'][0]:.3f}–{r['oos']['auc_ci95'][1]:.3f}) | {r['oos']['top1pct_hit']:.3f} | {be:.3f} | {r['oos']['brier']:.4f} vs {r['oos']['brier_base']:.4f} |")
w('\nEven the top 1% of scores stayed below the hit rate needed to break even at every adverse limit. Development AUC (0.58) shrank to 0.51–0.55 on later data: most of what the model learned in August–September did not carry over.\n\n**Within 4 hours** (preferred duration):\n\n| adverse limit | base | AUC unseen | top 1% hit |\n|---|---|---|---|')
for a, r in MR['models'].items(): w(f"| {a}% | {r['within_4h']['oos']['base_rate']:.3f} | {r['within_4h']['oos']['auc']:.3f} | {r['within_4h']['oos']['top1pct_hit']:.3f} |")
w('\n**Reliability on unseen data (1% limit):** predicted vs actual by score decile\n\n| predicted | actual | rows |\n|---|---|---|')
for b in MR['models']['1.0']['oos']['reliability']: w(f"| {b['p_mean']:.3f} | {b['hit']:.3f} | {b['n']} |")
w('\n## 3. Predicting a dangerous move itself (adverse move ≥ limit within 4 h, either way)\n\n| limit | AUC validation | AUC unseen |\n|---|---|---|')
for a, r in MR['adverse'].items(): w(f"| {a}% | {r['validation']['auc']:.3f} | {r['oos']['auc']:.3f} |")
w('\n*How big* the next move will be is predictable (AUC 0.62–0.64, mostly from volatility). *Which direction* it goes is not, and that is what decides target-first.\n')
w('## 4. Approach C selection (120 configurations; chosen on validation only)\nGrid: adverse limit {0.5, 0.75, 1, 1.5, 2}% (also used as the emergency exit), score threshold top {1%, 0.5%, 0.1%}, max same-direction positions {1, 2, 3, 6}, max BTC-correlated same-direction positions {none, 3}. '
  f"Chosen: limit {SEL['selected']['a']}%, top 1% scores (p ≥ {SEL['selected']['thr']:.3f}), max {SEL['selected']['msd']} positions in the same direction. Development numbers are in-sample (model fitted there) and are not evidence.\n\n"
  '**Exact entry rule C:** at every 5m close, score all 12 coins × LONG/SHORT with the 1% model (coefficients in summary JSON). Enter the highest-scoring candidate when p ≥ threshold, the coin has no open trade, a slot is free and fewer than 2 positions are open in that direction. LONG and SHORT use the same model with side-adjusted features. Exit at +25% net, or emergency close at about 1% adverse price move.\n\n'
  '**Exposure caps were the biggest effect found:** in validation, limiting same-direction positions to 1–2 turned most configurations from losses into gains, and allowing all 6 in one direction was the worst for every limit. But it did not hold up on unseen data.\n')
w('## 5. Three approaches on identical periods and costs\n\n| approach | exit rule | period | trades | net $ (of $1,000) | win % | max drawdown | liquidated |\n|---|---|---|---|---|---|---|---|')
for n, d in O.items():
    for k, pp in d.items():
        for per in ['validation', 'oos']:
            r = pp[per]; s = r['stats']
            w(f"| {n} | {k} | {per} | {s['completed']} | {s['net']:.1f} | {100 * (s['win_rate'] or 0):.1f} | {min(1, r['max_dd']) * 100:.0f}% | {'YES' if r['liquidation'] not in (None, 'None') else 'no'} |")
w('\n"own_exit_a" = emergency close at ~1% adverse; "k2_margin" = prompt-57 emergency at 2× margin; "no_emergency" = your live rule. B with no emergency exit made +254% unseen only because nothing went wrong in that stretch; it was liquidated in both earlier periods.\n')
r = O['C_adverse_model']['own_exit_a']['oos']
w(f"## 6. Account survival, approach C on unseen data\n- Max drawdown {r['max_dd'] * 100:.0f}%; worst simultaneous unrealized loss ${r['worst_simultaneous_unrealized']:.1f}; closest to liquidation {r['min_liq_dist'] * 100 if r['min_liq_dist'] else 0:.2f}% of open notional; max open notional {r['max_notional_x_wallet']:.2f}× wallet; max same-direction positions {r['max_same_direction']}.\n"
  f"- Emergency exits: {r['stats']['emergency']} of {r['stats']['completed']}; liquidations: none with the emergency exit, but liquidated without it (no_emergency row).\n"
  f"- Trade frequency: {RB['oos_roi_per_trade']['trades_per_day']:.1f} trades/day on average (no minimum forced).\n- Per-trade return on margin: {RB['oos_roi_per_trade']['mean'] * 100:.2f}% (95% CI {RB['oos_roi_per_trade']['ci95'][0] * 100:.2f}% to {RB['oos_roi_per_trade']['ci95'][1] * 100:.2f}%).\n")
w('## 7. Random baseline (100 seeds, same exit and exposure cap)\n\n| period | random net mean | random 5–95% | random win | C net |\n|---|---|---|---|---|')
for per, cn in [('validation', O['C_adverse_model']['own_exit_a']['validation']['stats']['net']), ('oos', r['stats']['net'])]:
    b = RB['random'][per]; w(f"| {per} | {b['net_mean']:.1f} | {b['net_p5']:.1f} to {b['net_p95']:.1f} | {b['win_mean'] * 100:.1f}% | {cn:.1f} |")
w('\nC beat every random seed in both periods. That is real evidence of some skill, but it is skill at losing less.\n\n## 8. Walk-forward (model refitted each fold, frozen settings)\n\n| test window | trades | net $ | win % | max DD | test AUC |\n|---|---|---|---|---|---|')
for f in RB['walk_forward']: w(f"| {f['test'][0]} → {f['test'][1]} | {f['trades']} | {f['net']:.1f} | {f['win'] * 100:.1f} | {f['max_dd'] * 100:.0f}% | {f['test_auc']:.3f} |")
w('\n3 of 6 windows were positive, all during the rising market. All three since Oct 10 lost. The rule needed 4.\n\n## 9. Unseen period by coin, side and market type (approach C)\n\n| coin | trades | net $ | win % |\n|---|---|---|---|')
for k, v in RB['oos_by_coin'].items(): w(f"| {k} | {v['trades']} | {v['net']:.1f} | {v['win'] * 100:.1f} |")
for title, key, lab in [('side', 'oos_by_side', {'1': 'LONG', '-1': 'SHORT'}), ('4h trend', 'oos_by_trend', {'1': 'bullish', '-1': 'bearish', '0': 'sideways'}), ('volatility', 'oos_by_vol', {'1': 'high', '-1': 'low', '0': 'normal'})]:
    w(f'\n| {title} | trades | net $ | win % |\n|---|---|---|---|')
    for k, v in RB[key].items(): w(f"| {lab[str(k)]} | {v['trades']} | {v['net']:.1f} | {v['win'] * 100:.1f} |")
w('\n## 10. Pass criteria\n\n| rule | result |\n|---|---|')
oa = MR['models']['1.0']['oos']
for rule, ok in [('positive net in validation AND unseen', False), ('no liquidation under own exit', True), ('max drawdown ≤ 30% unseen', r['max_dd'] <= .3),
                 ('per trade above random 95th percentile', r['stats']['net'] / r['stats']['completed'] > RB['random']['oos']['per_trade_p95']),
                 ('≥ 4 positive walk-forward windows', sum(f['net'] > 0 for f in RB['walk_forward']) >= 4), ('unseen AUC > 0.55 with CI above 0.5', oa['auc'] > .55 and oa['auc_ci95'][0] > .5)]:
    w(f"| {rule} | {'pass' if ok else 'FAIL'} |")
w(f"\nProfitable coins unseen: {sum(v['net'] > 0 for v in RB['oos_by_coin'].values())} of 12.\n\n**Conclusion:** No model passed. The only things that consistently helped were (1) not stacking many positions in the same direction, and (2) a weak tendency for open interest growing with the trade and the 4h trend. "
  'Neither is close to the 77% target-first rate that a 1% loss limit needs at 75x with these costs. As in prompt-57, the barrier is the trade setup (a 0.47% target against 10.5% of margin in costs per trade), not a missing indicator.\n\n'
  '## Reproduce\n`research/prompt-58`: `python3 build58.py` → `run_model58.py` → `study58.py select` → `study58.py oos` → `robust58.py` → `build_report58.py` (data from the prompt-57 hashed archives).\n')
open('/tmp/r58/prompt58-research-report.md', 'w').write('\n'.join(L))
json.dump(dict(selected=SEL, models={a: {k: v for k, v in r.items() if k in ('coef',)} | {p: {kk: r[p][kk] for kk in ('auc', 'auc_ci95', 'base_rate', 'top1pct_hit', 'brier', 'brier_base')} for p in ('dev', 'validation', 'oos')} for a, r in MR['models'].items()},
               adverse_auc={a: {p: r[p]['auc'] for p in r} for a, r in MR['adverse'].items()}, comparison=O, robustness=RB, configs=SELS), open('/tmp/r58/prompt58-summary.json', 'w'), indent=1, default=str)
print('ok')
