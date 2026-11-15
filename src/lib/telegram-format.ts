export interface BreakevenInfo {
  symbol: string;
  direction: "LONG" | "SHORT";
  timeframe: string;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  fee_rate_percent: number | null;
  indicator: string;
  timestamp: string;
}

function tf(t: string) {
  return /^\d+$/.test(t) ? `${t}M` : t.toUpperCase();
}

export function formatBreakevenMessage(e: BreakevenInfo): string {
  const line = "━━━━━━━━━━━━━━━━";
  const ts = new Date(e.timestamp).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
  return [
    "🟠 BREAKEVEN ACTIVATED",
    line,
    `🪙 COIN: ${e.symbol}`,
    e.direction === "LONG" ? "📈 POSITION: LONG" : "📉 POSITION: SHORT",
    `⏱ TIMEFRAME: ${tf(e.timeframe)}`,
    line,
    `🎯 ENTRY PRICE: ${e.entry_price}`,
    `🛑 NEW STOP LOSS: ${e.stop_loss}`,
    `🎯 TAKE PROFIT: ${e.take_profit}`,
    `💰 ENTRY FEE RATE: ${e.fee_rate_percent ?? "N/A"}%`,
    "📌 STATUS: BREAKEVEN ACTIVATED",
    `⚡ SIGNAL SOURCE: ${e.indicator}`,
    line,
    `🕒 TIME: ${ts}`,
  ].join("\n");
}

export function formatSignalMessage(e: BreakevenInfo & { event: string; exit_price?: number; net_result_r?: number }): string {
  if (e.event === "breakeven_activated") return formatBreakevenMessage(e);
  const title = e.event === "entry_confirmed" ? `${e.direction} ENTRY CONFIRMED`
    : e.event === "stop_loss_hit" ? `${e.direction} STOP LOSS HIT` : `${e.direction} TAKE PROFIT HIT`;
  return [title, "━━━━━━━━━━━━━━━━", `COIN: ${e.symbol}`, `POSITION: ${e.direction}`,
    `TIMEFRAME: ${tf(e.timeframe)}`, `ENTRY PRICE: ${e.entry_price}`, `STOP LOSS: ${e.stop_loss}`,
    `TAKE PROFIT: ${e.take_profit}`, ...(e.exit_price === undefined ? [] : [`EXIT PRICE: ${e.exit_price}`]),
    ...(e.net_result_r === undefined ? [] : [`NET RESULT: ${e.net_result_r.toFixed(4)}R (estimated fees/slippage)`]),
    `ENTRY FEE RATE: ${e.fee_rate_percent ?? "N/A"}%`, `SIGNAL SOURCE: ${e.indicator}`,
    `TIME: ${new Date(e.timestamp).toISOString()}`].join("\n");
}
