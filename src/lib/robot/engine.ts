import type { RobotSettings } from './config';
import { managePosition, type Fill, type Position } from './paper';
import { portfolioGate, type Account, type OpenExposure } from './risk';
import type { Bar, SymbolState } from './series';
import { evaluate, type BookContext, type Candidate, type Evaluation } from './strategy';

export const WARMUP_BARS = 3300;
const NO_BOOK: BookContext = { spreadBps: null, imbalance: null, depthUsd: null };

/** Shared by the backtest and the live worker: update state on a closed bar, then manage that coin's positions. */
export function stepSymbol(st: SymbolState, bar: Bar, open: Position[], s: RobotSettings): { accepted: boolean; fills: { position: Position; fill: Fill }[] } {
  if (!st.update(bar)) return { accepted: false, fills: [] };
  const fills: { position: Position; fill: Fill }[] = [];
  for (const p of open) if (p.symbol === st.symbol && p.status === 'OPEN') for (const f of managePosition(p, bar, st, s)) fills.push({ position: p, fill: f });
  return { accepted: true, fills };
}

export function evaluateBoth(st: SymbolState, s: RobotSettings, book: BookContext = NO_BOOK): Evaluation[] {
  if (st.count < WARMUP_BARS || !st.signalClosed) return [];
  return [evaluate(st, 'LONG', s, book), evaluate(st, 'SHORT', s, book)];
}

/** Abnormal market conditions: a violent BTC minute or a fast 5-minute move suspends new entries. */
export function abnormalMarket(btc: SymbolState | undefined): string | null {
  const bars = btc?.m1.bars; const last = bars?.at(-1); const back = bars?.at(-6);
  if (!last || !back) return null;
  if ((last.high - last.low) / last.close > 0.012) return 'BTC minute range above 1.2%';
  if (Math.abs(last.close - back.close) / back.close > 0.02) return 'BTC moved more than 2% in 5 minutes';
  return null;
}

export const exposure = (open: Position[]): OpenExposure[] => open.filter((p) => p.status === 'OPEN')
  .map((p) => ({ symbol: p.symbol, direction: p.direction, margin: p.margin, riskUsdt: p.riskUsdt, notional: p.qtyOpen * p.entry }));

/** Best qualified candidate that passes every portfolio gate. One clean setup beats several weak ones. */
export function pickEntry(evals: Evaluation[], open: Position[], acct: Account, s: RobotSettings, now: number) {
  const qualified = evals.flatMap((e) => (e.candidate && !e.rejected ? [e.candidate] : [])).sort((a, b) => b.score - a.score);
  const skipped: { candidate: Candidate; reason: string }[] = [];
  for (const c of qualified) {
    const reason = portfolioGate(c, exposure(open), acct, s, now);
    if (!reason) return { chosen: c, skipped };
    skipped.push({ candidate: c, reason });
  }
  return { chosen: null, skipped };
}
