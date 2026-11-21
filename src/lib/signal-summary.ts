/** Outcome of every trading signal that was actually delivered to Telegram (tests excluded). */
export interface SentSignalSummary { sent: number; open: number; takeProfit: number; stopLoss: number; breakeven: number; closed: number; successRate: number | null }
interface LogLike { trade_id: string | null; event_id: string; delivery_status: string; is_test: boolean }
interface EventLike { trade_id: string; event_type: string }

export function sentSignalSummary(logs: LogLike[], events: EventLike[]): SentSignalSummary {
  const trades = new Set(logs.flatMap((l) => !l.is_test && l.delivery_status === 'SENT' && l.trade_id && l.event_id.endsWith('-breakeven_activated') ? [l.trade_id] : []));
  const byTrade = new Map<string, Set<string>>();
  for (const e of events) if (trades.has(e.trade_id)) {
    const set = byTrade.get(e.trade_id) ?? new Set<string>(); set.add(e.event_type); byTrade.set(e.trade_id, set);
  }
  let takeProfit = 0, stopLoss = 0, breakeven = 0;
  for (const id of trades) {
    const ev = byTrade.get(id);
    if (ev?.has('take_profit_hit')) takeProfit++;
    else if (ev?.has('stop_loss_hit')) { if (ev.has('breakeven_activated')) breakeven++; else stopLoss++; }
  }
  const closed = takeProfit + stopLoss + breakeven;
  return { sent: trades.size, open: trades.size - closed, takeProfit, stopLoss, breakeven, closed, successRate: closed ? (takeProfit / closed) * 100 : null };
}

/** prompt-39: Telegram carries only Simulator results. prompt-74: CSTF results ('-cstf-result') count too; their loss is a liquidation. */
export interface SentResultSummary { sent: number; takeProfit: number; stopLoss: number; successRate: number | null }
export function sentResultSummary(logs: LogLike[], trades: { trade_id: string; exit_reason: string | null }[]): SentResultSummary {
  const reason = new Map(trades.map((t) => [t.trade_id, t.exit_reason]));
  const sent = logs.filter((l) => !l.is_test && l.delivery_status === 'SENT' && l.trade_id && (l.event_id.endsWith('-simulator-result') || l.event_id.endsWith('-cstf-result')));
  const takeProfit = sent.filter((l) => reason.get(l.trade_id!) === 'TAKE_PROFIT').length;
  return { sent: sent.length, takeProfit, stopLoss: sent.length - takeProfit, successRate: sent.length ? takeProfit / sent.length * 100 : null };
}
