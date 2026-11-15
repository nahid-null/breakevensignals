import { createFileRoute } from '@tanstack/react-router';
import { useStatuses } from '@/lib/data';
import { StatusBadge } from '@/components/terminal/StatusBadge';

export const Route = createFileRoute('/setup')({ head: () => ({ meta: [
  { title: 'Engine Deployment — Crypto Signal Terminal' },
  { name: 'description', content: 'Deployment requirements for the always-on independent Binance Futures signal service.' },
  { property: 'og:title', content: 'Engine Deployment — Crypto Signal Terminal' },
  { property: 'og:description', content: 'Always-on service activation and Binance contract availability.' },
  { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary_large_image' },
] }), component: Setup });
function Setup() {
  const { health } = useStatuses();
  return <div className="max-w-4xl space-y-6"><h1 className="text-2xl font-semibold">Engine deployment</h1>
    <div className="border-l-2 border-waiting bg-waiting/5 p-4 text-sm text-waiting">{health?.heartbeatFresh && health.engine?.runtime_mode === 'production' && health.engine.status !== 'STOPPED' ? 'Engine heartbeat received. See System Health for processing status.' : 'Production activation pending. Publishing the website alone does not start continuous monitoring.'}</div>
    <section className="border-y border-border py-5"><h2 className="mb-4 font-mono text-sm">ACTIVATION CHECKLIST</h2>
      <div className="flex items-center justify-between border-b border-border py-3 text-sm">Private engine credential<StatusBadge value={health?.engineConfigured ? 'CONNECTED' : 'NOT CONFIGURED'} /></div>
      <div className="flex items-center justify-between border-b border-border py-3 text-sm">Windows PC scanner<StatusBadge value={health?.pc === 'ONLINE' && health.scanner === 'RUNNING' ? 'CONNECTED' : 'WAITING'} /></div>
      <div className="flex items-center justify-between py-3 text-sm">Pine calculation comparison<StatusBadge value="MANUAL VERIFICATION REQUIRED" /></div>
    </section>
    <section className="space-y-3"><h2 className="font-mono text-sm">WINDOWS PC · NO PAID VPS</h2>
      <p className="text-sm text-muted-foreground">Installation pending. The PC must stay powered on, awake and connected to the internet.</p>
      <ol className="list-decimal space-y-3 pl-5 text-sm text-muted-foreground">
        <li>Complete the independent Pine comparison and publish the existing website.</li>
        <li>Install the provided Windows scanner package. Supply the published website address and matching private engine key when prompted.</li>
        <li>Enable the provided Windows startup task after verification. It runs before login and restarts failed processes.</li>
        <li>Verify later scan times with browsers closed, then test PC reboot and internet recovery.</li>
      </ol>
    </section>
    <section className="border-t border-border pt-5"><h2 className="mb-2 font-mono text-sm">SECURE CONNECTION</h2><p className="text-sm text-muted-foreground">PC updates use an encrypted outbound connection. No router ports or tunnel are required for the dashboard. Optional Cloudflare Tunnel health checks require your Cloudflare account and an existing domain; they are not activated.</p></section>
    <section className="border-t border-border pt-5"><h2 className="mb-2 font-mono text-sm">CONTRACT AVAILABILITY</h2><p className="text-sm text-muted-foreground">The last Binance availability check found 20 of your 21 contracts trading. WILDUSDT was unavailable and remains in the configured list without substituted data.</p></section>
  </div>;
}