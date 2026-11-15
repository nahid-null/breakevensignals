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
    <div className="border-l-2 border-waiting bg-waiting/5 p-4 text-sm text-waiting">{health?.heartbeatFresh ? 'Engine heartbeat received. See System Health for processing status.' : 'Production activation pending. Publishing the website alone does not start continuous monitoring.'}</div>
    <section className="border-y border-border py-5"><h2 className="mb-4 font-mono text-sm">ACTIVATION CHECKLIST</h2>
      <div className="flex items-center justify-between border-b border-border py-3 text-sm">Private engine credential<StatusBadge value={health?.engineConfigured ? 'CONNECTED' : 'NOT CONFIGURED'} /></div>
      <div className="flex items-center justify-between border-b border-border py-3 text-sm">Always-on service<StatusBadge value={health?.heartbeatFresh ? 'CONNECTED' : 'WAITING'} /></div>
      <div className="flex items-center justify-between py-3 text-sm">Pine calculation comparison<StatusBadge value="MANUAL VERIFICATION REQUIRED" /></div>
    </section>
    <section className="space-y-3"><h2 className="font-mono text-sm">RENDER BACKGROUND WORKER</h2>
      <p className="text-sm text-muted-foreground">A single continuously running service is required. A Render Starter background worker is approximately $7/month; confirm current pricing before deployment.</p>
      <ol className="list-decimal space-y-3 pl-5 text-sm text-muted-foreground">
        <li>Publish this website and connect the project source to your Render account.</li>
        <li>Create a service from the included Render Blueprint. Use one background worker in Frankfurt.</li>
        <li>Set ENGINE_APP_URL to your published website address, and ENGINE_SHARED_SECRET to the same private key stored in Lovable Cloud.</li>
        <li>Confirm all available feeds and fresh candles on System Health. Complete the original-Pine comparison before relying on signals.</li>
      </ol>
    </section>
    <section className="border-t border-border pt-5"><h2 className="mb-2 font-mono text-sm">CONTRACT AVAILABILITY</h2><p className="text-sm text-muted-foreground">The last Binance availability check found 20 of your 21 contracts trading. WILDUSDT was unavailable and remains in the configured list without substituted data.</p></section>
  </div>;
}