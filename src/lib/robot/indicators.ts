/** Incremental indicators. Each update consumes one closed bar; no future data is read. */
export class Ema {
  value: number | null = null; private seed: number[] = [];
  constructor(readonly length: number) {}
  update(x: number) {
    if (this.value === null) {
      this.seed.push(x);
      if (this.seed.length === this.length) { this.value = this.seed.reduce((a, b) => a + b, 0) / this.length; this.seed = []; }
    } else this.value += (2 / (this.length + 1)) * (x - this.value);
    return this.value;
  }
}
/** Wilder smoothing (RMA). */
export class Rma {
  value: number | null = null; private seed: number[] = [];
  constructor(readonly length: number) {}
  update(x: number) {
    if (this.value === null) {
      this.seed.push(x);
      if (this.seed.length === this.length) { this.value = this.seed.reduce((a, b) => a + b, 0) / this.length; this.seed = []; }
    } else this.value = (this.value * (this.length - 1) + x) / this.length;
    return this.value;
  }
}
export class Rsi {
  private gain = new Rma(14); private loss = new Rma(14); private prev: number | null = null; value: number | null = null;
  update(close: number) {
    if (this.prev !== null) {
      const d = close - this.prev;
      const g = this.gain.update(Math.max(d, 0)); const l = this.loss.update(Math.max(-d, 0));
      if (g !== null && l !== null) this.value = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
    this.prev = close; return this.value;
  }
}
export class Atr {
  private rma = new Rma(14); private prevClose: number | null = null; value: number | null = null;
  update(high: number, low: number, close: number) {
    const tr = this.prevClose === null ? high - low : Math.max(high - low, Math.abs(high - this.prevClose), Math.abs(low - this.prevClose));
    this.prevClose = close; this.value = this.rma.update(tr); return this.value;
  }
}
export class Macd {
  private fast = new Ema(12); private slow = new Ema(26); private signal = new Ema(9); hist: number | null = null;
  update(close: number) {
    const f = this.fast.update(close); const s = this.slow.update(close);
    if (f === null || s === null) return null;
    const line = f - s; const sig = this.signal.update(line);
    this.hist = sig === null ? null : line - sig; return this.hist;
  }
}
export class Sma {
  private values: number[] = []; private sum = 0; value: number | null = null;
  constructor(readonly length: number) {}
  update(x: number) {
    this.values.push(x); this.sum += x;
    if (this.values.length > this.length) this.sum -= this.values.shift() ?? 0;
    this.value = this.values.length === this.length ? this.sum / this.length : null; return this.value;
  }
}
/** Session VWAP that resets at 00:00 UTC. */
export class Vwap {
  private day = -1; private pv = 0; private vol = 0; value: number | null = null;
  update(time: number, high: number, low: number, close: number, volume: number) {
    const day = Math.floor(time / 86_400_000);
    if (day !== this.day) { this.day = day; this.pv = 0; this.vol = 0; }
    this.pv += ((high + low + close) / 3) * volume; this.vol += volume;
    this.value = this.vol > 0 ? this.pv / this.vol : close; return this.value;
  }
}
