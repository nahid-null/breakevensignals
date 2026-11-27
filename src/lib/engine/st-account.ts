import { ST_SYMBOLS, type StSide, type StSignal, type StSymbol } from './supertrend';
import { MINUTE, validateCandle, type Candle } from './model';

/** prompt-81 SuperTrend continuous-reversal paper account. Pure accounting only (no network, no database).
 * - 5 dedicated slots, one per coin; a signal on one coin never touches another coin's position.
 * - BUY opens LONG, SELL opens SHORT; an opposite signal closes the open trade and immediately opens the reverse.
 * - Same-direction signal while already in that direction: nothing happens.
 * - No stop loss, no take profit, no time exit. The only other close is a cross-margin liquidation of the whole account.
 * - Margin per NEW trade = 5% of the CURRENT main balance (after the reversed trade's result is booked), 75x, cross.
 */
export const ST_RULES = { version: 'ST30_REVERSAL_V1', startingBalance: 10, marginRate: .05, leverage: 75, slots: ST_SYMBOLS.length, feeRate: .0005, slippageRate: .0002 } as const;
export interface MaintenanceBracket { floor: number; cap: number; rate: number; cumulative: number; maxLeverage: number }
export type StBrackets = Record<StSymbol, MaintenanceBracket[]>;
export interface StPosition { id: string; symbol: StSymbol; side: StSide; signalTime: number; entryTime: number; entry: number; quantity: number; margin: number; entryFee: number; funding: number; liquidationPrice: number }
export type StCloseReason = 'OPPOSITE_SIGNAL' | 'LIQUIDATED';
export interface StClose { position: StPosition; reason: StCloseReason; time: number; price: number; gross: number; exitFee: number; net: number; walletAfter: number; mainAfter: number; reversedTo: string | null; notify: boolean }
export interface StAccountState { version: typeof ST_RULES.version; wallet: number; positions: StPosition[]; lastMinute: number | null; fees: number; funding: number; liquidationClearance: number; liquidations: number }
export interface StMinuteFrame { time: number; last: Record<StSymbol, Candle>; mark: Record<StSymbol, Candle>; funding: Partial<Record<StSymbol, number[]>>; signals: StSignal[]; mode: 'live' | 'recovery' }
export type StSkipReason = 'ALREADY_IN_DIRECTION' | 'NOT_LIVE' | 'LEVERAGE_UNAVAILABLE' | 'INSUFFICIENT_AVAILABLE_MARGIN';
export interface StResult { state: StAccountState; closed: StClose[]; opened: StPosition[]; skipped: { signal: StSignal; reason: StSkipReason }[]; equity: number; maintenance: number; duplicate: boolean }

export const initialStAccount = (): StAccountState => ({ version: ST_RULES.version, wallet: ST_RULES.startingBalance, positions: [], lastMinute: null, fees: 0, funding: 0, liquidationClearance: 0, liquidations: 0 });
const dir = (side: StSide) => side === 'LONG' ? 1 : -1;
export const stMarginFor = (mainBalance: number) => Math.max(0, ST_RULES.marginRate * mainBalance);
/** Main balance = $10 + every CLOSED trade's net result (open trades' already-paid entry fees and funding added back). */
export const stMainBalance = (s: Pick<StAccountState, 'wallet' | 'positions'>) => s.wallet + s.positions.reduce((v, p) => v + p.entryFee + p.funding, 0);
export const stUnrealized = (p: Pick<StPosition, 'side' | 'quantity' | 'entry'>, price: number) => dir(p.side) * p.quantity * (price - p.entry);
export function maintenanceBracket(brackets: MaintenanceBracket[], notional: number): MaintenanceBracket {
  const found = brackets.find(b => notional >= b.floor && notional < b.cap) ?? brackets.at(-1);
  if (!found) throw new Error('Binance maintenance brackets unavailable');
  return found;
}
export function stMaintenance(p: StPosition, price: number, brackets: StBrackets) {
  const n = p.quantity * price; const b = maintenanceBracket(brackets[p.symbol], n);
  return n * b.rate - b.cumulative;
}
/** Cross-margin liquidation price of one position with the other slots held at their mark prices. */
export function stLiquidationPrice(p: StPosition, state: StAccountState, marks: Record<StSymbol, number>, brackets: StBrackets) {
  const others = state.positions.filter(x => x !== p);
  const u = others.reduce((v, x) => v + stUnrealized(x, marks[x.symbol]), 0);
  const m = others.reduce((v, x) => v + stMaintenance(x, marks[x.symbol], brackets), 0);
  const b = maintenanceBracket(brackets[p.symbol], p.quantity * p.entry); const d = dir(p.side);
  return Math.max((state.wallet - m + u + b.cumulative - d * p.quantity * p.entry) / (p.quantity * b.rate - d * p.quantity), 0);
}
function validate(frame: StMinuteFrame, brackets: StBrackets) {
  if (!Number.isInteger(frame.time) || frame.time < 0 || frame.time % MINUTE !== 0) throw new Error('Invalid minute frame');
  for (const s of ST_SYMBOLS) {
    for (const c of [frame.last[s], frame.mark[s]]) { if (!c || c.time !== frame.time) throw new Error(`Incomplete account-wide frame: ${s}`); validateCandle(c); }
    const tiers = brackets[s];
    if (!tiers?.length || tiers.some((b, i) => ![b.floor, b.cap, b.rate, b.cumulative, b.maxLeverage].every(Number.isFinite) || b.floor < 0 || b.cap <= b.floor || b.rate < 0 || b.rate >= 1 || b.cumulative < 0 || (i === 0 ? b.floor !== 0 : tiers[i - 1]?.cap !== b.floor))) throw new Error(`Invalid maintenance tiers: ${s}`);
    if ((frame.funding[s] ?? []).some(x => !Number.isFinite(x))) throw new Error('Invalid funding data');
  }
  if (new Set(frame.signals.map(s => s.symbol)).size !== frame.signals.length) throw new Error('Two signals for one coin in one minute');
  for (const s of frame.signals) {
    if (!(ST_SYMBOLS as readonly string[]).includes(s.symbol) || !['LONG', 'SHORT'].includes(s.side) || s.confirmTime !== frame.time || s.signalTime + 30 * MINUTE !== frame.time || s.signalTime % (30 * MINUTE) !== 0 || s.id !== `ST30-${s.symbol}-${s.side}-${s.signalTime}`) throw new Error('Invalid or late SuperTrend signal');
  }
}

/** Advances all five slots by one chronological minute. Order: funding -> per-coin signal (close opposite, then open
 * reverse at the minute's open price) -> worst-mark cross liquidation. Caller persists the result atomically. */
export function processStAccount(input: StAccountState, frame: StMinuteFrame, brackets: StBrackets): StResult {
  validate(frame, brackets);
  const state = structuredClone(input); const closed: StClose[] = []; const opened: StPosition[] = []; const skipped: StResult['skipped'] = [];
  const at = (k: 'open' | 'close') => Object.fromEntries(ST_SYMBOLS.map(s => [s, frame.mark[s][k]])) as Record<StSymbol, number>;
  const totals = (price: Record<StSymbol, number>) => ({ equity: state.wallet + state.positions.reduce((v, p) => v + stUnrealized(p, price[p.symbol]), 0), maintenance: state.positions.reduce((v, p) => v + stMaintenance(p, price[p.symbol], brackets), 0) });
  const marks = at('open');
  if (state.lastMinute !== null && frame.time <= state.lastMinute) return { state, closed, opened, skipped, ...totals(marks), duplicate: true };
  if (state.lastMinute !== null && frame.time !== state.lastMinute + MINUTE) throw new Error('Recover missing account-wide minutes before continuing');
  for (const p of state.positions) for (const rate of frame.funding[p.symbol] ?? []) {
    const cost = dir(p.side) * p.quantity * marks[p.symbol] * rate; p.funding += cost; state.wallet -= cost; state.funding += cost;
  }
  const notify = frame.mode === 'live';
  for (const signal of [...frame.signals].sort((a, b) => a.symbol.localeCompare(b.symbol))) {
    const open = state.positions.find(p => p.symbol === signal.symbol);
    if (open && open.side === signal.side) { skipped.push({ signal, reason: 'ALREADY_IN_DIRECTION' }); continue; }
    const px = frame.last[signal.symbol].open;
    let closing: StClose | null = null;
    if (open) {
      const d = dir(open.side); const price = px * (1 - d * ST_RULES.slippageRate);
      const gross = stUnrealized(open, price); const exitFee = ST_RULES.feeRate * open.quantity * price;
      state.wallet += gross - exitFee; state.fees += exitFee; state.positions = state.positions.filter(x => x !== open);
      closing = { position: structuredClone(open), reason: 'OPPOSITE_SIGNAL', time: frame.time, price, gross, exitFee, net: gross - open.entryFee - exitFee - open.funding, walletAfter: state.wallet, mainAfter: stMainBalance(state), reversedTo: null, notify };
      closed.push(closing);
    }
    const d = dir(signal.side); const entry = px * (1 + ST_RULES.slippageRate * d);
    const sized = stMarginFor(stMainBalance(state));
    let reason: StSkipReason | null = frame.mode === 'recovery' ? 'NOT_LIVE' : null;
    if (!(sized > 0)) { skipped.push({ signal, reason: reason ?? 'INSUFFICIENT_AVAILABLE_MARGIN' }); continue; }
    const quantity = sized * ST_RULES.leverage / entry; const margin = quantity * entry / ST_RULES.leverage; const entryFee = ST_RULES.feeRate * quantity * entry;
    if (maintenanceBracket(brackets[signal.symbol], quantity * entry).maxLeverage < ST_RULES.leverage) reason ??= 'LEVERAGE_UNAVAILABLE';
    if (totals(marks).equity - state.positions.reduce((v, p) => v + p.margin, 0) < margin + entryFee) reason ??= 'INSUFFICIENT_AVAILABLE_MARGIN';
    if (reason) { skipped.push({ signal, reason }); continue; }
    state.wallet -= entryFee; state.fees += entryFee;
    const p: StPosition = { id: signal.id, symbol: signal.symbol, side: signal.side, signalTime: signal.signalTime, entryTime: frame.time, entry, quantity, margin, entryFee, funding: 0, liquidationPrice: 0 };
    state.positions.push(p); p.liquidationPrice = stLiquidationPrice(p, state, marks, brackets); opened.push(structuredClone(p));
    if (closing) closing.reversedTo = p.id;
  }
  const worst = (p: StPosition) => p.side === 'LONG' ? frame.mark[p.symbol].low : frame.mark[p.symbol].high;
  const worstEquity = state.wallet + state.positions.reduce((v, p) => v + stUnrealized(p, worst(p)), 0);
  const worstMaintenance = state.positions.reduce((v, p) => v + stMaintenance(p, worst(p), brackets), 0);
  if (state.positions.length && worstEquity <= worstMaintenance) {
    let grossTotal = 0;
    for (const p of state.positions) {
      const price = worst(p); const gross = stUnrealized(p, price); grossTotal += gross;
      closed.push({ position: structuredClone(p), reason: 'LIQUIDATED', time: frame.time + MINUTE, price, gross, exitFee: 0, net: gross - p.entryFee - p.funding, walletAfter: 0, mainAfter: 0, reversedTo: null, notify });
    }
    // Cross liquidation clears all shared collateral; keep an explicit audit of residual loss rather than hide it.
    state.liquidationClearance += -state.wallet - grossTotal; state.wallet = 0; state.positions = []; state.liquidations++;
  }
  const closeMarks = at('close');
  for (const p of state.positions) p.liquidationPrice = stLiquidationPrice(p, state, closeMarks, brackets);
  state.lastMinute = frame.time;
  return { state, closed, opened, skipped, ...totals(closeMarks), duplicate: false };
}
