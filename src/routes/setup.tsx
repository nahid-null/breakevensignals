import { createFileRoute } from '@tanstack/react-router';
import { useStatuses } from '@/lib/data';
import { StatusBadge } from '@/components/terminal/StatusBadge';
import { SetupReference } from '@/components/terminal/SetupReference';

export const Route = createFileRoute('/setup')({ head: () => ({ meta: [
  { title: 'Engine Deployment — Crypto Signal Terminal' },
  { name: 'description', content: 'How to run the always-on Binance Futures signal scanner on free Render cloud hosting.' },
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
      <div className="flex items-center justify-between border-b border-border py-3 text-sm">Independent scanner<StatusBadge value={health?.heartbeatFresh && health.engine?.runtime_mode === 'production' && health.scanner === 'RUNNING' ? 'CONNECTED' : 'WAITING'} /></div>
      <div className="flex items-center justify-between py-3 text-sm">Pine calculation comparison<StatusBadge value="MANUAL VERIFICATION REQUIRED" /></div>
    </section>
    <section className="space-y-3"><h2 className="font-mono text-sm">FREE RENDER CLOUD HOSTING</h2>
      <p className="text-sm text-muted-foreground">The scanner runs on Render, not on your PC or in Chrome. Render's free plan sleeps after 15 minutes without visits, so the scanner visits its own address every 10 minutes to stay awake. Render can still restart free services; the scanner resumes from saved progress.</p>
      <ol className="list-decimal space-y-3 pl-5 text-sm text-muted-foreground">
        <li>Publish this website so the latest private engine key is live.</li>
        <li>Connect this project to GitHub from the Lovable GitHub button.</li>
        <li>Sign up at render.com, choose New, then Blueprint, and pick your GitHub repository. Render reads the included setup file and selects the Free plan.</li>
        <li>Enter ENGINE_APP_URL and ENGINE_SHARED_SECRET using the setup reference below. The private engine key must match the one saved in Lovable.</li>
        <li>Click Apply. After the first deploy shows Live, this page and the dashboard show CLOUD ONLINE within two minutes.</li>
      </ol>
    </section>
    <SetupReference configuration={health} />
    <section className="border-t border-border pt-5"><h2 className="mb-2 font-mono text-sm">SECURE CONNECTION</h2><p className="text-sm text-muted-foreground">The scanner sends updates over an encrypted connection using the private engine key. Its public address only answers "ok"; it exposes no trades, keys or controls.</p></section>
    <section className="border-t border-border pt-5"><h2 className="mb-2 font-mono text-sm">CONTRACT AVAILABILITY</h2><p className="text-sm text-muted-foreground">The last Binance availability check found 20 of your 21 contracts trading. WILDUSDT was unavailable and remains in the configured list without substituted data.</p></section>
  </div>;
}