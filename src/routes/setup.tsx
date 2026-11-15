import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Copy, Download } from "lucide-react";
import { toast } from "sonner";
import longPine from "@/pine/long.pine?raw";
import shortPine from "@/pine/short.pine?raw";
import { SYMBOLS } from "@/lib/config";
import { WEBHOOK_URL_LIVE } from "@/lib/urls";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/setup")({
  head: () => ({
    meta: [
      { title: "Setup Guide — Crypto Signal Terminal" },
      { name: "description", content: "How to set up the 42 TradingView alerts that feed this terminal." },
      { property: "og:title", content: "Setup Guide — Crypto Signal Terminal" },
      { property: "og:description", content: "How to set up the 42 TradingView alerts." },
    ],
  }),
  component: Setup,
});

function download(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  a.download = name;
  a.click();
}

const TEST_CMD = `curl -X POST "${WEBHOOK_URL_LIVE}" \\
  -H "Content-Type: application/json" \\
  -d '{"event":"entry_confirmed","event_id":"TEST-1","trade_id":"TEST-1","symbol":"NEARUSDT","direction":"LONG","indicator":"PRO LONG SCALPER","timeframe":"1","entry_price":1,"stop_loss":0.9,"take_profit":1.15,"fee_rate_percent":0.04,"timestamp":"2026-01-01T00:00:00Z"}'`;

function Setup() {
  const [done, setDone] = useState<Record<string, boolean>>({});
  const copy = (t: string) => { void navigator.clipboard.writeText(t); toast.success("Copied"); };
  const steps = [
    "Open TradingView and add the updated PRO LONG SCALPER (below) to a Binance USDT perpetual chart — e.g. BINANCE:NEARUSDT.P — on the 1-minute timeframe.",
    "Create an alert: Condition = PRO LONG SCALPER → \"Any alert() function call\". Expiration = open-ended.",
    "In Notifications, tick Webhook URL and paste the URL below with your webhook key after ?token=. Leave the Message box empty — the indicator writes the message itself.",
    "Repeat for all 21 coins, then do the same with PRO SHORT SCALPER. That is 42 alerts in total (needs a TradingView plan that allows that many alerts).",
    "Tick each one off in the checklist below, and confirm in TradingView's Alerts panel that every alert shows Active.",
  ];
  return (
    <div className="space-y-6">
      <h1 className="font-mono text-lg tracking-widest">TRADINGVIEW SETUP GUIDE</h1>
      <section className="glass space-y-3 p-4">
        <ol className="list-decimal space-y-2 pl-5 text-sm">{steps.map((s) => <li key={s}>{s}</li>)}</ol>
        <code className="block break-all rounded bg-background/60 p-2 font-mono text-xs">{WEBHOOK_URL_LIVE}</code>
        <p className="text-xs text-muted-foreground">The webhook only works after you publish the site. TradingView alerts run on TradingView's servers, so monitoring continues when this site is closed.</p>
      </section>

      <section className="glass space-y-3 p-4">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground">What changed in your indicators</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Added one saved value, <code className="font-mono">tradeEntryTime</code>, recorded at entry so each trade gets a stable ID.</li>
          <li>Replaced the text messages in section 17 (Dynamic Alert Messages) with JSON messages for entry, breakeven, stop loss and take profit.</li>
          <li>All calculations, entry rules, stop loss, take profit, breakeven trigger, inputs and alertconditions are untouched.</li>
          <li>A stop-loss hit after breakeven is sent as <code className="font-mono">stop_loss_hit</code>; the dashboard knows breakeven was active from the earlier event.</li>
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => download("PRO_LONG_SCALPER_webhook.pine", longPine)}><Download className="h-4 w-4" /> LONG script</Button>
          <Button variant="outline" onClick={() => copy(longPine)}><Copy className="h-4 w-4" /> Copy LONG</Button>
          <Button variant="outline" onClick={() => download("PRO_SHORT_SCALPER_webhook.pine", shortPine)}><Download className="h-4 w-4" /> SHORT script</Button>
          <Button variant="outline" onClick={() => copy(shortPine)}><Copy className="h-4 w-4" /> Copy SHORT</Button>
        </div>
      </section>

      <section className="glass p-4">
        <h2 className="mb-3 text-xs uppercase tracking-widest text-muted-foreground">Alert checklist (saved on this device only)</h2>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {SYMBOLS.map((s) => (
            <div key={s} className="flex items-center gap-3 rounded px-2 py-1.5 hover:bg-accent/40">
              <span className="w-28 font-mono text-sm">{s}</span>
              {(["LONG", "SHORT"] as const).map((d) => (
                <label key={d} className={`flex items-center gap-1 font-mono text-xs ${d === "LONG" ? "text-long" : "text-short"}`}>
                  <input type="checkbox" checked={!!done[`${s}${d}`]} onChange={(e) => setDone({ ...done, [`${s}${d}`]: e.target.checked })} /> {d}
                </label>
              ))}
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{Object.values(done).filter(Boolean).length} / 42 ticked</p>
      </section>

      <section className="glass space-y-2 p-4">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground">Test the webhook</h2>
        <p className="text-sm text-muted-foreground">Running this creates a real test entry for NEARUSDT LONG in your history.</p>
        <pre className="overflow-x-auto rounded bg-background/60 p-3 font-mono text-xs">{TEST_CMD}</pre>
      </section>

      <p className="text-xs text-muted-foreground">Note: this site has no login, so anyone with the link can view the dashboard and use the settings buttons. Secret keys are never shown on any page.</p>
    </div>
  );
}
