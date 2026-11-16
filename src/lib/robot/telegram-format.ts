import type { z } from 'zod';
import type { robotOpenSchema, robotUpdateSchema } from './protocol';

type Open = z.infer<typeof robotOpenSchema>;
type Update = z.infer<typeof robotUpdateSchema>;
export const SETUP_LABEL: Record<string, string> = { SMC_SWEEP_MSS: 'Smart Money: sweep + structure shift + FVG/OB', SWEEP_RECLAIM: 'Liquidity sweep + reclaim', TREND_PULLBACK: 'Trend pullback continuation',
  EMA_RETEST: 'EMA retest + momentum', VWAP_RECLAIM: 'VWAP reclaim / rejection', SR_REJECTION: 'Support/resistance rejection',
  BREAKOUT_RETEST: 'Confirmed breakout retest', PULLBACK_RECLAIM: 'Trend pullback reclaim' };
const REASON: Record<string, string> = {
  TAKE_PROFIT: 'TAKE PROFIT — 10% NET ROI', STOP_LOSS: 'STOP LOSS', BREAKEVEN_STOP: 'PROFIT-LOCK STOP', EARLY_EXIT: 'EARLY EXIT (setup failed)',
  PROFIT_EXIT: 'EARLY PROFIT EXIT', TIME_EXIT: 'TIME EXIT', LIQUIDATION: 'LIQUIDATION', EMERGENCY_STOP: 'EMERGENCY STOP',
};
/** Up to 8 significant digits, never scientific notation. */
export const fmtPrice = (n: number) => Number(n.toPrecision(8)).toString();
export const fmtUsd = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)} USDT`;
const utc = (iso: string | number) => new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
const FOOTER = 'PAPER TRADING — simulated trade, no real order was placed.';

export function robotOpenMessage(o: Open) {
  const icon = o.direction === 'LONG' ? '🟢' : '🔴';
  return [`🤖 PAPER ROBOT — ${icon} ${o.direction} OPENED`, `${o.symbol} · ${SETUP_LABEL[o.setup] ?? o.setup}`, `Score: ${o.score}/100 (${o.band})`,
    `Entry: ${fmtPrice(o.entry_price)}`, `Take profit: ${fmtPrice(o.tp1)} (${o.target_roi_pct}% net ROI)`, `Stop loss: ${fmtPrice(o.stop_loss)}`,
    `Leverage: ${o.leverage}x · Margin: ${o.margin.toFixed(2)} USDT · Size: ${o.notional.toFixed(2)} USDT`,
    ...(o.fill_status === 'PARTIAL' ? [`Partial fill: ${fmtPrice(o.quantity)} of ${fmtPrice(o.requested_quantity)}`] : []),
    `Max planned loss: ${o.risk_usdt.toFixed(2)} USDT`, `Liquidation: ${fmtPrice(o.liquidation_price)}`, `Why: ${o.liquidity}`,
    `Time: ${utc(o.opened_at)}`, FOOTER].join('\n');
}

export function robotFillMessages(u: Update): { event_id: string; symbol: string; direction: string; message: string }[] {
  return u.fills.filter((f) => f.kind === 'CLOSE').map((f) => {
    const won = u.realized_pnl > 0;
    return { event_id: `${u.id}-close`, symbol: u.symbol, direction: u.direction, message: [
      `🤖 PAPER ROBOT — ${won ? '✅' : '❌'} TRADE CLOSED (${REASON[f.reason] ?? f.reason})`, `${u.symbol} ${u.direction} · ${u.leverage}x`,
      `Entry: ${fmtPrice(u.entry_price)}`, `Exit: ${fmtPrice(f.price)}`, `Net PnL: ${fmtUsd(u.realized_pnl)} · Net ROI: ${u.net_roi_pct.toFixed(1)}%`,
      `Fees: ${u.fees.toFixed(3)} USDT${u.funding !== 0 ? ` · Funding: ${fmtUsd(u.funding)}` : ''}`,
      `Held: ${Math.max(1, Math.round((f.time - Date.parse(u.opened_at)) / 60_000))} min`, `Time: ${utc(f.time)}`, FOOTER].join('\n') };
  });
}
