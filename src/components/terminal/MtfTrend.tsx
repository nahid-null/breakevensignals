import type { Json } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./StatusBadge";

type Snapshot = { m15: number | null; m5: number | null; m1: number | null };
function parse(value: Json | null | undefined): Snapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const pick = (k: string) => { const v = (value as Record<string, Json | undefined>)[k]; return v === 1 || v === -1 || v === 0 ? v : null; };
  return { m15: pick("m15"), m5: pick("m5"), m1: pick("m1") };
}
const tone = (v: number | null) => v === 1 ? "text-long" : v === -1 ? "text-short" : "text-waiting";
const word = (v: number | null) => v === 1 ? "BULL" : v === -1 ? "BEAR" : v === 0 ? "SIDE" : "—";

/** 15M / 5M / 1M trend from the user's MTF trend detector; signals pass only when all three agree. */
export function MtfTrend({ value }: { value: Json | null | undefined }) {
  const t = parse(value);
  if (!t) return <StatusBadge value="WAITING" />;
  const overall = t.m15 === 1 && t.m5 === 1 && t.m1 === 1 ? "BULLISH" : t.m15 === -1 && t.m5 === -1 && t.m1 === -1 ? "BEARISH" : "MIXED";
  return (
    <div className="flex flex-col items-start gap-1">
      <StatusBadge value={overall} />
      <div className="flex gap-2 font-mono text-[9px]">
        {([["15M", t.m15], ["5M", t.m5], ["1M", t.m1]] as const).map(([label, v]) => (
          <span key={label} className={cn(tone(v))}>{label} {word(v)}</span>
        ))}
      </div>
    </div>
  );
}
