export interface TerminalStats { activeLong: number; activeShort: number; breakeven: number; completed: number; wins: number; losses: number; netR: number; entries: number; breakevenEvents: number; telegramSent: number }
export function winRate(stats: Pick<TerminalStats, 'wins' | 'losses'>): number | null {
  const total = stats.wins + stats.losses;
  return total ? stats.wins * 100 / total : null;
}