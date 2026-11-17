import Decimal from 'decimal.js';
import type { Candle, Signal } from './model';
import type { MtfSnapshot } from './mtf-trend';

Decimal.set({ precision: 50, rounding: Decimal.ROUND_HALF_UP });
export interface ReplayEvent { time: number; signal: Signal }
export interface ReplayFeed { symbol: string; tick: number; candles: Candle[]; events: ReplayEvent[] }
export interface ReplayConfig {
  id: string; leverage: number; marginShare: number; targetNetShare: number;
  stopDistancePct?: number; netRiskReward?: number; slippageTicks?: number;
}
export const CURRENT_REPLAY: ReplayConfig = { id: 'current-50x-80-pine-net10', leverage: 50, marginShare: 0.8, targetNetShare: 0.10 };
export interface ReplayPosition {
  tradeId: string; symbol: string; direction: 'LONG' | 'SHORT'; opened: number;
  entry: string; stop: string; target: string; liquidation: string; margin: string;
  quantity: string; entryFee: string; slippage: string; balanceBefore: string;
  trend: MtfSnapshot | null;
}
export interface ReplayTrade extends ReplayPosition {
  closed: number; exit: string; reason: string; pricePnl: string; slippageCost: string;
  lossCapAdjustment: string; grossPnl: string; exitFee: string; pnl: string; balanceAfter: string;
}
export interface ReplayDecision { time: number; symbol: string; tradeId: string; direction: string; status: string; reason: string | null }
const dec = (n: Decimal.Value) => new Decimal(n);
const sign = (dir: string) => dir === 'LONG' ? 1 : -1;

export function trendSkip(t: MtfSnapshot | null | undefined, dir: string): string | null {
  if (!t || t.m15 == null || t.m5 == null || t.m1 == null) return 'TREND_UNKNOWN';
  if (t.m15 === 0 || t.m15 !== t.m5) return 'NO_15M_5M_BIAS';
  const s = sign(dir);
  if (t.m15 !== s) return 'BIAS_OPPOSITE_SIGNAL';
  if (t.m1 === -s) return 'ONE_MINUTE_OPPOSITE';
  return null;
}

export function createReplayPosition(e: ReplayEvent, tick: number, balance: string, cfg: ReplayConfig): ReplayPosition | null {
  const b = e.signal; const s = sign(b.direction);
  const entry = dec(b.entry_price).plus(dec(b.take_profit).minus(b.entry_price).abs().div(1.5).mul(s));
  const margin = dec(balance).mul(cfg.marginShare).toDecimalPlaces(8);
  // PostgreSQL divides by quantity when computing the target. This is a report diagnostic,
  // not a new trading guard: null means the configured SQL would fail this candle transaction.
  if (margin.lte(0)) return null;
  const q = margin.mul(cfg.leverage).div(entry); const fee = margin.mul(cfg.leverage).mul('0.0005');
  const slip = dec(tick).mul(cfg.slippageTicks ?? 1);
  const stop = cfg.stopDistancePct === undefined ? dec(b.stop_loss) : entry.mul(dec(1).minus(dec(cfg.stopDistancePct).div(100).mul(s)));
  const stopGross = Decimal.max(q.mul(stop.minus(entry)).mul(s).minus(q.mul(slip).mul(2)), margin.neg());
  const stopLoss = Decimal.max(stopGross.minus(fee).minus(q.mul(stop).mul('0.0005')).neg(), 0);
  const netTarget = cfg.netRiskReward === undefined ? margin.mul(cfg.targetNetShare) : stopLoss.mul(cfg.netRiskReward);
  const target = entry.mul(s).plus(netTarget.plus(fee).div(q)).plus(slip.mul(2)).div(dec(s).minus('0.0005'));
  return { tradeId: b.trade_id, symbol: b.symbol, direction: b.direction, opened: e.time + 60000,
    entry: entry.toString(), stop: stop.toString(), target: target.toString(),
    liquidation: entry.mul(dec(1).minus(dec(1).div(cfg.leverage).minus('0.005').mul(s))).toString(),
    margin: margin.toString(), quantity: q.toString(), entryFee: fee.toString(), slippage: slip.toString(),
    balanceBefore: balance, trend: b.mtf_trend ?? null };
}

export function closeReplayPosition(t: ReplayPosition, px: string, reason: string, time: number, balance: string): ReplayTrade {
  const q = dec(t.quantity); const pricePnl = q.mul(dec(px).minus(t.entry)).mul(sign(t.direction));
  const slippageCost = reason === 'LIQUIDATED' ? dec(0) : q.mul(t.slippage).mul(2);
  const beforeCap = pricePnl.minus(slippageCost);
  const gross = reason === 'LIQUIDATED' ? dec(t.margin).neg() : Decimal.max(beforeCap, dec(t.margin).neg());
  const ef = reason === 'LIQUIDATED' ? dec(0) : q.mul(px).mul('0.0005');
  const after = Decimal.max(dec(balance).plus(gross).minus(t.entryFee).minus(ef), 0);
  return { ...t, closed: time + 60000, exit: px, reason, pricePnl: pricePnl.toString(), slippageCost: slippageCost.toString(),
    lossCapAdjustment: gross.minus(beforeCap).toString(), grossPnl: gross.toString(), exitFee: ef.toString(),
    pnl: after.minus(balance).toString(), balanceAfter: after.toString() };
}

/** Read-only replay. Each minute commits in the configured symbol order, as separate worker feeds.
 * Hosted WebSocket arrival order is unavailable historically; this is one deterministic assumption.
 * A division-by-zero equivalent aborts the replay instead of inventing zero-margin trades.
 */
export function replaySimulator(feeds: ReplayFeed[], from: number, to: number, cfg: ReplayConfig) {
  let balance = '5'; let peak = dec(5); let maxDd = dec(0); let open: ReplayPosition | null = null;
  let failure: { time: number; symbol: string; tradeId: string; balance: string; reason: string } | null = null;
  const trades: ReplayTrade[] = []; const decisions: ReplayDecision[] = [];
  const maps = feeds.map(f => {
    const byTime = new Map<number, ReplayEvent[]>();
    for (const e of f.events) {
      const group = byTime.get(e.time) ?? []; group.push(e); byTime.set(e.time, group);
    }
    return { ...f, bars: new Map(f.candles.map(c => [c.time, c])), byTime };
  });
  const seen = new Set<string>();
  for (let time = from; time < to; time += 60000) {
    for (const feed of maps) {
      const c = feed.bars.get(time); if (!c) throw new Error(`Missing ${feed.symbol} candle ${time}`);
      if (open && open.symbol === feed.symbol && time + 60000 > open.opened && !failure) {
        const s = sign(open.direction); const stop = Number(open.stop); const liq = Number(open.liquidation); const tp = Number(open.target);
        const stopHit = s === 1 ? c.low <= stop : c.high >= stop;
        const liqHit = s === 1 ? c.low <= liq : c.high >= liq;
        const tpHit = s === 1 ? c.high >= tp : c.low <= tp;
        let px: string | null = null; let reason = '';
        if (liqHit && (!stopHit || (s === 1 ? stop < liq : stop > liq))) { px = open.liquidation; reason = 'LIQUIDATED'; }
        else if (stopHit) { px = open.stop; reason = 'STOP_LOSS'; }
        else if (tpHit) { px = open.target; reason = 'TAKE_PROFIT'; }
        if (px !== null) {
          const t = closeReplayPosition(open, px, reason, time, balance); trades.push(t); balance = t.balanceAfter; open = null;
          peak = Decimal.max(peak, balance); maxDd = Decimal.max(maxDd, peak.minus(balance).div(peak).mul(100));
        }
      }
      for (const e of feed.byTime.get(time) ?? []) {
        const b = e.signal; const d: ReplayDecision = { time: time + 60000, symbol: b.symbol, tradeId: b.trade_id, direction: b.direction, status: 'SKIPPED', reason: null };
        if (failure) { d.status = 'NOT_PROCESSED'; d.reason = 'AFTER_ARITHMETIC_FAILURE'; decisions.push(d); continue; }
        if (seen.has(b.trade_id)) { d.reason = 'DUPLICATE_EVENT'; decisions.push(d); continue; }
        seen.add(b.trade_id);
        d.reason = trendSkip(b.mtf_trend, b.direction) ?? (dec(balance).lte(0) ? 'NO_BALANCE' : open ? 'TRADE_ALREADY_OPEN' : null);
        if (d.reason === null) {
          const position = createReplayPosition(e, feed.tick, balance, cfg);
          if (!position) {
            d.status = 'ERROR'; d.reason = 'ROUNDED_MARGIN_ZERO_DIVISION';
            failure = { time: time + 60000, symbol: b.symbol, tradeId: b.trade_id, balance, reason: d.reason };
          } else { open = position; d.status = 'EXECUTED'; }
        }
        decisions.push(d);
      }
    }
  }
  const wins = trades.filter(t => dec(t.pnl).gt(0)).length;
  const losses = trades.filter(t => dec(t.pnl).lt(0)).length;
  const flat = trades.length - wins - losses;
  const sum = (key: keyof ReplayTrade) => trades.reduce((v,t) => v.plus(String(t[key])), dec(0));
  const skipped: Record<string, number> = {};
  for (const d of decisions) if (d.status === 'SKIPPED') skipped[d.reason ?? 'UNKNOWN'] = (skipped[d.reason ?? 'UNKNOWN'] ?? 0) + 1;
  return { config: cfg, window: { from, to }, signals: decisions.length, executed: trades.length + (open ? 1 : 0),
    closed: trades.length, open, skipped, skippedTotal: Object.values(skipped).reduce((a,b) => a+b,0),
    errors: decisions.filter(d => d.status === 'ERROR').length, notProcessed: decisions.filter(d => d.status === 'NOT_PROCESSED').length,
    failure, fullPeriod: failure === null, wins, losses, flat, winRate: trades.length ? wins / trades.length * 100 : null,
    netPnl: dec(balance).minus(5).toString(), endingBalance: balance, maxDrawdownPct: maxDd.toString(),
    grossPnl: sum('grossPnl').toString(), fees: sum('entryFee').plus(sum('exitFee')).toString(), slippage: sum('slippageCost').toString(),
    positiveNetPnl: trades.filter(t => dec(t.pnl).gt(0)).reduce((v,t) => v.plus(t.pnl),dec(0)).toString(),
    negativeNetPnl: trades.filter(t => dec(t.pnl).lt(0)).reduce((v,t) => v.plus(t.pnl),dec(0)).toString(),
    liquidations: trades.filter(t => t.reason === 'LIQUIDATED').length, trades, decisions,
    drawdownBasis: 'closed-trade balance; not intrabar marked-to-market equity',
  };
}

export function comparisonConfigs(): ReplayConfig[] {
  const out: ReplayConfig[] = [];
  for (const leverage of [50,20]) for (const marginShare of [0.8,0.2,0.1]) {
    const key = `${leverage}x-${marginShare*100}`;
    out.push({ id: `${key}-pine-net10`, leverage, marginShare, targetNetShare: .10 });
    for (const targetNetShare of [.05,.20,.30]) out.push({ id: `${key}-pine-net${targetNetShare*100}`, leverage, marginShare, targetNetShare });
    for (const stopDistancePct of [.25,.5,1]) out.push({ id: `${key}-stop${stopDistancePct}-net10`, leverage, marginShare, targetNetShare: .10, stopDistancePct });
    for (const netRiskReward of [1,1.5,2]) out.push({ id: `${key}-pine-netRR${netRiskReward}`, leverage, marginShare, targetNetShare: .10, netRiskReward });
  }
  return out;
}