import { z } from 'zod';
import { CSTF_INTERVAL, CSTF_SYMBOLS, type CstfSignal, type CstfSymbol } from './cstf';
import { CSTF_RULES, cstfUnrealized, type AccountResult, type AccountState, type Brackets, type CstfClose } from './cstf-account';
import { MINUTE } from './model';

/** prompt-74 live wiring helpers for the exact prompt-71 CSTF Simulator. Pure: no network, no database. */
/** A frame is live only when processed promptly after its 1-minute close; older frames are catch-up (no new entries). */
export const CSTF_LIVE_LAG_MS = 3 * MINUTE;
export const CSTF_WARM_BARS = 1440; // same 30-day 30m warm-up as the prompt-71 backtest
export const CSTF_MAX_BATCH = 240;

export function frameMode(frameTime: number, now: number): 'live' | 'recovery' {
  return now - (frameTime + MINUTE) <= CSTF_LIVE_LAG_MS ? 'live' : 'recovery';
}
/** The 30m bar whose confirmed close gives signals at this frame, or null when the frame is not on a 30m boundary. */
export function signalBarFor(frameTime: number): number | null {
  return frameTime % CSTF_INTERVAL === 0 ? frameTime - CSTF_INTERVAL : null;
}
/** Warm-up uses only bars whose signal frame was already processed; the next frame's bar stays for live evaluation. */
export function warmBars<T extends { time: number }>(bars: T[], nextFrame: number): T[] {
  return bars.filter((b) => b.time % CSTF_INTERVAL === 0 && b.time + CSTF_INTERVAL < nextFrame);
}
/** Same bucketing as bt71.py: funding applies in the minute containing fundingTime. */
export function fundingByMinute(rows: { fundingTime: number | string; fundingRate: number | string }[]): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const r of rows) {
    const t = Math.floor(Number(r.fundingTime) / MINUTE) * MINUTE; const rate = Number(r.fundingRate);
    if (!Number.isFinite(t) || !Number.isFinite(rate)) throw new Error('Invalid Binance funding row');
    out.set(t, [...(out.get(t) ?? []), rate]);
  }
  return out;
}
type RawBracket = { bracketNotionalFloor: number; bracketNotionalCap: number; bracketMaintenanceMarginRate: number; cumFastMaintenanceAmount: number; maxOpenPosLeverage: number };
/** Binance public tier list (same source as the backtest) for exactly the 22 coins. */
export function parseBrackets(body: unknown): Brackets {
  const list = (body as { data?: { brackets?: { symbol: string; riskBrackets: RawBracket[] }[] } })?.data?.brackets;
  if (!Array.isArray(list)) throw new Error('Binance maintenance tiers unavailable');
  const out = {} as Brackets;
  for (const s of CSTF_SYMBOLS) {
    const row = list.find((b) => b.symbol === s);
    if (!row?.riskBrackets?.length) throw new Error(`Binance maintenance tiers missing: ${s}`);
    out[s] = [...row.riskBrackets].sort((a, b) => a.bracketNotionalFloor - b.bracketNotionalFloor).map((b) => ({ floor: Number(b.bracketNotionalFloor), cap: Number(b.bracketNotionalCap),
      rate: Number(b.bracketMaintenanceMarginRate), cumulative: Number(b.cumFastMaintenanceAmount), maxLeverage: Number(b.maxOpenPosLeverage) }));
  }
  return out;
}

const round = (n: number, d = 8) => Number(n.toFixed(d));
const usd = (n: number) => `${n < 0 ? '-' : n > 0 ? '+' : ''}$${Math.abs(n).toFixed(4)}`;
export function cstfResultMessage(c: CstfClose, mode: 'live' | 'recovery'): string {
  const p = c.position; const t = new Date(c.time).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  return ['SIMULATOR — TRADE RESULT', `Status: ${c.reason === 'TAKE_PROFIT' ? 'Take profit hit' : 'Liquidated (cross margin)'}`,
    `${p.signal.symbol} ${p.signal.side} · ${CSTF_RULES.leverage}x cross`, `Signal: CSTF v4 Strong Trend 30m — ${p.signal.pattern}`,
    `Entry: ${round(p.entry)}`, `Exit: ${round(c.price)}`, `Margin: $${p.margin.toFixed(2)}`,
    `Net P&L: ${usd(c.net)} (fees ${(p.entryFee + c.exitFee).toFixed(4)}, funding ${p.funding.toFixed(4)})`, `Wallet: $${c.walletAfter.toFixed(4)}`, `Time: ${t}`,
    ...(mode === 'recovery' ? ['Detected while the scanner caught up after an interruption.'] : []),
    'Practice money only; fees and modeled slippage included.'].join('\n');
}

const finite = z.number().finite();
const sym = z.enum(CSTF_SYMBOLS);
const signalSchema = z.object({ id: z.string().min(8).max(80), symbol: sym, side: z.enum(['LONG', 'SHORT']), pattern: z.string().max(200), signalTime: z.number().int(), confirmTime: z.number().int(), close: finite, atr: finite });
const positionSchema = z.object({ signal: signalSchema, entryTime: z.number().int(), entry: finite.positive(), quantity: finite.positive(), margin: finite.positive(), entryFee: finite.nonnegative(), funding: finite, target: finite.positive(), liquidationPrice: finite.nonnegative() });
export const cstfStateSchema = z.object({ version: z.literal(CSTF_RULES.version), wallet: finite, positions: z.array(positionSchema).max(CSTF_RULES.slots), lastMinute: z.number().int().nullable(), fees: finite, funding: finite, liquidationClearance: finite });
export const cstfCommitSchema = z.object({
  instance_id: z.string().uuid(), expected_revision: z.number().int().min(0), state: cstfStateSchema,
  first_minute: z.number().int(), equity: finite, maintenance: finite, mode: z.enum(['live', 'recovery']),
  opened: z.array(z.object({ signal_id: z.string(), symbol: sym, side: z.enum(['LONG', 'SHORT']), pattern: z.string(), signal_time: z.number().int(), entry_time: z.number().int(), entry_price: finite, quantity: finite, margin: finite, entry_fee: finite, target: finite, liquidation_price: finite })).max(CSTF_MAX_BATCH * CSTF_RULES.slots),
  closed: z.array(z.object({ signal_id: z.string(), reason: z.enum(['TAKE_PROFIT', 'LIQUIDATED']), exit_time: z.number().int(), exit_price: finite, gross: finite, exit_fee: finite, funding: finite, net: finite, wallet_after: finite, mode: z.enum(['live', 'recovery']), message: z.string().max(2000) })).max(CSTF_MAX_BATCH * CSTF_RULES.slots),
  open: z.array(z.object({ signal_id: z.string(), target: finite, liquidation_price: finite, funding: finite, mark_price: finite, unrealized: finite })).max(CSTF_RULES.slots),
  skipped: z.array(z.object({ signal_id: z.string(), symbol: sym, side: z.enum(['LONG', 'SHORT']), pattern: z.string(), signal_time: z.number().int(), reason: z.string().max(60), mode: z.enum(['live', 'recovery']) })).max(2000),
});
export type CstfCommit = z.infer<typeof cstfCommitSchema>;

/** Accumulates consecutive account transitions into one atomic commit payload. */
export class CstfBatch {
  opened: CstfCommit['opened'] = []; closed: CstfCommit['closed'] = []; skipped: CstfCommit['skipped'] = [];
  mode: 'live' | 'recovery' = 'recovery'; frames = 0; equity = 0; maintenance = 0; lastMarks: Partial<Record<CstfSymbol, number>> = {};
  constructor(readonly firstMinute: number) {}
  add(r: AccountResult, mode: 'live' | 'recovery', closeMarks: Record<CstfSymbol, number>) {
    if (r.duplicate) return;
    this.frames++; if (mode === 'live') this.mode = 'live'; this.equity = r.equity; this.maintenance = r.maintenance; this.lastMarks = closeMarks;
    const sig = (s: CstfSignal) => ({ signal_id: s.id, symbol: s.symbol, side: s.side, pattern: s.pattern, signal_time: s.signalTime });
    for (const p of r.opened) this.opened.push({ ...sig(p.signal), entry_time: p.entryTime, entry_price: p.entry, quantity: p.quantity, margin: p.margin, entry_fee: p.entryFee, target: p.target, liquidation_price: p.liquidationPrice });
    for (const c of r.closed) this.closed.push({ signal_id: c.position.signal.id, reason: c.reason, exit_time: c.time, exit_price: c.price, gross: c.gross, exit_fee: c.exitFee, funding: c.position.funding, net: c.net, wallet_after: c.walletAfter, mode, message: cstfResultMessage(c, mode) });
    for (const s of r.skipped) this.skipped.push({ ...sig(s.signal), reason: s.reason, mode });
  }
  payload(instance: string, revision: number, state: AccountState): CstfCommit {
    return { instance_id: instance, expected_revision: revision, state, first_minute: this.firstMinute, equity: this.equity, maintenance: this.maintenance, mode: this.mode,
      opened: this.opened, closed: this.closed, skipped: this.skipped,
      open: state.positions.map((p) => { const mark = this.lastMarks[p.signal.symbol] ?? p.entry; return { signal_id: p.signal.id, target: p.target, liquidation_price: p.liquidationPrice, funding: p.funding, mark_price: mark, unrealized: cstfUnrealized(p, mark) }; }) };
  }
}
