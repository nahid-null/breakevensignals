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
