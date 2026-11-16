/** Performance metrics on closed trades. Net PnL always includes fees and slippage. */
export type ClosedTrade = { direction: string; netPnl: number; exitReason: string; closedAt: number; riskUsdt: number };
export type Metrics = { trades: number; wins: number; losses: number; winRate: number; netPnl: number; grossProfit: number;
  grossLoss: number; profitFactor: number | null; avgWin: number; avgLoss: number; expectancy: number; expectancyR: number;
  maxDrawdown: number; maxDrawdownPct: number; stopLosses: number; stopLossRate: number; liquidations: number; byReason: Record<string, number> };

export function computeMetrics(trades: ClosedTrade[], startBalance: number): Metrics {
  const sorted = [...trades].sort((a, b) => a.closedAt - b.closedAt);
  let equity = startBalance; let peak = startBalance; let maxDd = 0; let maxDdPct = 0;
  const byReason: Record<string, number> = {};
  let gp = 0; let gl = 0; let wins = 0; let losses = 0; let r = 0;
  for (const t of sorted) {
    equity += t.netPnl; peak = Math.max(peak, equity);
    const dd = peak - equity; maxDd = Math.max(maxDd, dd); if (peak > 0) maxDdPct = Math.max(maxDdPct, (dd / peak) * 100);
    byReason[t.exitReason] = (byReason[t.exitReason] ?? 0) + 1;
    if (t.netPnl > 0) { wins++; gp += t.netPnl; } else { losses++; gl += -t.netPnl; }
    if (t.riskUsdt > 0) r += t.netPnl / t.riskUsdt;
  }
  const n = sorted.length;
  const stopLosses = (byReason['STOP_LOSS'] ?? 0) + (byReason['LIQUIDATION'] ?? 0);
  return { trades: n, wins, losses, winRate: n ? (wins / n) * 100 : 0, netPnl: gp - gl, grossProfit: gp, grossLoss: gl,
    profitFactor: gl > 0 ? gp / gl : gp > 0 ? null : 0, avgWin: wins ? gp / wins : 0, avgLoss: losses ? gl / losses : 0,
    expectancy: n ? (gp - gl) / n : 0, expectancyR: n ? r / n : 0, maxDrawdown: maxDd, maxDrawdownPct: maxDdPct,
    stopLosses, stopLossRate: n ? (stopLosses / n) * 100 : 0, liquidations: byReason['LIQUIDATION'] ?? 0, byReason };
}
