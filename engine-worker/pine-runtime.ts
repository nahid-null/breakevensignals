import { Indicator, type Context, type PineTS } from 'pinets';

type SeriesReader = { get(index: number): unknown };
function reader(source: unknown): SeriesReader {
  if (source !== null && typeof source === 'object' && 'get' in source && typeof source.get === 'function') {
    return { get: (index) => source.get(index) };
  }
  if (Array.isArray(source)) return { get: (index) => source[source.length - 1 - index] };
  return { get: (index) => index === 0 ? source : Number.NaN };
}

/** Test-only adapter. It never imports the production engine or rewrites original Pine conditions. */
export function installPineRuntimeCorrections(context: Context) {
  const averages = new Map<string, { index: number; committed: number | null; pending: number | null }>();
  // Pine calculations are doubles; formatting/rounding is not an assignment-time trading rule.
  context.precision = (value: number) => value;
  context.pine.ta.ema = (source: unknown, lengthValue: unknown, callId?: string) => {
    const length = Number(reader(lengthValue).get(0));
    if (!Number.isInteger(length) || length < 1) throw new Error('Invalid reference EMA length');
    if (!callId) throw new Error('Reference EMA requires independent transpiler call identity');
    const value = Number(reader(source).get(0));
    const state = averages.get(callId) ?? { index: -1, committed: null, pending: null };
    if (context.idx > state.index) {
      state.committed = state.pending;
      state.index = context.idx;
    }
    const alpha = 2 / (length + 1);
    state.pending = !Number.isFinite(value) ? state.committed : state.committed === null
      ? value : alpha * value + (1 - alpha) * state.committed;
    averages.set(callId, state);
    return state.pending ?? Number.NaN;
  };
}

export async function runCorrectedPine(runtime: PineTS, source: string) {
  const indicator = new Indicator(source);
  const prepared = indicator.prepare();
  let installed = false;
  const interpreted = (context: Context) => {
    if (!installed) { installPineRuntimeCorrections(context); installed = true; }
    return prepared.fn(context);
  };
  // runPretranspiled doesn't copy version from the source; retain the parsed version on the wrapper.
  Object.defineProperty(interpreted, '_pineVersion', { value: 6 });
  return runtime.runPretranspiled(interpreted, prepared.inputs);
}