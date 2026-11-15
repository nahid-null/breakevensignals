import { Indicator, type Context, type PineTS } from 'pinets';

type SeriesReader = { get(index: number): unknown };
function reader(source: unknown): SeriesReader {
  if (source !== null && typeof source === 'object' && 'get' in source && typeof source.get === 'function') {
    const get = source.get.bind(source);
    return { get: (index) => get(index) };
  }
  if (Array.isArray(source)) return { get: (index) => source[source.length - 1 - index] };
  return { get: (index) => index === 0 ? source : Number.NaN };
}

/** Test-only adapter. It never imports the production engine or rewrites original Pine conditions. */
export function installPineRuntimeCorrections(context: Context) {
  const averages = new Map<string, { index: number; committed: number | null; pending: number | null }>();
  // Pine calculations are doubles; formatting/rounding is not an assignment-time trading rule.
  context.precision = (value: number) => value;
  const ta = context.pine['ta'];
  ta.ema = (source: unknown, lengthValue: unknown, callId?: string) => {
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
  // The original scripts call fixed-length extrema unconditionally. Preserve source history offsets.
  const extremum = (kind: 'low' | 'high') => (source: unknown, lengthValue: unknown, callId?: string) => {
    if (typeof lengthValue === 'string' && callId === undefined) {
      lengthValue = source; source = context.data[kind];
    }
    const length = Number(reader(lengthValue).get(0));
    if (!Number.isInteger(length) || length < 1) throw new Error('Invalid reference extremum length');
    const series = reader(source);
    const values: number[] = [];
    for (let offset = 0; offset < length; offset++) {
      const value = series.get(offset);
      if (typeof value === 'number' && Number.isFinite(value)) values.push(value);
    }
    return values.length === 0 ? Number.NaN : kind === 'low' ? Math.min(...values) : Math.max(...values);
  };
  ta.lowest = extremum('low'); ta.highest = extremum('high');
  // Official Pine type-system specification: comparison operands rounded to nine fractional digits.
  const round = (value: number) => Math.abs(value) * 1e9 < Number.MAX_SAFE_INTEGER ? Math.round(value * 1e9) / 1e9 : value;
  const operators = {
    __lt: (a: number, b: number) => a < b, __gt: (a: number, b: number) => a > b,
    __le: (a: number, b: number) => a <= b, __ge: (a: number, b: number) => a >= b,
    __eq: (a: number, b: number) => a === b, __neq: (a: number, b: number) => a !== b,
  };
  for (const [name, compare] of Object.entries(operators)) {
    const original = context.pine['math'][name];
    context.pine['math'][name] = (left: unknown, right: unknown) => {
      const a = reader(left).get(0); const b = reader(right).get(0);
      if (typeof a !== 'number' || typeof b !== 'number') return original(left, right);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      return compare(round(a), round(b));
    };
  }
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
  Object.assign(interpreted, prepared.fn);
  Object.defineProperty(interpreted, '_pineVersion', { value: 6 });
  return runtime.runPretranspiled(interpreted, prepared.inputs);
}