import { z } from 'zod';
import { ST_INTERVAL, ST_SETTINGS, ST_SYMBOLS, type StSymbol } from './supertrend';
import { ST_RULES, stUnrealized, type MaintenanceBracket, type StAccountState, type StBrackets, type StClose, type StPosition, type StResult } from './st-account';
import { MINUTE } from './model';

/** prompt-81 live wiring helpers for the SuperTrend reversal Simulator. Pure: no network, no database. */
export const ST_LIVE_LAG_MS = 3 * MINUTE;
export const ST_WARM_BARS = 1000; // ~21 days of 30m bars; RMA(5) and the trend state converge long before
export const ST_MAX_BATCH = 240;
export const stFrameMode = (frameTime: number, now: number): 'live' | 'recovery' => now - (frameTime + MINUTE) <= ST_LIVE_LAG_MS ? 'live' : 'recovery';
export const stSignalBarFor = (frameTime: number): number | null => frameTime % ST_INTERVAL === 0 ? frameTime - ST_INTERVAL : null;
export const stWarmBars = <T extends { time: number }>(bars: T[], nextFrame: number): T[] => bars.filter((b) => b.time % ST_INTERVAL === 0 && b.time + ST_INTERVAL < nextFrame);

type RawBracket = { bracketNotionalFloor: number; bracketNotionalCap: number; bracketMaintenanceMarginRate: number; cumFastMaintenanceAmount: number; maxOpenPosLeverage: number };
export function parseStBrackets(body: unknown): StBrackets {
  const list = (body as { data?: { brackets?: { symbol: string; riskBrackets: RawBracket[] }[] } })?.data?.brackets;
  if (!Array.isArray(list)) throw new Error('Binance maintenance tiers unavailable');
  const out = {} as StBrackets;
  for (const s of ST_SYMBOLS) {
    const row = list.find((b) => b.symbol === s);
    if (!row?.riskBrackets?.length) throw new Error(`Binance maintenance tiers missing: ${s}`);
    out[s] = [...row.riskBrackets].sort((a, b) => a.bracketNotionalFloor - b.bracketNotionalFloor).map((b): MaintenanceBracket => ({ floor: Number(b.bracketNotionalFloor), cap: Number(b.bracketNotionalCap),
      rate: Number(b.bracketMaintenanceMarginRate), cumulative: Number(b.cumFastMaintenanceAmount), maxLeverage: Number(b.maxOpenPosLeverage) }));
  }
  return out;
}

const px = (n: number) => Number(n.toPrecision(8)).toString();
const usd = (n: number) => `${n < 0 ? '-' : n > 0 ? '+' : ''}$${Math.abs(n).toFixed(4)}`;
const when = (t: number) => new Date(t).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
export function stDuration(ms: number) {
  const m = Math.max(0, Math.round(ms / MINUTE)); const d = Math.floor(m / 1440); const h = Math.floor((m % 1440) / 60); const r = m % 60;
  return [d ? `${d}d` : '', h ? `${h}h` : '', `${r}m`].filter(Boolean).join(' ');
}
const footer = (mode: 'live' | 'recovery') => [...(mode === 'recovery' ? ['Detected while the scanner caught up after an interruption.'] : []), 'Practice money only; fees, slippage and funding included.'];
export function stOpenMessage(p: StPosition, mainBalance: number, reversedFrom: StClose | null): string {
  return [`SUPERTREND SIMULATOR — ${reversedFrom ? 'REVERSAL OPENED' : 'NEW TRADE'}`, `${p.symbol} ${p.side} · ${ST_RULES.leverage}x cross`,
    `Signal: SuperTrend ${ST_SETTINGS.atrPeriod} / hl2 / ${ST_SETTINGS.multiplier} · 30m ${p.side === 'LONG' ? 'BUY' : 'SELL'} (candle ${when(p.signalTime)})`,
    ...(reversedFrom ? [`Reversed from ${reversedFrom.position.side} (net ${usd(reversedFrom.net)})`] : []),
    `Entry: ${px(p.entry)}`, `Margin: $${p.margin.toFixed(4)} (5% of main balance)`, `Main balance: $${mainBalance.toFixed(4)}`, `Time: ${when(p.entryTime)}`,
    'Closes only on the opposite SuperTrend signal. No stop loss, no take profit.', ...footer('live')].join('\n');
}
export function stCloseMessage(c: StClose, mode: 'live' | 'recovery'): string {
  const p = c.position; const win = c.net > 0;
  return [`SUPERTREND SIMULATOR — ${c.reason === 'LIQUIDATED' ? 'LIQUIDATED' : win ? 'CLOSED IN PROFIT' : 'CLOSED IN LOSS'}`,
    `${p.symbol} ${p.side} · ${ST_RULES.leverage}x cross`,
    `Reason: ${c.reason === 'LIQUIDATED' ? 'Cross-margin liquidation (whole account)' : `Opposite SuperTrend signal (${p.side === 'LONG' ? 'SELL' : 'BUY'})`}`,
    `Entry: ${px(p.entry)}`, `Exit: ${px(c.price)}`, `Margin: $${p.margin.toFixed(4)}`,
    `Realized P&L: ${usd(c.net)} (fees ${(p.entryFee + c.exitFee).toFixed(4)}, funding ${p.funding.toFixed(4)})`,
    `Main balance: $${c.mainAfter.toFixed(4)}`, `Duration: ${stDuration(c.time - p.entryTime)}`, `Closed: ${when(c.time)}`,
    ...(c.reversedTo ? [`Reversing into ${p.side === 'LONG' ? 'SHORT' : 'LONG'} in the same slot.`] : []), ...footer(mode)].join('\n');
}

const finite = z.number().finite();
const sym = z.enum(ST_SYMBOLS);
const side = z.enum(['LONG', 'SHORT']);
const positionSchema = z.object({ id: z.string().min(8).max(80), symbol: sym, side, signalTime: z.number().int(), entryTime: z.number().int(), entry: finite.positive(), quantity: finite.positive(), margin: finite.positive(), entryFee: finite.nonnegative(), funding: finite, liquidationPrice: finite.nonnegative() });
export const stStateSchema = z.object({ version: z.literal(ST_RULES.version), wallet: finite, positions: z.array(positionSchema).max(ST_RULES.slots), lastMinute: z.number().int().nullable(), fees: finite, funding: finite, liquidationClearance: finite, liquidations: z.number().int().min(0) })
  .refine((s) => new Set(s.positions.map((p) => p.symbol)).size === s.positions.length, 'One position per coin');
const coinSchema = z.object({ symbol: sym, trend: z.enum(['UP', 'DOWN']).nullable(), line: finite.nullable(), price: finite.nullable(), bar_time: z.number().int().nullable(), last_signal_side: side.nullable(), last_signal_time: z.number().int().nullable() });
export type StCoin = z.infer<typeof coinSchema>;
export const stCommitSchema = z.object({
  instance_id: z.string().uuid(), expected_revision: z.number().int().min(0), state: stStateSchema,
  first_minute: z.number().int(), equity: finite, maintenance: finite, mode: z.enum(['live', 'recovery']),
  coins: z.array(coinSchema).max(ST_SYMBOLS.length),
  opened: z.array(z.object({ trade_id: z.string(), symbol: sym, side, signal_time: z.number().int(), entry_time: z.number().int(), entry_price: finite, quantity: finite, margin: finite, entry_fee: finite, liquidation_price: finite, reversed_from: z.string().nullable(), message: z.string().max(2000) })).max(ST_MAX_BATCH * ST_RULES.slots),
  closed: z.array(z.object({ trade_id: z.string(), reason: z.enum(['OPPOSITE_SIGNAL', 'LIQUIDATED']), exit_time: z.number().int(), exit_price: finite, gross: finite, exit_fee: finite, funding: finite, net: finite, wallet_after: finite, main_after: finite, reversed_to: z.string().nullable(), mode: z.enum(['live', 'recovery']), notify: z.boolean(), message: z.string().max(2000) })).max(ST_MAX_BATCH * ST_RULES.slots),
  open: z.array(z.object({ trade_id: z.string(), liquidation_price: finite, funding: finite, mark_price: finite, unrealized: finite })).max(ST_RULES.slots),
  signals: z.array(z.object({ signal_id: z.string(), symbol: sym, side, signal_time: z.number().int(), decision: z.enum(['OPENED', 'REVERSED', 'IGNORED', 'CLOSED_ONLY']), reason: z.string().max(60).nullable(), mode: z.enum(['live', 'recovery']) })).max(2000),
});
export type StCommit = z.infer<typeof stCommitSchema>;

/** Accumulates consecutive account transitions into one atomic commit payload. */
export class StBatch {
  opened: StCommit['opened'] = []; closed: StCommit['closed'] = []; signals: StCommit['signals'] = [];
  mode: 'live' | 'recovery' = 'recovery'; frames = 0; equity = 0; maintenance = 0; lastMarks: Partial<Record<StSymbol, number>> = {};
  constructor(readonly firstMinute: number) {}
  add(r: StResult, mode: 'live' | 'recovery', closeMarks: Record<StSymbol, number>) {
    if (r.duplicate) return;
    this.frames++; if (mode === 'live') this.mode = 'live'; this.equity = r.equity; this.maintenance = r.maintenance; this.lastMarks = closeMarks;
    for (const c of r.closed) this.closed.push({ trade_id: c.position.id, reason: c.reason, exit_time: c.time, exit_price: c.price, gross: c.gross, exit_fee: c.exitFee, funding: c.position.funding,
      net: c.net, wallet_after: c.walletAfter, main_after: c.mainAfter, reversed_to: c.reversedTo, mode, notify: c.notify, message: stCloseMessage(c, mode) });
    for (const p of r.opened) {
      const from = r.closed.find((c) => c.reversedTo === p.id) ?? null;
      this.opened.push({ trade_id: p.id, symbol: p.symbol, side: p.side, signal_time: p.signalTime, entry_time: p.entryTime, entry_price: p.entry, quantity: p.quantity, margin: p.margin,
        entry_fee: p.entryFee, liquidation_price: p.liquidationPrice, reversed_from: from?.position.id ?? null, message: stOpenMessage(p, from ? from.mainAfter : p.margin / ST_RULES.marginRate, from) });
    }
    const signalIds = new Set<string>();
    for (const p of r.opened) { signalIds.add(p.id); this.signals.push({ signal_id: p.id, symbol: p.symbol, side: p.side, signal_time: p.signalTime, decision: r.closed.some((c) => c.reversedTo === p.id) ? 'REVERSED' : 'OPENED', reason: null, mode }); }
    for (const s of r.skipped) {
      if (signalIds.has(s.signal.id)) continue;
      const closedOnly = r.closed.some((c) => c.reason === 'OPPOSITE_SIGNAL' && c.position.symbol === s.signal.symbol);
      this.signals.push({ signal_id: s.signal.id, symbol: s.signal.symbol, side: s.signal.side, signal_time: s.signal.signalTime, decision: closedOnly ? 'CLOSED_ONLY' : 'IGNORED', reason: s.reason, mode });
    }
  }
  payload(instance: string, revision: number, state: StAccountState, coins: StCoin[]): StCommit {
    return { instance_id: instance, expected_revision: revision, state, first_minute: this.firstMinute, equity: this.equity, maintenance: this.maintenance, mode: this.mode, coins,
      opened: this.opened, closed: this.closed, signals: this.signals,
      open: state.positions.map((p) => { const mark = this.lastMarks[p.symbol] ?? p.entry; return { trade_id: p.id, liquidation_price: p.liquidationPrice, funding: p.funding, mark_price: mark, unrealized: stUnrealized(p, mark) }; }) };
  }
}
