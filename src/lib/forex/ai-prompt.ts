import type { Bar } from './cpes';

export type AiAction = 'LONG' | 'SHORT' | 'SKIP';

export type AiTradeDecision = {
  action: AiAction;
  confidence: number;
  reason: string;
};

export const AI_TRADER_INSTRUCTIONS = [
  'You are an autonomous AUD/JPY 1-minute binary options trader.',
  'You do NOT use any technical indicators. Base every decision strictly on raw OHLC candlestick price action, candle bodies, wicks, micro-swings, and short-term momentum.',
  'Trade rules: fixed $1 stake, 1-minute expiry. WIN pays +$0.77 net (after 23% profit fee); LOSS costs -$1.00; DRAW refunds $1.00. Break-even win rate is ~56.5%.',
  'Only choose LONG (expiry > entry) or SHORT (expiry < entry) when raw price action shows a clear 1-minute directional edge. Otherwise choose SKIP.',
  'Return JSON matching the schema: action ("LONG" | "SHORT" | "SKIP"), confidence (integer 0 to 100), and reason (one concise sentence under 140 characters referencing only the visible candles).',
].join('\n');

/** Strictly causal slice: only bars completely closed at or before entryTimeSec. Zero lookahead. */
export function sliceCausalBars(
  m3Bars: Bar[],
  m1Bars: Bar[],
  entryTimeSec: number,
  m3Limit = 20,
  m1Limit = 10,
): { m3: Bar[]; m1: Bar[] } {
  const m3 = m3Bars.filter((b) => b.t + 180 <= entryTimeSec).slice(-m3Limit);
  const m1 = m1Bars.filter((b) => b.t + 60 <= entryTimeSec).slice(-m1Limit);
  return { m3, m1 };
}

function fmtBars(bars: Bar[]): string {
  return bars
    .map((b) => {
      const hm = new Date(b.t * 1000).toISOString().slice(11, 16);
      return `${hm} ${b.o.toFixed(3)} ${b.h.toFixed(3)} ${b.l.toFixed(3)} ${b.c.toFixed(3)}`;
    })
    .join('\n');
}

export function buildAiTradePrompt(m3: Bar[], m1: Bar[], entryTimeSec: number): string {
  const entryIso = new Date(entryTimeSec * 1000).toISOString().replace('.000Z', 'Z');
  const lastPrice = (m1.at(-1)?.c ?? m3.at(-1)?.c ?? 0).toFixed(3);
  return [
    `Pair: AUD/JPY | Decision time (UTC): ${entryIso} | Current close: ${lastPrice}`,
    'Recent closed M3 candles (UTC_open O H L C):',
    fmtBars(m3),
    m1.length > 0 ? `Recent closed M1 candles (UTC_open O H L C):\n${fmtBars(m1)}` : '',
    'Predict whether AUD/JPY will close higher (LONG) or lower (SHORT) in exactly 1 minute, or SKIP if no clear edge.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function normalizeDecision(raw: { action: string; confidence: number; reason: string }): AiTradeDecision {
  const action: AiAction = raw.action === 'LONG' || raw.action === 'SHORT' ? raw.action : 'SKIP';
  const confidence = Math.max(0, Math.min(100, Math.round(Number.isFinite(raw.confidence) ? raw.confidence : 0)));
  const reason = (raw.reason || 'No clear price-action edge.').replace(/\s+/g, ' ').trim().slice(0, 180);
  return { action, confidence, reason };
}