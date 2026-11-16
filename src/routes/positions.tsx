import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { usePositions, useSettings } from '@/lib/data';
import { PositionDetails } from '@/components/terminal/PositionDetails';
import { Button } from '@/components/ui/button';
import { SavedMarketNotice } from '@/components/terminal/SavedMarketNotice';

export const Route = createFileRoute('/positions')({ head: () => ({ meta: [
  { title: 'Trade Ledger — Crypto Signal Terminal' }, { name: 'description', content: 'Active positions and completed cryptocurrency trades with original levels and estimated net R results.' },
  { property: 'og:title', content: 'Trade Ledger — Crypto Signal Terminal' }, { property: 'og:description', content: 'Independent LONG and SHORT position ledger.' },
  { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary_large_image' },
] }), component: Positions });
function Positions() {
  const [tab, setTab] = useState<'ACTIVE' | 'COMPLETED'>('ACTIVE');
  const positions = usePositions();
  const timezone = useSettings().data?.display_timezone ?? 'UTC';
  const rows = positions.data?.filter((p) => tab === 'ACTIVE' ? ['ACTIVE','BREAKEVEN'].includes(p.status) : !['ACTIVE','BREAKEVEN'].includes(p.status)) ?? [];
  return <div className="space-y-5"><h1 className="text-2xl font-semibold">Trade ledger</h1>
    {tab === 'ACTIVE' && <SavedMarketNotice />}
    <div className="flex gap-2 border-b border-border pb-3">{(['ACTIVE','COMPLETED'] as const).map((t) => <Button key={t} variant={tab === t ? 'secondary' : 'ghost'} size="sm" onClick={() => setTab(t)}>{t === 'ACTIVE' ? 'Active positions' : 'Completed trades'}</Button>)}</div>
    {positions.isError ? <p className="text-short">Could not load trades.</p> : positions.isLoading ? <p className="text-muted-foreground">Loading trades…</p> : !rows.length ? <p className="py-12 text-center text-muted-foreground">No {tab.toLowerCase()} trades.</p> : rows.map((p) => <PositionDetails key={p.id} p={p} timezone={timezone} />)}
  </div>;
}