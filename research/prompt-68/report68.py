"""prompt-68 reports: builds summary.json, two CSVs and two PDFs from result.json. usage: report68.py RESULT_JSON OUT_DIR"""
import json, sys, csv, collections, datetime as dt
from pathlib import Path
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether
R = json.loads(Path(sys.argv[1]).read_text()); OUT = Path(sys.argv[2]); OUT.mkdir(parents=True, exist_ok=True)
U = lambda t: dt.datetime.fromtimestamp(t/1000, dt.UTC).strftime('%Y-%m-%d %H:%M UTC') if t else ''
rows, trades = R['rows'], R['trades']; acc = [r for r in rows if r['decision'] == 'ACCEPTED']; rej = [r for r in rows if r['decision'] == 'REJECTED']
done = [p for p in trades if p['status'] in ('SUCCESS', 'UNSUCCESSFUL')]; succ = [p for p in done if p['status'] == 'SUCCESS']
pct = lambda a, b: None if not b else round(a/b*100, 1)
fmt = lambda v: '—' if v is None else f'{v}%'
def side_stats(sd):
    t = [p for p in trades if p['side'] == sd]; d = [p for p in t if p['status'] in ('SUCCESS', 'UNSUCCESSFUL')]
    return dict(trades=len(t), success=sum(p['status'] == 'SUCCESS' for p in d), resolved=len(d), success_rate=pct(sum(p['status'] == 'SUCCESS' for p in d), len(d)),
                profit=round(sum(p.get('pnl') or 0 for p in t if p['exit_time']), 4), original=sum(r['side'] == sd for r in rows), accepted=sum(r['side'] == sd for r in acc))
hours = []
for h in range(24):
    rs = [r for r in rows if dt.datetime.fromtimestamp(r['signal_time']/1000, dt.UTC).hour == h]
    ts = [p for p in trades if dt.datetime.fromtimestamp(p['t0']/1000, dt.UTC).hour == h]
    s = sum(p['status'] == 'SUCCESS' for p in ts); u = sum(p['status'] == 'UNSUCCESSFUL' for p in ts)
    hours.append(dict(hour=f'{h:02d}:00', original=len(rs), accepted=sum(r['decision'] == 'ACCEPTED' for r in rs), rejected=sum(r['decision'] == 'REJECTED' for r in rs),
                      success=s, unsuccessful=u, success_rate=pct(s, s+u), profit=round(sum(p.get('pnl') or 0 for p in ts if p['exit_time']), 4)))
hi_act = max(hours, key=lambda h: h['original']); lo_act = min(hours, key=lambda h: h['original'])
perf = [h for h in hours if h['success'] + h['unsuccessful'] > 0]
best = max(perf, key=lambda h: (h['success_rate'], h['profit'])) if perf else None; worst = min(perf, key=lambda h: (h['success_rate'], h['profit'])) if perf else None
FILTERS = {'A': 'A market structure', 'B': 'B breakout/continuation', 'G': 'G 0.70% space', 'H': 'H entry deviation', 'conditional 70-79': 'Conditional-band extra rule', 'score': 'Score below 70'}
def keys(r): return sorted({('score' if m.startswith('score') else m.split(':')[0]) for m in r['final_eval']['mandatory_fail']})
rej_break = collections.Counter(k for r in rej for k in keys(r)); miss = [r for r in rej if r['after_signal']['reached_070_before_sl']]
miss_break = collections.Counter(k for r in miss for k in keys(r))
sole = collections.Counter(keys(r)[0] for r in miss if len(keys(r)) == 1)
all_before_sl = sum(r['after_signal']['reached_070_before_sl'] for r in rows); all_complete = [r for r in rows if r['after_signal']['horizon_complete']]
sc = [r for r in rows if r['strong_continuation']]
refs = {('SOLUSDT', '2026-11-16 23:55 UTC', 'SHORT'): 'Screenshot 1 (weak) – Enter Short 71.49', ('SOLUSDT', '2026-11-17 01:35 UTC', 'LONG'): 'Screenshot 1 (weak) – Enter Long 71.63',
        ('SOLUSDT', '2026-11-18 23:30 UTC', 'LONG'): 'Screenshot 2 (strong) – Enter Long 73.42'}
ref_out = []
for r in rows:
    k = (r['sym'], U(r['signal_time']), r['side'])
    if k in refs:
        c = r['continuation_eval']; ref_out.append(dict(reference=refs[k], decision=r['decision'], continuation_score=c['score'], final_score=r['final_eval']['score'],
            reasons=r['final_eval']['mandatory_fail'] if r['decision'] == 'REJECTED' else [], continuation_reasons=c['mandatory_fail'],
            reached_070_before_sl=r['after_signal']['reached_070_before_sl'], minutes_to_070=r['after_signal']['minutes_to_070']))
unres = [p for p in trades if p['status'] == 'UNRESOLVED']; amb = [p for p in trades if p['status'] == 'AMBIGUOUS']
S = dict(start=U(R['start']), end=U(R['end']), duration='7 days (168 hours)', timezone='UTC (website display timezone)', coins=sorted({r['sym'] for r in rows}),
    original=len(rows), accepted=len(acc), rejected=len(rej), traded=len(trades), success=len(succ), unsuccessful=len(done) - len(succ), unresolved=len(unres), ambiguous=len(amb),
    accepted_not_traded=sum(1 for r in acc if r.get('trade', {}).get('status', '').startswith('ACCEPTED_NO')),
    success_rate=pct(len(succ), len(done)), long=side_stats('LONG'), short=side_stats('SHORT'), start_balance=R['start_balance'], final_balance=round(R['final_cash'], 4),
    total_profit=round(R['final_cash'] - R['start_balance'], 4), unrealized_open=round(sum(p.get('unrealized') or 0 for p in unres), 4),
    highest_activity_hour=hi_act['hour'], highest_activity_signals=hi_act['original'], lowest_activity_hour=lo_act['hour'], lowest_activity_signals=lo_act['original'],
    best_hour=best and best['hour'], best_hour_rate=best and best['success_rate'], worst_hour=worst and worst['hour'], worst_hour_rate=worst and worst['success_rate'],
    pct_accepted=pct(len(acc), len(rows)), pct_rejected=pct(len(rej), len(rows)),
    rejected_reached_070_24h=sum(r['after_signal']['reached_070'] for r in rej), rejected_reached_070_before_sl=len(miss), pct_rejected_reached_070_before_sl=pct(len(miss), len(rej)),
    rejected_horizon_incomplete=sum(not r['after_signal']['horizon_complete'] for r in rej),
    all_signals_reached_070_before_sl=all_before_sl, all_signals_rate_070_before_sl=pct(all_before_sl, len(rows)),
    strong_continuation_total=len(sc), strong_continuation_preserved=sum(r['decision'] == 'ACCEPTED' for r in sc), strong_continuation_rejected=sum(r['decision'] == 'REJECTED' for r in sc),
    strong_continuation_preservation_rate=pct(sum(r['decision'] == 'ACCEPTED' for r in sc), len(sc)),
    rejection_breakdown={FILTERS[k]: v for k, v in rej_break.most_common()}, missed_by_filter={FILTERS[k]: v for k, v in miss_break.most_common()},
    missed_sole_reason={FILTERS[k]: v for k, v in sole.most_common()}, hours=hours, references=ref_out, data_gaps=R['data_gaps'], rules_sha256=R['rules_sha256'],
    fee='0.05% per side (live Simulator), 1 tick slippage per fill, real Binance funding', sizing='5% of balance, 75x, 7 slots (live Simulator)')
S['recommendations'] = [
    f"The filter did not beat the unfiltered indicator: {S['success']} of {S['success']+S['unsuccessful']} accepted trades succeeded, while {S['all_signals_reached_070_before_sl']} of {S['original']} original signals ({fmt(S['all_signals_rate_070_before_sl'])}) reached +0.70% before their stop. Two trades are far too few to judge; the main effect was removing trades.",
    f"The 0.15% entry-deviation rule (H) rejected {rej_break.get('H', 0)} signals and blocks almost every breakout-path entry, because the confirmation candle closes beyond the signal candle. Phase 2 should test a separate deviation allowance for the breakout path (for example 0.30%) or a limit entry back at the signal candle extreme.",
    "The strong screenshot-2 entry scored 64: it lost all 10 trend points (15-minute EMA20 still below EMA50 after the sell-off) and all 15 obstacle points (bearish OB 0.65% away). Phase 2 should give partial obstacle points between 0.60% and 0.70% and lower the 15-minute trend weight for confirmed strong continuations.",
    f"The primary confirmation rule (B) was involved in {miss_break.get('B', 0)} of the {len(miss)} rejected signals that later reached +0.70% before the stop.",
    "Run phase 2 on a different 7-day week: the reference screenshots come from this week, so these results cannot independently confirm rules shaped by them."]
(OUT/'summary.json').write_text(json.dumps(S, indent=1))
# ---------------- CSVs ----------------
def tcsv():
    with open(OUT/'7_Day_Filter_Backtest_Report.csv', 'w', newline='') as fh:
        w = csv.writer(fh); w.writerow(['# 7-Day Filter Backtest Report', S['start'], 'to', S['end']])
        for k in ('original', 'accepted', 'rejected', 'traded', 'success', 'unsuccessful', 'unresolved', 'ambiguous', 'success_rate', 'start_balance', 'final_balance', 'total_profit',
                  'highest_activity_hour', 'lowest_activity_hour', 'best_hour', 'worst_hour'): w.writerow([k, S[k]])
        for sd in ('long', 'short'): w.writerow([f'{sd}_trades', S[sd]['trades'], 'success', S[sd]['success'], 'rate', S[sd]['success_rate'], 'profit', S[sd]['profit']])
        w.writerow([]); w.writerow(['HOURLY (UTC)', 'original', 'accepted', 'rejected', 'success', 'unsuccessful', 'success_rate_%', 'profit_usdt'])
        for h in hours: w.writerow([h['hour'], h['original'], h['accepted'], h['rejected'], h['success'], h['unsuccessful'], h['success_rate'], h['profit']])
        w.writerow([]); w.writerow(['ACCEPTED TRADES', 'signal_id', 'coin', 'side', 'path', 'score', 'entry_time', 'entry_price', 'target_price', 'original_sl', 'margin', 'balance_before',
                                    'exit_time', 'exit_price', 'outcome', 'exit_reason', 'minutes_open', 'funding', 'pnl', 'balance_after'])
        for p in trades: w.writerow(['', p['id'], p['sym'], p['side'], p['path'], p['score'], U(p['t0']), p['entry_price'], round(p['target'], 6), p['sl'], round(p['margin'], 6),
                                     round(p['balance_before'], 6), U(p['exit_time']), p.get('exit_price'), p['status'], p['exit_reason'], p['minutes_open'], round(p['funding'], 6),
                                     round(p.get('pnl') if p.get('pnl') is not None else p.get('unrealized', 0), 6), round(p.get('balance_after', 0) or 0, 6)])
def rcsv():
    with open(OUT/'7_Day_Rejected_Signals_History.csv', 'w', newline='') as fh:
        w = csv.writer(fh)
        w.writerow(['signal_id', 'time_utc', 'coin', 'side', 'entry', 'stars', 'candle_high', 'candle_low', 'candle_close', 'rsi', 'adx', 'ema20_15m', 'ema50_15m', 'trend_15m',
                    'opposing_obstacle', 'obstacle_distance_pct', 'clear_space_pct', 'confirmation', 'entry_deviation_pct', 'score', 'filters_passed', 'filters_failed', 'rejection_reason',
                    'continuation_check_score', 'continuation_check_reasons', 'strong_continuation_pattern', 'reached_070_24h', 'reached_070_before_original_sl', 'minutes_to_070',
                    'max_favourable_pct', 'max_adverse_pct', 'horizon_hours', 'horizon_complete'])
        for r in rej:
            e = r['final_eval']; f = e.get('filters', {}); a = r['after_signal']
            w.writerow([r['id'], U(r['signal_time']), r['sym'], r['side'], r['indicator_entry'], r['stars'], r['sig_high'], r['sig_low'], r['sig_close'], f.get('D', {}).get('rsi'),
                        f.get('D', {}).get('adx'), f.get('C', {}).get('ema20'), f.get('C', {}).get('ema50'), f.get('C', {}).get('trend_15m'), f.get('F', {}).get('nearest_obstacle'),
                        f.get('F', {}).get('obstacle_distance_pct'), f.get('G', {}).get('clear_space_pct'), f.get('B', {}).get('confirmation'), f.get('H', {}).get('deviation_pct'), e['score'],
                        '; '.join(e['passed']), '; '.join(e['failed']), ' | '.join(e['mandatory_fail']), r['continuation_eval']['score'], ' | '.join(r['continuation_eval']['mandatory_fail']),
                        r['strong_continuation'], a['reached_070'], a['reached_070_before_sl'], a['minutes_to_070'], a['mfe_pct'], a['mae_pct'], a['horizon_hours'], a['horizon_complete']])
tcsv(); rcsv()
# ---------------- PDFs ----------------
ss = getSampleStyleSheet(); P = lambda t, st='BodyText': Paragraph(t, st if not isinstance(st, str) else ss[st]); small = ss['BodyText'].clone('s', fontSize=7, leading=8.5)
def tbl(data, widths=None, fs=7.5):
    t = Table(data, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([('FONTSIZE', (0, 0), (-1, -1), fs), ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1e293b')), ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                           ('GRID', (0, 0), (-1, -1), 0.25, colors.grey), ('VALIGN', (0, 0), (-1, -1), 'TOP')])); return t
def main_pdf():
    doc = SimpleDocTemplate(str(OUT/'7_Day_Filter_Backtest_Report.pdf'), pagesize=landscape(A4), leftMargin=24, rightMargin=24, topMargin=24, bottomMargin=24); el = []
    el += [P('7-Day Smart Filter Backtest Report', 'Title'), P(f"Historical backtest only — no live trades, no orders. Window {S['start']} to {S['end']} ({S['duration']}), {len(S['coins'])} coins, 5-minute OB STRONG signals (unchanged indicator). Times in {S['timezone']}."),
           P(f"Sizing {S['sizing']}; costs {S['fee']}. Success = +0.70% favourable move before the original stop loss. Success rate = successful / resolved trades. Rules fingerprint {S['rules_sha256'][:16]}… Data gaps: none." if all(v['missing_1m'] == 0 and v['missing_5m'] == 0 for v in S['data_gaps'].values()) else 'Data gaps present — see summary.'), Spacer(1, 6)]
    g = [['Metric', 'Value', 'Metric', 'Value'], ['Original signals', S['original'], 'Starting balance', f"${S['start_balance']:.4f}"], ['Accepted', S['accepted'], 'Final balance', f"${S['final_balance']:.4f}"],
         ['Rejected', S['rejected'], 'Total simulated profit', f"${S['total_profit']:.4f}"], ['Simulated trades', S['traded'], 'Success rate', fmt(S['success_rate'])],
         ['Successful', S['success'], 'LONG trades / rate', f"{S['long']['trades']} / {fmt(S['long']['success_rate'])}"], ['Unsuccessful', S['unsuccessful'], 'SHORT trades / rate', f"{S['short']['trades']} / {fmt(S['short']['success_rate'])}"],
         ['Unresolved / ambiguous', f"{S['unresolved']} / {S['ambiguous']}", 'Highest / lowest activity hour', f"{S['highest_activity_hour']} ({S['highest_activity_signals']}) / {S['lowest_activity_hour']} ({S['lowest_activity_signals']})"],
         ['Accepted but no free slot', S['accepted_not_traded'], 'Best / worst performing hour', f"{S['best_hour']} ({fmt(S['best_hour_rate'])}) / {S['worst_hour']} ({fmt(S['worst_hour_rate'])})"]]
    el += [tbl(g, [150, 90, 190, 230], 8.5), Spacer(1, 8), P('Hourly analysis (UTC)', 'Heading2')]
    el.append(tbl([['Hour', 'Original', 'Accepted', 'Rejected', 'Successful', 'Unsuccessful', 'Success rate', 'Profit $']] + [[h['hour'], h['original'], h['accepted'], h['rejected'], h['success'], h['unsuccessful'], fmt(h['success_rate']), f"{h['profit']:.4f}"] for h in hours], fs=7))
    el += [PageBreak(), P('Accepted trade history', 'Heading2')]
    el.append(tbl([['#', 'Coin', 'Side', 'Path', 'Score', 'Entry time', 'Entry', 'Target', 'Orig SL', 'Margin', 'Bal before', 'Exit time', 'Outcome', 'Min', 'P&L $', 'Bal after']] +
                  [[p['id'], p['sym'], p['side'], p['path'], p['score'], U(p['t0']), p['entry_price'], round(p['target'], 5), p['sl'], f"{p['margin']:.4f}", f"{p['balance_before']:.4f}", U(p['exit_time']), p['status'], p['minutes_open'],
                    f"{(p.get('pnl') if p.get('pnl') is not None else p.get('unrealized', 0)):.4f}", f"{p.get('balance_after') or 0:.4f}"] for p in trades], fs=7))
    el += [Spacer(1, 8), P('Filter effectiveness', 'Heading2'),
           P(f"Accepted {fmt(S['pct_accepted'])} of signals, rejected {fmt(S['pct_rejected'])}. Of the {S['rejected']} rejected signals, {S['rejected_reached_070_before_sl']} ({fmt(S['pct_rejected_reached_070_before_sl'])}) later moved +0.70% before touching the original stop loss (24-hour tracking; {S['rejected_horizon_incomplete']} had less than 24 h of data left). Without any filter, {S['all_signals_reached_070_before_sl']} of {S['original']} original signals ({fmt(S['all_signals_rate_070_before_sl'])}) did so."),
           P(f"Strong continuation patterns: {S['strong_continuation_total']} found, {S['strong_continuation_preserved']} preserved, {S['strong_continuation_rejected']} rejected (preservation {fmt(S['strong_continuation_preservation_rate'])})."),
           P('Rejections by rule (a signal can fail several): ' + ', '.join(f'{k} {v}' for k, v in S['rejection_breakdown'].items())),
           P('Rules involved in rejecting the signals that later reached +0.70% before the stop: ' + ', '.join(f'{k} {v}' for k, v in S['missed_by_filter'].items()) + '. Sole reason: ' + (', '.join(f'{k} {v}' for k, v in S['missed_sole_reason'].items()) or 'none') + '.'),
           P('Reference screenshots', 'Heading2')]
    for x in S['references']: el.append(P(f"<b>{x['reference']}</b>: {x['decision']} (continuation score {x['continuation_score']}, final {x['final_score']}). Reasons: {'; '.join(x['reasons'] or ['—'])}. Continuation check: {'; '.join(x['continuation_reasons'] or ['passed'])}. Later reached +0.70% before stop: {'yes, after ' + str(x['minutes_to_070']) + ' min' if x['reached_070_before_sl'] else 'no'}."))
    el.append(P('Recommendations for a second test (rules were not changed during this test)', 'Heading2'))
    for x in S['recommendations']: el.append(P('• ' + x))
    doc.build(el)
def rej_pdf():
    doc = SimpleDocTemplate(str(OUT/'7_Day_Rejected_Signals_History.pdf'), pagesize=A4, leftMargin=24, rightMargin=24, topMargin=24, bottomMargin=24); el = []
    el += [P('7-Day Rejected Signals History', 'Title'), P(f"{S['rejected']} rejected signals, {S['start']} to {S['end']}. Every signal is tracked for 24 hours after its signal candle closes, measured from the indicator entry. Rejected signals are never part of the balance."),
           P('Missed-opportunity analysis', 'Heading2'),
           P(f"Reached +0.70% within 24 h: {S['rejected_reached_070_24h']}. Reached +0.70% before the original stop loss: {S['rejected_reached_070_before_sl']} ({fmt(S['pct_rejected_reached_070_before_sl'])}). Rules involved: " + ', '.join(f'{k} {v}' for k, v in S['missed_by_filter'].items()) + '.'),
           P('Strong signal preservation', 'Heading2'), P(f"{S['strong_continuation_rejected']} of {S['strong_continuation_total']} strong continuation patterns were rejected."), Spacer(1, 6)]
    for r in rej:
        e = r['final_eval']; f = e.get('filters', {}); a = r['after_signal']; C, F, D = f.get('C', {}), f.get('F', {}), f.get('D', {})
        block = [P(f"<b>#{r['id']} {r['sym']} {r['side']} — {U(r['signal_time'])}</b> · entry {r['indicator_entry']} · {r['stars']} stars · score {e['score']}/100 {'· STRONG CONTINUATION PATTERN' if r['strong_continuation'] else ''}", small),
                 P(f"Candle H/L/C {r['sig_high']} / {r['sig_low']} / {r['sig_close']} · RSI {D.get('rsi')} · ADX {D.get('adx')} · 15m EMA20 {C.get('ema20') and round(C['ema20'], 6)} / EMA50 {C.get('ema50') and round(C['ema50'], 6)} ({C.get('trend_15m')}) · obstacle {F.get('nearest_obstacle')} {F.get('obstacle_distance_pct')}% · space {f.get('G', {}).get('clear_space_pct')}% · confirmation: {f.get('B', {}).get('confirmation')} · deviation {f.get('H', {}).get('deviation_pct')}%", small),
                 P(f"Passed: {'; '.join(e['passed']) or '—'} · Failed: {'; '.join(e['failed']) or '—'}", small),
                 P(f"<b>Rejection reason:</b> {' | '.join(e['mandatory_fail'])}", small),
                 P(f"After rejection: +0.70% {'reached in ' + str(a['minutes_to_070']) + ' min' if a['reached_070'] else 'not reached'}{' (before stop)' if a['reached_070_before_sl'] else ' (stop first)' if a['original_sl_hit_first'] else ''} · max favourable {a['mfe_pct']}% · max adverse {a['mae_pct']}% · horizon {a['horizon_hours']} h{'' if a['horizon_complete'] else ' (INCOMPLETE)'}", small), Spacer(1, 5)]
        el.append(KeepTogether(block))
    doc.build(el)
main_pdf(); rej_pdf(); print(json.dumps({k: v for k, v in S.items() if k not in ('hours',)}, indent=1))
