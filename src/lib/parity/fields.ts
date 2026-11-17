/**
 * Fields compared candle by candle. Each maps a native engine value to the exact expression in the intact
 * original Pine source; the same expressions are appended as observation plots for PineTS and TradingView.
 */
import type { Direction } from '@/lib/config';
import type { ParityRow, ParityValue } from '@/lib/engine/parity';
import type { PineRun } from '@/lib/chart/pine-series';

export type FieldDef = { field: string; label: string; kind: 'value' | 'bool' | 'price'; expr: (d: Direction) => string };
const lower = (d: Direction) => d.toLowerCase();
export const PARITY_FIELDS: FieldDef[] = [
  { field: 'ema9', label: 'EMA 9', kind: 'value', expr: () => 'ema9' },
  { field: 'ema21', label: 'EMA 21', kind: 'value', expr: () => 'ema21' },
  { field: 'ema200', label: 'EMA 200', kind: 'value', expr: () => 'ema200' },
  { field: 'rsi', label: 'RSI 14', kind: 'value', expr: () => 'rsi' },
  { field: 'macd', label: 'MACD line', kind: 'value', expr: () => 'macdLine' },
  { field: 'macdSignal', label: 'MACD signal', kind: 'value', expr: () => 'macdSignalLine' },
  { field: 'histogram', label: 'MACD histogram', kind: 'value', expr: () => 'macdHistogram' },
  { field: 'atr', label: 'ATR 14', kind: 'value', expr: () => 'atr' },
  { field: 'volumeSMA', label: 'Volume SMA', kind: 'value', expr: () => 'volumeSMA' },
  { field: 'score', label: 'Confirmation score', kind: 'value', expr: () => 'confirmationScore' },
  { field: 'setup', label: 'Entry conditions (setup)', kind: 'bool', expr: (d) => `${lower(d)}Setup ? 1 : 0` },
  { field: 'entryEvent', label: 'Signal (entry)', kind: 'bool', expr: (d) => `${lower(d)}Signal ? 1 : 0` },
  { field: 'calculatedStop', label: 'Calculated stop loss', kind: 'price', expr: () => 'calculatedSL' },
  { field: 'activeEntry', label: 'Trade entry', kind: 'price', expr: () => 'activeTrade ? tradeEntry : na' },
  { field: 'activeStop', label: 'Trade stop loss', kind: 'price', expr: () => 'activeTrade ? tradeSL : na' },
  { field: 'activeTarget', label: 'Take profit', kind: 'price', expr: () => 'activeTrade ? tradeTP : na' },
  { field: 'beTrigger', label: 'Break-even trigger price', kind: 'price', expr: (d) => `activeTrade ? tradeEntry ${d === 'LONG' ? '+' : '-'} tradeRisk * breakevenTrigger : na` },
  { field: 'breakevenEvent', label: 'Break-even activation', kind: 'bool', expr: () => 'breakevenEvent ? 1 : 0' },
  { field: 'breakevenActive', label: 'Break-even active', kind: 'bool', expr: () => 'breakevenActive ? 1 : 0' },
  { field: 'stopEvent', label: 'Stop / break-even exit', kind: 'bool', expr: () => 'stopLossEvent ? 1 : 0' },
  { field: 'targetEvent', label: 'Take-profit exit', kind: 'bool', expr: () => 'takeProfitEvent ? 1 : 0' },
];
export const FIELD_LABEL = Object.fromEntries(PARITY_FIELDS.map((f) => [f.field, f.label]));
export const plotTitle = (field: string) => `VERIFY_${field}`;

export function nativeRows(run: PineRun, d: Direction): ParityRow[] {
  return run.bars.map((b) => {
    const s = d === 'LONG' ? b.long : b.short;
    const v: Record<string, ParityValue> = {
      ema9: b.ema9, ema21: b.ema21, ema200: b.ema200, rsi: b.rsi, macd: b.macd, macdSignal: b.macdSignal, histogram: b.histogram,
      atr: b.atr, volumeSMA: b.volumeSMA, score: s.score, setup: s.setup, entryEvent: s.entry, calculatedStop: s.calcStop,
      activeEntry: s.tradeEntry, activeStop: s.tradeStop, activeTarget: s.tradeTarget, beTrigger: s.beTrigger,
      breakevenEvent: s.breakeven, breakevenActive: s.beActive, stopEvent: s.stopHit, targetEvent: s.targetHit,
    };
    return { time: b.time, values: v };
  });
}

/**
 * The intact original source plus data-window-only observation plots. Trading logic is untouched;
 * add this as a separate indicator on TradingView, then use "Export chart data".
 */
export function verificationPine(source: string, d: Direction) {
  const plots = PARITY_FIELDS.map((f) => `plot(${f.expr(d)}, "${plotTitle(f.field)}", display=display.data_window)`).join('\n');
  return `${source.replace(/\s+$/, '')}\n\n// ===== PARITY OBSERVATION PLOTS (verification only; no logic changes) =====\n${plots}\n`;
}
