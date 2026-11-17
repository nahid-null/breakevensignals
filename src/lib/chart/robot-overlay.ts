/** Robot evidence for the chart, from stored rows only (positions, decisions). Nothing is re-simulated here. */
export type RobotDecisionRow = { candle_time: string; direction: string; phase: string; decision: string; reason: string; score: number | null; strategy: string; evidence: unknown };
export type RobotStage = 0 | 1 | 2 | 3 | 4;
export const STAGE_LABEL: Record<RobotStage, string> = { 0: 'No setup', 1: 'Liquidity sweep seen', 2: 'MSS confirmed', 3: 'Full setup checked', 4: 'Qualified' };

/** How far the SMC_V1 sequence had progressed, read from the robot's own stored rejection reason. */
export function robotStage(reason: string, decision: string): RobotStage {
  if (decision !== 'REJECTED') return 4;
  if (/Waiting for (bullish|bearish) MSS|No prior swing to confirm|Sweep too weak or too deep|Sweep candle no longer/.test(reason)) return 1;
  if (/Structure just shifted|No valid FVG|Waiting for retracement|No impulse leg|Retracement took out/.test(reason)) return 2;
  if (/outside OTE|rejection close|Closed through the zone|already left the entry zone|Against the 15m bias|Structural stop too wide|Opposing liquidity|Net reward too small|Score \d+ below/.test(reason)) return 3;
  return 0;
}

export type StageEvent = { time: number; direction: 'LONG' | 'SHORT'; stage: RobotStage; reason: string; score: number | null; evidence: unknown };
/** Decision time is the 1m close; the event belongs to the candle that opened one minute earlier. */
export const decisionBarTime = (d: RobotDecisionRow) => Date.parse(d.candle_time) - 60_000;

/** Stage transitions only (first bar the robot reached a further stage), so the chart is not flooded. */
export function stageEvents(rows: RobotDecisionRow[]): StageEvent[] {
  const out: StageEvent[] = [];
  for (const dir of ['LONG', 'SHORT'] as const) {
    let prev: RobotStage = 0;
    for (const d of rows.filter((r) => r.direction === dir).sort((a, b) => decisionBarTime(a) - decisionBarTime(b))) {
      const st = robotStage(d.reason, d.decision);
      if (st > prev) out.push({ time: decisionBarTime(d), direction: dir, stage: st, reason: d.reason, score: d.score, evidence: d.evidence });
      prev = st;
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

export type SmcEvidence = { zone_low?: number; zone_high?: number; zone_kind?: string; mss_level?: number; mss_at?: number; sweep_extreme?: number; sweep_at?: number;
  pool_price?: number; ote_depth?: number; signal_price?: number; signal_open_at?: number; fill_price?: number; fill_at?: number; explanation?: string; strategy?: string };
export const evidenceOf = (v: unknown): SmcEvidence | null => v && typeof v === 'object' ? v as SmcEvidence : null;
