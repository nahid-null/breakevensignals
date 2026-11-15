export const SYMBOLS = [
  "NEARUSDT", "LINKUSDT", "SUIUSDT", "INJUSDT", "TAOUSDT", "UNIUSDT", "WILDUSDT",
  "ONDOUSDT", "BOMEUSDT", "BCHUSDT", "BERAUSDT", "ZROUSDT", "POLUSDT", "LTCUSDT",
  "XRPUSDT", "FILUSDT", "TIAUSDT", "WIFUSDT", "ENAUSDT", "RENDERUSDT", "HBARUSDT",
] as const;
export type Symbol = (typeof SYMBOLS)[number];
export type Direction = "LONG" | "SHORT";
export const INDICATORS: Record<Direction, string> = {
  LONG: "PRO LONG SCALPER",
  SHORT: "PRO SHORT SCALPER",
};
export const EVENT_TYPES = ["entry_confirmed", "breakeven_activated", "stop_loss_hit", "take_profit_hit"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** TradingView perpetual tickers look like "NEARUSDT.P"; normalize to the plain symbol. */
export function normalizeSymbol(raw: string): string {
  return raw.trim().toUpperCase().replace(/\.P$/, "").replace(/^BINANCE:/, "");
}
