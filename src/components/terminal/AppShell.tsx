import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Activity, BookOpen, History, Send, Settings, HeartPulse, List, Wallet, LineChart, ChevronDown, Bot, Radar, FlaskConical } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useRealtimeSync, useStatuses, fmtTime } from "@/lib/data";
import { StatusBadge } from "./StatusBadge";

const NAV = [
  { to: "/", label: "Dashboard", icon: Activity },
  { to: "/simulator", label: "Simulator", icon: Wallet },
  { to: "/robot", label: "Paper Robot", icon: Bot },
] as const;
const MORE = [
  { to: "/robot-coins", label: "Robot Coins", icon: Radar },
  { to: "/robot-backtest", label: "Robot Backtest", icon: FlaskConical },
  { to: "/markets", label: "Coin Monitor", icon: LineChart },
  { to: "/signals", label: "Signal History", icon: History },
  { to: '/positions', label: 'Trade Ledger', icon: List },
  { to: "/telegram", label: "Telegram", icon: Send },
  { to: "/health", label: "System Health", icon: HeartPulse },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/setup", label: "Engine Setup", icon: BookOpen },
] as const;

function UtcClock() {
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const t = () => setNow(new Date().toISOString().slice(11, 19));
    t();
    const id = setInterval(t, 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="font-mono text-sm tabular-nums text-foreground">{now || "--:--:--"} UTC</span>;
}

export function AppShell({ children }: { children: ReactNode }) {
  useRealtimeSync();
  const s = useStatuses();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded border border-primary/40 bg-primary/10">
              <Activity className="h-4 w-4 text-primary" />
            </div>
            <span className="font-mono text-sm font-semibold">CRYPTO SIGNAL TERMINAL</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">SYSTEM <StatusBadge value={s.system} /></span>
            <span className="flex items-center gap-1.5">CLOUD <StatusBadge value={s.cloud} /></span>
            <span className="flex items-center gap-1.5">SCANNER <StatusBadge value={s.scanner} /></span>
            <span className="flex items-center gap-1.5">BINANCE <StatusBadge value={s.binance} /></span>
            <span className="flex items-center gap-1.5">WEBSOCKET <StatusBadge value={s.websocket} /></span>
            <span className="flex items-center gap-1.5">TELEGRAM <StatusBadge value={s.telegram} /></span>
            <span>LAST CANDLE <span className="font-mono text-foreground">{fmtTime(s.health?.lastCandleAt)}</span></span>
          </div>
          <div className="ml-auto"><UtcClock /></div>
        </div>
        <nav className="mx-auto flex max-w-[1600px] gap-1 overflow-x-auto px-4 pb-2">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: to === "/" }}
              className="flex items-center gap-1.5 whitespace-nowrap rounded px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              activeProps={{ className: "bg-accent text-foreground" }}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </Link>
          ))}
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-1.5 whitespace-nowrap rounded px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              More <ChevronDown className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {MORE.map(({ to, label, icon: Icon }) => (
                <DropdownMenuItem key={to} asChild>
                  <Link to={to} className="flex items-center gap-2 text-xs"><Icon className="h-3.5 w-3.5" /> {label}</Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>
      </header>
      <main className="mx-auto max-w-[1600px] px-4 py-6">{children}</main>
    </div>
  );
}
