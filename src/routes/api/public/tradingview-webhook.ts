import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/tradingview-webhook")({
  server: {
    handlers: {
      POST: () => Response.json({ error: "Legacy alert ingestion is disabled. Independent Binance engine only." }, { status: 410 }),
    },
  },
});
