import type { z } from 'zod';
import type { robotOpenSchema, robotUpdateSchema } from './protocol';

type Open = z.infer<typeof robotOpenSchema>;
type Update = z.infer<typeof robotUpdateSchema>;
const SETUP: Record<string, string> = { SWEEP_RECLAIM: 'Liquidity sweep + reclaim', PULLBACK_RECLAIM: 'Trend pullback reclaim' };
const REASON: Record<string, string> = {
  TAKE_PROFIT: 'TAKE PROFIT', STOP_LOSS: 'STOP LOSS', BREAKEVEN_STOP: 'BREAKEVEN STOP', EARLY_EXIT: 'EARLY EXIT (setup failed)',
  PROFIT_EXIT: 'PROFIT PROTECTION EXIT', TIME_EXIT: 'TIME EXIT', LIQUIDATION: 'LIQUIDATION', EMERGENCY_STOP: 'EMERGENCY STOP',
};
/** Up to 8 significant digits, never scientific notation. */
export const fmtPrice = (n: number) => Number(n.toPrecision(8)).toString();
export const fmtUsd = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)} USDT`;
const utc = (iso: string | number) => new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
const FOOTER = 'Simulated trade — no real order was placed.';

export function robotOpenMessage(o: Open) {
  const icon = o.direction === 'LONG' ? '🟢' : '🔴';
  return [`🤖 PAPER ROBOT — ${icon} ${o.direction} OPENED`, `${o.symbol} · ${SETUP[o.setup] ?? o.setup}`, `Score: ${o.score}/100`,
    `Entry: ${fmtPrice(o.entry_price)}`, `Stop loss: ${fmtPrice(o.stop_loss)}`, `TP1: ${fmtPrice(o.tp1)} (half)`, `TP2: ${fmtPrice(o.tp2)}`,
    `Leverage: ${o.leverage}x (${o.band})`, `Margin: ${o.margin.toFixed(2)} USDT · Size: ${o.notional.toFixed(2)} USDT`,
    `Max planned loss: ${o.risk_usdt.toFixed(2)} USDT`, `Liquidation: ${fmtPrice(o.liquidation_price)}`, `Liquidity: ${o.liquidity}`,
    `Time: ${utc(o.opened_at)}`, FOOTER].join('\n');
}

export function robotFillMessages(u: Update): { event_id: string; symbol: string; direction: string; message: string }[] {
  return u.fills.map((f) => {
    if (f.kind === 'PARTIAL') return { event_id: `${u.id}-tp1`, symbol: u.symbol, direction: u.direction, message: [
      `🤖 PAPER ROBOT — 🎯 TP1 HIT (half closed)`, `${u.symbol} ${u.direction}`, `Price: ${fmtPrice(f.price)}`, `Part PnL: ${fmtUsd(f.pnl)} (fees included)`,
      `Stop moved to breakeven: ${fmtPrice(u.stop_loss)}`, `Time: ${utc(f.time)}`, FOOTER].join('\n') };
    const won = u.realized_pnl > 0;
    return { event_id: `${u.id}-close`, symbol: u.symbol, direction: u.direction, message: [
      `🤖 PAPER ROBOT — ${won ? '✅' : '❌'} TRADE CLOSED (${REASON[f.reason] ?? f.reason})`, `${u.symbol} ${u.direction} · ${u.leverage}x`,
      `Entry: ${fmtPrice(u.entry_price)}`, `Exit: ${fmtPrice(f.price)}`, `Net PnL: ${fmtUsd(u.realized_pnl)} (fees ${u.fees.toFixed(2)} included)`,
      `Held: ${Math.max(1, Math.round((f.time - Date.parse(u.opened_at)) / 60_000))} min`, `Time: ${utc(f.time)}`, FOOTER].join('\n') };
  });
}
