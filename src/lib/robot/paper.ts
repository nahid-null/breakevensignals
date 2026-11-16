/** Simulated execution and position management. Real market data, simulated orders only. */
import { PAPER_LEVERAGE, TARGET_NET_ROI_PCT, type RobotSettings } from './config';
import { MINUTE, type Bar, type SymbolState } from './series';
import type { Direction, Setup } from './strategy';
import { liquidationPrice, roundTick, sizeOrder, type SymbolRules } from './risk';

export type ExitReason = 'TAKE_PROFIT' | 'STOP_LOSS' | 'BREAKEVEN_STOP' | 'EARLY_EXIT' | 'PROFIT_EXIT' | 'TIME_EXIT' | 'LIQUIDATION' | 'EMERGENCY_STOP';
export type Position = {
  id: string; symbol: string; direction: Direction; status: 'OPEN' | 'CLOSED'; setup: Setup; score: number;
  leverage: number; band: string; entry: number; qty: number; qtyOpen: number; margin: number; notional: number;
  stop: number; initialStop: number; tp: number; liquidation: number; riskUsdt: number;
  entryFee: number; fees: number; funding: number; fundingApplied: number; realized: number;
  openedAt: number; closedAt: number | null; exitPrice: number | null; exitReason: ExitReason | null;
  lastCandleTime: number; version: number; liquidity: string; lastPrice: number; unrealized: number; tick: number;
  requestedQty: number; fillStatus: 'FILLED' | 'PARTIAL';
};
/** A change to the account. pnl is net of the fee for this fill. */
export type Fill = { kind: 'OPEN' | 'PARTIAL' | 'CLOSE' | 'FUNDING'; price: number; qty: number; pnl: number; fee: number; reason: ExitReason | 'TP1' | null; time: number };
export type BookLevel = readonly [price: number, qty: number];
export type DepthBook = { bids: BookLevel[]; asks: BookLevel[] };
export type MarketFill = { qty: number; avg: number; requested: number; partial: boolean; levels: number } | { rejected: string };

const slip = (s: RobotSettings) => s.slippage_bps / 10_000;
const taker = (s: RobotSettings) => s.fee_pct / 100;
const maker = (s: RobotSettings) => s.maker_fee_pct / 100;
const sgn = (d: Direction) => (d === 'LONG' ? 1 : -1);

/**
 * Walk the opposite side of the order book (taker), within 0.3% of the touch, then add latency slippage.
 * Fills less than the request when depth runs out; below half the request or the exchange minimum it is rejected.
 */
export function simulateMarketFill(direction: Direction, qty: number, book: DepthBook, s: RobotSettings, rules: SymbolRules): MarketFill {
  const side = direction === 'LONG' ? book.asks : book.bids;
  const top = side[0]?.[0];
  if (!top || !(top > 0)) return { rejected: 'No order book' };
  let left = qty; let cost = 0; let levels = 0;
  for (const [p, q] of side) {
    if (Math.abs(p - top) / top > 0.003 || left <= 0) break;
    const take = Math.min(left, q); cost += take * p; left -= take; levels++;
  }
  const filled = Math.floor((qty - left) / rules.stepSize + 1e-9) * rules.stepSize;
  if (filled <= 0) return { rejected: 'Insufficient order book depth' };
  const avg = (cost / (qty - left)) * (1 + sgn(direction) * slip(s));
  if (filled < 0.5 * qty) return { rejected: 'Insufficient order book depth (under half filled)' };
  if (filled * avg < rules.minNotional) return { rejected: 'Partial fill below exchange minimum' };
  return { qty: filled, avg, requested: qty, partial: filled < qty - 1e-12, levels };
}

/** Exit price at which NET ROI on allocated margin equals the target, given costs already paid (entry fee, funding). */
export function netTargetPrice(p: Pick<Position, 'direction' | 'entry' | 'qtyOpen' | 'margin' | 'entryFee' | 'funding' | 'tick'>, s: RobotSettings, roiPct = TARGET_NET_ROI_PCT) {
  const T = (roiPct / 100) * p.margin; const q = p.qtyOpen; const m = maker(s); const sunk = p.entryFee - p.funding;
  const raw = p.direction === 'LONG' ? (T + sunk + p.entry * q) / (q * (1 - m)) : (p.entry * q - sunk - T) / (q * (1 + m));
  return roundTick(raw, p.tick, p.direction === 'LONG' ? 'up' : 'down');
}
/** Exit price (taker, with slippage) that would realise the given NET ROI. Used to lock profit by tightening the stop. */
function lockPrice(p: Position, s: RobotSettings, roiPct: number) {
  const T = (roiPct / 100) * p.margin; const q = p.qtyOpen; const t = taker(s); const sunk = p.entryFee - p.funding;
  const raw = p.direction === 'LONG' ? (T + sunk + p.entry * q) / (q * (1 - t)) / (1 - slip(s)) : (p.entry * q - sunk - T) / (q * (1 + t)) / (1 + slip(s));
  return roundTick(raw, p.tick, p.direction === 'LONG' ? 'up' : 'down');
}
/** NET ROI (%) if the remaining size were closed at this price with a taker exit. */
export function netRoi(p: Position, price: number, s: RobotSettings) {
  const exitPx = price * (1 - sgn(p.direction) * slip(s));
  const pnl = sgn(p.direction) * (exitPx - p.entry) * p.qtyOpen - exitPx * p.qtyOpen * taker(s) + p.realized;
  return p.margin > 0 ? (pnl / p.margin) * 100 : 0;
}

export type OpenOrder = { id: string; symbol: string; direction: Direction; setup: Setup; score: number; tier: string; stop: number; liquidity: string };
/** Build the position from an actual simulated fill. TP is computed from the real fill price, quantity and fee. */
export function openPosition(o: OpenOrder, fill: { qty: number; avg: number; requested: number; partial: boolean }, rules: SymbolRules, time: number, s: RobotSettings):
  { position: Position; fill: Fill } | { rejected: string } {
  const sized = sizeOrder((fill.qty * fill.avg) / PAPER_LEVERAGE, fill.avg, { ...rules, stepSize: rules.stepSize });
  if ('rejected' in sized) return sized;
  const sign = sgn(o.direction);
  if ((o.stop - fill.avg) * sign >= 0) return { rejected: 'Fill price crossed the stop' };
  const entryFee = fill.qty * fill.avg * taker(s);
  const liquidation = liquidationPrice(fill.avg, o.direction);
  const stopDist = Math.abs(fill.avg - o.stop);
  if (Math.abs(fill.avg - liquidation) < 1.5 * stopDist) return { rejected: 'Stop too close to 50x liquidation' };
  const position: Position = { id: o.id, symbol: o.symbol, direction: o.direction, status: 'OPEN', setup: o.setup, score: o.score,
    leverage: PAPER_LEVERAGE, band: `${o.tier} · ${fill.partial ? 'partial fill' : 'full fill'}`, entry: fill.avg, qty: fill.qty, qtyOpen: fill.qty,
    margin: (fill.qty * fill.avg) / PAPER_LEVERAGE, notional: fill.qty * fill.avg, stop: o.stop, initialStop: o.stop, tp: 0, liquidation,
    riskUsdt: fill.qty * stopDist + entryFee + o.stop * fill.qty * taker(s), entryFee, fees: entryFee, funding: 0, fundingApplied: 0, realized: -entryFee,
    openedAt: time, closedAt: null, exitPrice: null, exitReason: null, lastCandleTime: Math.floor(time / MINUTE) * MINUTE, version: 1,
    liquidity: o.liquidity, lastPrice: fill.avg, unrealized: 0, tick: rules.tickSize, requestedQty: fill.requested, fillStatus: fill.partial ? 'PARTIAL' : 'FILLED' };
  position.tp = netTargetPrice(position, s);
  return { position, fill: { kind: 'OPEN', price: fill.avg, qty: fill.qty, pnl: -entryFee, fee: entryFee, reason: null, time } };
}

function exit(p: Position, price: number, fee: number, time: number, reason: ExitReason): Fill {
  const qty = p.qtyOpen;
  const pnl = sgn(p.direction) * (price - p.entry) * qty - fee;
  p.fees += fee; p.realized += pnl; p.qtyOpen = 0; p.status = 'CLOSED'; p.closedAt = time; p.exitPrice = price; p.exitReason = reason;
  p.unrealized = 0; p.lastPrice = price; p.version++;
  return { kind: 'CLOSE', price, qty, pnl, fee, reason, time };
}
const stopReason = (p: Position): ExitReason => ((p.stop - p.initialStop) * sgn(p.direction) > 0 ? 'BREAKEVEN_STOP' : 'STOP_LOSS');
function stopOut(p: Position, px: number, s: RobotSettings, time: number): Fill {
  const long = p.direction === 'LONG';
  if (long ? px <= p.liquidation : px >= p.liquidation) {
    // Gap through liquidation: the isolated margin of the position is lost.
    const loss = p.margin + p.realized; const f: Fill = { kind: 'CLOSE', price: p.liquidation, qty: p.qtyOpen, pnl: -p.margin - 0, fee: 0, reason: 'LIQUIDATION', time };
    p.realized = -p.margin + Math.min(0, p.realized - loss + p.margin); p.qtyOpen = 0; p.status = 'CLOSED'; p.closedAt = time;
    p.exitPrice = p.liquidation; p.exitReason = 'LIQUIDATION'; p.unrealized = 0; p.version++;
    p.realized = -p.margin - p.fees; f.pnl = p.realized - (-p.entryFee + p.funding) ; return f;
  }
  return exit(p, px, px * p.qtyOpen * taker(s), time, stopReason(p));
}
export function closeAtMarket(p: Position, price: number, s: RobotSettings, time: number, reason: ExitReason) {
  const px = price * (1 - sgn(p.direction) * slip(s));
  return exit(p, px, px * p.qtyOpen * taker(s), time, reason);
}
function markToMarket(p: Position, price: number, s: RobotSettings) {
  const exitPx = price * (1 - sgn(p.direction) * slip(s));
  p.lastPrice = price; p.unrealized = sgn(p.direction) * (exitPx - p.entry) * p.qtyOpen - exitPx * p.qtyOpen * taker(s);
}

/** Real-time check on best bid/ask: stop-market on the touch, resting TP limit filled when the touch reaches it. */
export function manageTick(p: Position, bid: number, ask: number, time: number, s: RobotSettings): Fill[] {
  if (p.status !== 'OPEN' || !(bid > 0) || !(ask >= bid)) return [];
  const long = p.direction === 'LONG'; const touch = long ? bid : ask;
  if (long ? touch <= p.stop : touch >= p.stop) return [stopOut(p, touch * (1 - sgn(p.direction) * slip(s)), s, time)];
  if (long ? touch >= p.tp : touch <= p.tp) return [exit(p, p.tp, p.tp * p.qtyOpen * maker(s), time, 'TAKE_PROFIT')];
  markToMarket(p, (bid + ask) / 2, s);
  return [];
}

/** Manage one open position over one closed 1m bar. Stops are only ever tightened. */
export function managePosition(p: Position, bar: Bar, st: SymbolState, s: RobotSettings): Fill[] {
  if (p.status !== 'OPEN' || bar.time <= p.lastCandleTime) return [];
  const fills: Fill[] = []; const long = p.direction === 'LONG'; const sign = sgn(p.direction);
  const at = bar.time + MINUTE; p.lastCandleTime = bar.time;
  // Funding settles on the open position at the funding timestamp (live data only).
  const f = st.funding;
  if (f && f.next > p.openedAt && f.next <= at && f.next > p.fundingApplied) {
    const amount = -sign * f.rate * p.qtyOpen * bar.close;
    p.funding += amount; p.realized += amount; p.fundingApplied = f.next; p.version++;
    fills.push({ kind: 'FUNDING', price: bar.close, qty: p.qtyOpen, pnl: amount, fee: 0, reason: null, time: f.next });
    p.tp = netTargetPrice(p, s);
  }
  // Stop first (conservative when stop and target share a bar), then the resting TP limit.
  if (long ? bar.low <= p.stop : bar.high >= p.stop) {
    const px = (long ? Math.min(bar.open, p.stop) : Math.max(bar.open, p.stop)) * (1 - sign * slip(s));
    fills.push(stopOut(p, px, s, at)); return fills;
  }
  if (long ? bar.high > p.tp : bar.low < p.tp) {
    const px = long ? Math.max(bar.open, p.tp) : Math.min(bar.open, p.tp);
    fills.push(exit(p, px, px * p.qtyOpen * maker(s), at, 'TAKE_PROFIT')); return fills;
  }
  const roi = netRoi(p, bar.close, s);
  // Lock profit once the trade has done most of the work: stop tightened to +2% net ROI.
  if (roi >= 6) { const lock = lockPrice(p, s, 2); if ((lock - p.stop) * sign > 0 && (bar.close - lock) * sign > 0) { p.stop = lock; p.version++; } }
  const age = at - p.openedAt;
  let reason: ExitReason | null = null;
  const hist = st.m5.macd.hist ?? 0; const prevHist = st.m5.prevHist ?? hist; const e9m1 = st.m1.ema9.value ?? bar.close;
  if (roi >= 4 && (bar.close - e9m1) * sign < 0 && (hist - prevHist) * sign < 0) reason = 'PROFIT_EXIT';
  else if (st.signalClosed && roi < 0) {
    const sb = st.m5.last(); const e21 = st.m5.ema21.value;
    if (sb && e21 !== null && (sb.close - e21) * sign < 0 && hist * sign < 0 && (hist - prevHist) * sign < 0) reason = 'EARLY_EXIT';
  }
  if (!reason && age >= s.max_hold_minutes * MINUTE) reason = 'TIME_EXIT';
  if (reason) { fills.push(closeAtMarket(p, bar.close, s, at, reason)); return fills; }
  markToMarket(p, bar.close, s);
  return fills;
}
