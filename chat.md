# Project memory — Crypto Signal Terminal
- Personal, no-login monitor for 21 Binance USDT futures pairs × LONG/SHORT (PRO LONG/SHORT SCALPER Pine v6).
- Flow: TradingView alert() JSON → /api/public/tradingview-webhook → database → live dashboard. Telegram ONLY on breakeven_activated.
- Pine changes: added tradeEntryTime for trade_id; section 17 alerts now emit JSON. Trading logic unchanged. Scripts: src/pine/*.pine.
- Pages: Dashboard, Signal History, Telegram, System Health, Settings, Setup Guide.
- Remaining: user must publish, then create 42 TradingView alerts with the webhook URL.
