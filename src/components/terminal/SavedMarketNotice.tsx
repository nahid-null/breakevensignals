import { useStatuses } from '@/lib/data';

export function SavedMarketNotice() {
  const { scanner, health } = useStatuses();
  if (scanner === 'RUNNING') return null;
  return <p role="status" className="border-l-2 border-waiting bg-waiting/5 p-3 text-sm text-waiting">
    {health?.lastAccessIssue ? 'Binance access is blocked. Signal updates and signal deliveries are paused; shown trades and signals are last saved records.' : 'Signal monitoring is not confirmed running. Shown trades and signals are last saved records.'}
  </p>;
}