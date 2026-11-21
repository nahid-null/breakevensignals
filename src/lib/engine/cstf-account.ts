import { CSTF_SYMBOLS, type CstfSignal, type CstfSymbol } from './cstf';
import { MINUTE, validateCandle, type Candle } from './model';

/** prompt-71 MAIN calculations with the prompt-75 sizing correction. Pure paper accounting only.
 * Margin per NEW trade = marginRate × CURRENT wallet at entry ($10 → $0.50, $12 → $0.60); open trades keep their margin.
 * Take profit = targetRate × that trade's own margin, net of fees and funding ($0.50 → $0.10). */
export const CSTF_RULES = { version: 'CSTF30_CROSS_V1', startingBalance: 10, marginRate: .05, leverage: 75, slots: 7, targetRate: .20, feeRate: .0005, slippageRate: .0002 } as const;
/** 'current-wallet' is the live rule (prompt-75). 'fixed-initial' reproduces the prompt-71 backtest ($0.50 forever) for parity checks only. */
export type CstfSizing = 'current-wallet' | 'fixed-initial';
export const cstfMarginFor = (wallet: number, sizing: CstfSizing = 'current-wallet') => CSTF_RULES.marginRate * (sizing === 'fixed-initial' ? CSTF_RULES.startingBalance : wallet);
/** Main Balance = starting $10 + every CLOSED trade's net result. The wallet already paid open trades' entry fees and funding;
 * add them back so the balance only moves when trades close (as the user specified). */
export const cstfMainBalance = (s: Pick<AccountState, 'wallet' | 'positions'>) => s.wallet + s.positions.reduce((v, p) => v + p.entryFee + p.funding, 0);
export const cstfNetTarget = (p: Pick<CstfPosition, 'margin'>) => CSTF_RULES.targetRate * p.margin;
export interface MaintenanceBracket { floor: number; cap: number; rate: number; cumulative: number; maxLeverage: number }
export type Brackets = Record<CstfSymbol, MaintenanceBracket[]>;
export interface CstfPosition { signal: CstfSignal; entryTime: number; entry: number; quantity: number; margin: number; entryFee: number; funding: number; target: number; liquidationPrice: number }
export interface CstfClose { position: CstfPosition; reason: 'TAKE_PROFIT' | 'LIQUIDATED'; time: number; price: number; gross: number; exitFee: number; net: number; walletAfter: number; notify: boolean }
export interface AccountState { version: typeof CSTF_RULES.version; wallet: number; positions: CstfPosition[]; lastMinute: number | null; fees: number; funding: number; liquidationClearance: number }
export interface MinuteFrame { time: number; last: Record<CstfSymbol, Candle>; mark: Record<CstfSymbol, Candle>; funding: Partial<Record<CstfSymbol, number[]>>; signals: CstfSignal[]; mode: 'live' | 'recovery' }
export interface AccountResult { state: AccountState; closed: CstfClose[]; opened: CstfPosition[]; skipped: { signal: CstfSignal; reason: string }[]; equity: number; maintenance: number; duplicate: boolean }
export const initialCstfAccount = (): AccountState => ({ version: CSTF_RULES.version, wallet: CSTF_RULES.startingBalance, positions: [], lastMinute: null, fees: 0, funding: 0, liquidationClearance: 0 });
const direction = (p: CstfPosition) => p.signal.side === 'LONG' ? 1 : -1;
export const cstfUnrealized = (p: CstfPosition, price: number) => direction(p) * p.quantity * (price - p.entry);
export function maintenanceBracket(brackets: MaintenanceBracket[], notional: number): MaintenanceBracket {
  const found = brackets.find(b => notional >= b.floor && notional < b.cap) ?? brackets.at(-1);
  if (!found) throw new Error('Binance maintenance brackets unavailable');
  return found;
}
export function cstfMaintenance(p: CstfPosition, price: number, brackets: Brackets) {
  const n = p.quantity * price; const b = maintenanceBracket(brackets[p.signal.symbol], n);
  return n * b.rate - b.cumulative;
}
/** The trigger is on last price; execution incurs exit slippage. Includes already paid entry fees and funding. */
export function cstfTarget(p: Pick<CstfPosition, 'quantity' | 'entry' | 'entryFee' | 'funding' | 'signal' | 'margin'>) {
  const { feeRate: fee, slippageRate: slip } = CSTF_RULES; const need = cstfNetTarget(p) + p.entryFee + p.funding;
  return p.signal.side === 'LONG' ? (need + p.quantity*p.entry)/(p.quantity*(1-fee))/(1-slip) : (p.quantity*p.entry-need)/(p.quantity*(1+fee))/(1+slip);
}
/** Same one-position cross-price projection as the backtest, other slots held at their mark prices. */
export function cstfLiquidationPrice(p: CstfPosition, state: AccountState, marks: Record<CstfSymbol, number>, brackets: Brackets) {
  const others = state.positions.filter(x => x !== p);
  const u = others.reduce((v,x) => v+cstfUnrealized(x,marks[x.signal.symbol]),0);
  const m = others.reduce((v,x) => v+cstfMaintenance(x,marks[x.signal.symbol],brackets),0);
  const b = maintenanceBracket(brackets[p.signal.symbol], p.quantity*p.entry); const d = direction(p);
  return Math.max((state.wallet-m+u+b.cumulative-d*p.quantity*p.entry)/(p.quantity*b.rate-d*p.quantity),0);
}
function validateFrame(frame: MinuteFrame, brackets: Brackets) {
  if (!Number.isInteger(frame.time) || frame.time < 0 || frame.time % MINUTE !== 0) throw new Error('Invalid minute frame');
  for (const s of CSTF_SYMBOLS) {
    for (const candle of [frame.last[s],frame.mark[s]]) {
      if (!candle || candle.time !== frame.time) throw new Error(`Incomplete account-wide frame: ${s}`);
      validateCandle(candle);
    }
    const tiers = brackets[s];
    if (!tiers?.length || tiers.some((b,i) => ![b.floor,b.cap,b.rate,b.cumulative,b.maxLeverage].every(Number.isFinite) || b.floor<0 || b.cap<=b.floor || b.rate<0 || b.rate>=1 || b.cumulative<0 || (i===0 ? b.floor!==0 : tiers[i-1]?.cap!==b.floor))) throw new Error(`Invalid maintenance tiers: ${s}`);
    if ((frame.funding[s]??[]).some(x => !Number.isFinite(x))) throw new Error('Invalid funding data');
  }
  if (new Set(frame.signals.map(s=>s.id)).size !== frame.signals.length) throw new Error('Duplicate signal in batch');
  for (const s of frame.signals) {
    if (!(CSTF_SYMBOLS as readonly string[]).includes(s.symbol) || !['LONG','SHORT'].includes(s.side) || s.confirmTime !== frame.time || s.signalTime+30*MINUTE !== frame.time || s.signalTime%(30*MINUTE)!==0 || s.id!==`CSTF30-${s.symbol}-${s.side}-${s.signalTime}`) throw new Error('Invalid or late CSTF signal');
  }
}

/** Atomic candidate transition: clones input and advances ALL 22 feeds in one chronological minute.
 * Order matches bt71.py: funding -> alphabetically ordered entries -> worst mark liquidation -> last-price TP.
 * Caller must persist returned state, entries, results and outbox together with a revision/lease check.
 */
export function processCstfAccount(input: AccountState, frame: MinuteFrame, brackets: Brackets, sizing: CstfSizing = 'current-wallet'): AccountResult {
  validateFrame(frame,brackets);
  const state = structuredClone(input); const closed: CstfClose[]=[]; const opened: CstfPosition[]=[]; const skipped: AccountResult['skipped']=[];
  const marks = Object.fromEntries(CSTF_SYMBOLS.map(s=>[s,frame.mark[s].open])) as Record<CstfSymbol,number>;
  const totals = (price: Record<CstfSymbol,number>) => ({ equity: state.wallet+state.positions.reduce((v,p)=>v+cstfUnrealized(p,price[p.signal.symbol]),0), maintenance: state.positions.reduce((v,p)=>v+cstfMaintenance(p,price[p.signal.symbol],brackets),0) });
  if (state.lastMinute !== null && frame.time<=state.lastMinute) return { state,closed,opened,skipped,...totals(marks),duplicate:true };
  if (state.lastMinute !== null && frame.time!==state.lastMinute+MINUTE) throw new Error('Recover missing account-wide minutes before continuing');
  for (const p of state.positions) for (const rate of frame.funding[p.signal.symbol]??[]) {
    const cost=direction(p)*p.quantity*marks[p.signal.symbol]*rate; p.funding+=cost; state.wallet-=cost; state.funding+=cost;
  }
  for (const signal of [...frame.signals].sort((a,b)=>a.symbol.localeCompare(b.symbol))) {
    let reason: string | null = frame.mode==='recovery' ? 'NOT_LIVE' : state.positions.length>=CSTF_RULES.slots ? 'ALL_SLOTS_IN_USE' : null;
    const d=signal.side==='LONG'?1:-1; const entry=frame.last[signal.symbol].open*(1+CSTF_RULES.slippageRate*d); const sized=cstfMarginFor(cstfMainBalance(state),sizing); if (!(sized>0)) { skipped.push({signal,reason:reason??'INSUFFICIENT_AVAILABLE_MARGIN'}); continue; } const quantity=sized*CSTF_RULES.leverage/entry;
    const entryFee=CSTF_RULES.feeRate*quantity*entry; const margin=quantity*entry/CSTF_RULES.leverage;
    if (maintenanceBracket(brackets[signal.symbol],quantity*entry).maxLeverage<CSTF_RULES.leverage) reason??='LEVERAGE_UNAVAILABLE';
    if (totals(marks).equity-state.positions.reduce((v,p)=>v+p.margin,0)<margin+entryFee) reason??='INSUFFICIENT_AVAILABLE_MARGIN';
    if (reason) { skipped.push({signal,reason}); continue; }
    state.wallet-=entryFee; state.fees+=entryFee;
    const p: CstfPosition={signal,entryTime:frame.time,entry,quantity,margin,entryFee,funding:0,target:0,liquidationPrice:0};
    state.positions.push(p); p.target=cstfTarget(p); p.liquidationPrice=cstfLiquidationPrice(p,state,marks,brackets); opened.push(structuredClone(p));
  }
  const worstPrice = (p:CstfPosition) => p.signal.side==='LONG'?frame.mark[p.signal.symbol].low:frame.mark[p.signal.symbol].high;
  const worstEquity=state.wallet+state.positions.reduce((v,p)=>v+cstfUnrealized(p,worstPrice(p)),0);
  const worstMaintenance=state.positions.reduce((v,p)=>v+cstfMaintenance(p,worstPrice(p),brackets),0);
  if (state.positions.length && worstEquity<=worstMaintenance) {
    let grossTotal=0;
    for (const p of state.positions) {
      const price=worstPrice(p); const gross=cstfUnrealized(p,price); grossTotal+=gross;
      closed.push({position:structuredClone(p),reason:'LIQUIDATED',time:frame.time+MINUTE,price,gross,exitFee:0,net:gross-p.entryFee-p.funding,walletAfter:0,notify:frame.mode==='live'});
    }
    // Backtest liquidation clears all shared collateral; keep explicit clearance audit rather than hide residual loss.
    state.liquidationClearance+=-state.wallet-grossTotal; state.wallet=0; state.positions=[];
  }
  for (const p of [...state.positions]) {
    p.target=cstfTarget(p); const last=frame.last[p.signal.symbol]; const d=direction(p);
    if ((d===1 && last.high>=p.target)||(d===-1 && last.low<=p.target)) {
      const price=p.target*(1-d*CSTF_RULES.slippageRate); const gross=cstfUnrealized(p,price); const exitFee=CSTF_RULES.feeRate*p.quantity*price;
      state.wallet+=gross-exitFee; state.fees+=exitFee; state.positions=state.positions.filter(x=>x!==p);
      closed.push({position:structuredClone(p),reason:'TAKE_PROFIT',time:frame.time+MINUTE,price,gross,exitFee,net:gross-p.entryFee-exitFee-p.funding,walletAfter:state.wallet,notify:frame.mode==='live'});
    }
  }
  const closeMarks=Object.fromEntries(CSTF_SYMBOLS.map(s=>[s,frame.mark[s].close])) as Record<CstfSymbol,number>;
  for (const p of state.positions) p.liquidationPrice=cstfLiquidationPrice(p,state,closeMarks,brackets);
  state.lastMinute=frame.time;
  return {state,closed,opened,skipped,...totals(closeMarks),duplicate:false};
}