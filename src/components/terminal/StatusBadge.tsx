import { cn } from "@/lib/utils";

const tone: Record<string, string> = {
  ONLINE: "text-long border-long/40 bg-long/10",
  CONNECTED: "text-long border-long/40 bg-long/10",
  SENT: "text-long border-long/40 bg-long/10",
  ACTIVE: "text-primary border-primary/40 bg-primary/10",
  processed: "text-long border-long/40 bg-long/10",
  BREAKEVEN: "text-breakeven border-breakeven/40 bg-breakeven/10",
  "TAKE PROFIT HIT": "text-long border-long/40 bg-long/10",
  "STOP LOSS HIT": "text-short border-short/40 bg-short/10",
  OFFLINE: "text-short border-short/40 bg-short/10",
  ERROR: "text-short border-short/40 bg-short/10",
  FAILED: "text-short border-short/40 bg-short/10",
  unmatched: "text-breakeven border-breakeven/40 bg-breakeven/10",
  stale: "text-waiting border-waiting/40 bg-waiting/10",
  PENDING: "text-breakeven border-breakeven/40 bg-breakeven/10",
  "MANUAL VERIFICATION REQUIRED": "text-breakeven border-breakeven/40 bg-breakeven/10",
  LONG: "text-long border-long/40 bg-long/10",
  SHORT: "text-short border-short/40 bg-short/10",
};

export function StatusBadge({ value, className }: { value: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider",
        tone[value] ?? "text-waiting border-waiting/30 bg-waiting/10",
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {value.replace(/_/g, " ")}
    </span>
  );
}

export function positionLabel(status: string | undefined) {
  if (!status) return "WAITING";
  return status.replace(/_/g, " ");
}
