import type { RobotSettings } from './config';
import type { Bar, SymbolState } from './series';
import type { Candidate, Direction, Setup } from './strategy';
import type { Sizing } from './risk';

export type ExitReason = 'TAKE_PROFIT' | 'STOP_LOSS' | 'BREAKEVEN_STOP' | 'EARLY_EXIT' | 'PROFIT_EXIT' | 'TIME_EXIT' | 'LIQUIDATION' | 'EMERGENCY_STOP';
export type Position = {
  id: string; symbol: string; direction: Direction; status: 'OPEN' | 'CLOSED'; setup: Setup; score: number;
  leverage: number; band: string; entry: number; qty: number; qtyOpen: number; margin: number; notional: number;
  stop: number; initialStop: number; tp1: number; tp2: number; liquidation: number; riskUsdt: number; tp1Done: boolean;
  fees: number; realized: number; openedAt: number; closedAt: number | null; exitPrice: number | null; exitReason: ExitReason | null;
  lastCandleTime: number; version: number; liquidity: string; lastPrice: number; unrealized: number;
};
/** A fill that changes the account. pnl is net of the fee for this fill. */
export type Fill = { kind: 'OPEN' | 'PARTIAL' | 'CLOSE'; price: number; qty: number; pnl: number; fee: number; reason: ExitReason | 'TP1' | null; time: number };

const slip = (s: RobotSettings) => s.slippage_bps / 10_000;
const fee = (s: RobotSettings, price: number, qty: number) => price * qty * s.fee_pct / 100;

export function openPosition(c: Candidate, z: Sizing, fill: number, time: number, s: RobotSettings): { position: Position; fill: Fill } {
  const entryFee = fee(s, fill, z.qty);
  const position: Position = { id: `${c.symbol}-${c.direction}-${c.time}`, symbol: c.symbol, direction: c.direction, status: 'OPEN',
    setup: c.setup, score: c.score, leverage: z.leverage, band: z.band, entry: fill, qty: z.qty, qtyOpen: z.qty, margin: z.margin,
    notional: z.notional, stop: c.stop, initialStop: c.stop, tp1: c.tp1, tp2: c.tp2, liquidation: z.liquidation, riskUsdt: z.riskUsdt,
    tp1Done: false, fees: entryFee, realized: -entryFee, openedAt: time, closedAt: null, exitPrice: null, exitReason: null,
    lastCandleTime: time - 60_000, version: 1, liquidity: c.liquidity, lastPrice: fill, unrealized: 0 };
  return { position, fill: { kind: 'OPEN', price: fill, qty: z.qty, pnl: -entryFee, fee: entryFee, reason: null, time } };
}

function exit(p: Position, price: number, qty: number, s: RobotSettings, time: number, reason: ExitReason | 'TP1'): Fill {
  const sign = p.direction === 'LONG' ? 1 : -1;
  const f = fee(s, price, qty);
  const pnl = sign * (price - p.entry) * qty - f;
  p.fees += f; p.realized += pnl; p.qtyOpen -= qty;
  p.margin = p.qtyOpen > 1e-12 ? (p.qtyOpen * p.entry) / p.leverage : 0;
  if (reason !== 'TP1' && p.qtyOpen <= 1e-12) {
    p.qtyOpen = 0; p.status = 'CLOSED'; p.closedAt = time; p.exitPrice = price; p.exitReason = reason; p.unrealized = 0;
  }
  p.version++;
  return { kind: reason === 'TP1' ? 'PARTIAL' : 'CLOSE', price, qty, pnl, fee: f, reason, time };
}

export function closeAtMarket(p: Position, price: number, s: RobotSettings, time: number, reason: ExitReason) {
  const sign = p.direction === 'LONG' ? 1 : -1;
  return exit(p, price * (1 - sign * slip(s)), p.qtyOpen, s, time, reason);
}

/** Manage one open position over one closed 1m bar. Stops are only ever tightened. */
export function managePosition(p: Position, bar: Bar, st: SymbolState, s: RobotSettings): Fill[] {
  if (p.status !== 'OPEN' || bar.time <= p.lastCandleTime) return [];
  const fills: Fill[] = []; const long = p.direction === 'LONG'; const sign = long ? 1 : -1;
  const at = bar.time + 60_000; p.lastCandleTime = bar.time;
  const done = () => { p.lastPrice = bar.close; return fills; };
  // 1. Gap through liquidation: isolated margin of the remaining size is lost.
  if (long ? bar.open <= p.liquidation : bar.open >= p.liquidation) {
    const loss = p.margin; const f: Fill = { kind: 'CLOSE', price: p.liquidation, qty: p.qtyOpen, pnl: -loss, fee: 0, reason: 'LIQUIDATION', time: at };
    p.realized -= loss; p.qtyOpen = 0; p.margin = 0; p.status = 'CLOSED'; p.closedAt = at; p.exitPrice = p.liquidation; p.exitReason = 'LIQUIDATION'; p.version++;
    fills.push(f); return done();
  }
  // 2. Protective stop first (conservative when stop and target share a bar).
  if (long ? bar.low <= p.stop : bar.high >= p.stop) {
    const px = (long ? Math.min(bar.open, p.stop) : Math.max(bar.open, p.stop)) * (1 - sign * slip(s));
    fills.push(exit(p, px, p.qtyOpen, s, at, p.tp1Done ? 'BREAKEVEN_STOP' : 'STOP_LOSS')); return done();
  }
  // 3. Targets: half at TP1, then protect the rest at breakeven plus costs.
  if (!p.tp1Done && (long ? bar.high >= p.tp1 : bar.low <= p.tp1)) {
    const half = p.tp2 === p.tp1 ? p.qtyOpen : p.qtyOpen / 2;
    fills.push(exit(p, p.tp1, half, s, at, p.tp2 === p.tp1 ? 'TAKE_PROFIT' : 'TP1'));
    if (p.status === 'CLOSED') return done();
    p.tp1Done = true;
    const be = p.entry * (1 + sign * 2 * (s.fee_pct / 100 + slip(s)));
    p.stop = long ? Math.max(p.stop, be) : Math.min(p.stop, be);
  }
  if (p.tp1Done && (long ? bar.high >= p.tp2 : bar.low <= p.tp2)) { fills.push(exit(p, p.tp2, p.qtyOpen, s, at, 'TAKE_PROFIT')); return done(); }
  // 4. Close-based protection, never on ordinary intrabar noise.
  const m1 = st.m1; const atr = m1.atr.value ?? 0; const close = bar.close;
  const hist = m1.macd.hist ?? 0; const prevHist = m1.prevHist ?? hist;
  const ema21 = m1.ema21.value ?? close; const ema9 = m1.ema9.value ?? close; const m5ema21 = st.m5.ema21.value ?? close;
  const net = sign * (close - p.entry) * p.qtyOpen - fee(s, close, p.qtyOpen);
  const age = at - p.openedAt;
  let reason: ExitReason | null = null;
  const opposingSweep = st.levels.some((l) => l.sweptAt === bar.time && l.side === (long ? 'high' : 'low') && (close - l.price) * sign < 0);
  if (!p.tp1Done && (close - ema21) * sign < 0 && hist * sign < 0 && (hist - prevHist) * sign < 0 && (close - m5ema21) * sign < 0) reason = 'EARLY_EXIT';
  else if (opposingSweep && (net < 0 || p.tp1Done)) reason = p.tp1Done ? 'PROFIT_EXIT' : 'EARLY_EXIT';
  else if (atr > 0 && bar.high - bar.low > 4 * atr && (close - bar.open) * sign < 0) reason = 'EARLY_EXIT';
  else if (p.tp1Done && (close - ema9) * sign < 0 && (hist - prevHist) * sign < 0 && ((m1.rsi.value ?? 50) - (m1.prevRsi ?? 50)) * sign < 0) reason = 'PROFIT_EXIT';
  else if (age >= s.max_hold_minutes * 60_000) reason = 'TIME_EXIT';
  else if (!p.tp1Done && age >= s.max_hold_minutes * 0.6 * 60_000 && net <= 0) reason = 'TIME_EXIT';
  if (reason) { fills.push(closeAtMarket(p, close, s, at, reason)); return done(); }
  p.unrealized = net; return done();
}
