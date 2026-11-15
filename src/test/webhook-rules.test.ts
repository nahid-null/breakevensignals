import { describe, expect, it } from "vitest";
import { webhookSchema } from "@/lib/webhook-schema";
import { SYMBOLS } from "@/lib/config";
import { formatBreakevenMessage } from "@/lib/telegram-format";

const base = {
  event: "entry_confirmed", event_id: "e1", trade_id: "t1", symbol: "NEARUSDT.P", direction: "LONG",
  indicator: "PRO LONG SCALPER", timeframe: "1", entry_price: 5.25, stop_loss: 5.1, take_profit: 5.475,
  fee_rate_percent: 0.04, timestamp: "2026-11-15T12:00:00Z",
};

describe("webhook rules", () => {
  it("monitors exactly 21 symbols", () => expect(SYMBOLS).toHaveLength(21));
  it("accepts TradingView .P tickers and normalizes them", () => {
    expect(webhookSchema.parse(base).symbol).toBe("NEARUSDT");
  });
  it("rejects symbols outside the list", () => {
    expect(webhookSchema.safeParse({ ...base, symbol: "BTCUSDT" }).success).toBe(false);
  });
  it("rejects a SHORT event claiming the LONG indicator", () => {
    expect(webhookSchema.safeParse({ ...base, direction: "SHORT" }).success).toBe(false);
  });
  it("labels fee as ENTRY FEE RATE", () => {
    const m = formatBreakevenMessage({ ...base, direction: "SHORT", indicator: "PRO SHORT SCALPER", fee_rate_percent: 0.04 });
    expect(m).toContain("ENTRY FEE RATE: 0.04%");
    expect(m).toContain("📉 POSITION: SHORT");
  });
});
