import { createFileRoute } from '@tanstack/react-router';
import { useStatuses } from '@/lib/data';
import { StatusBadge } from '@/components/terminal/StatusBadge';
import { SetupReference } from '@/components/terminal/SetupReference';

export const Route = createFileRoute('/setup')({ head: () => ({ meta: [
  { title: 'Engine Deployment — Crypto Signal Terminal' },
  { name: 'description', content: 'Railway deployment settings and lawful Binance Futures data-access checks for the independent signal scanner.' },
  { property: 'og:title', content: 'Engine Deployment — Crypto Signal Terminal' },
  { property: 'og:description', content: 'Always-on service activation and Binance contract availability.' },
  { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary_large_image' },
] }), component: Setup });
function Setup() {
  const { health, scanner } = useStatuses();
  return <div className="max-w-4xl space-y-6"><h1 className="text-2xl font-semibold">Engine deployment</h1>
    <div className="border-l-2 border-waiting bg-waiting/5 p-4 text-sm text-waiting">{health?.heartbeatFresh && health.engine?.runtime_mode === 'production' && health.engine.status !== 'STOPPED' ? 'Engine heartbeat received. See System Health for processing status.' : 'Production activation pending. Publishing the website alone does not start continuous monitoring.'}</div>
    <section className="border-y border-border py-5"><h2 className="mb-4 font-mono text-sm">ACTIVATION CHECKLIST</h2>
      <div className="flex items-center justify-between border-b border-border py-3 text-sm">Private engine credential<StatusBadge value={health?.engineConfigured ? 'CONNECTED' : 'NOT CONFIGURED'} /></div>
      <div className="flex items-center justify-between border-b border-border py-3 text-sm">Independent scanner<StatusBadge value={scanner === 'ERROR' ? 'ERROR' : health?.heartbeatFresh && health.engine?.runtime_mode === 'production' && scanner === 'RUNNING' ? 'CONNECTED' : 'WAITING'} /></div>
      <div className="flex items-center justify-between py-3 text-sm">Pine calculation comparison<StatusBadge value="MANUAL VERIFICATION REQUIRED" /></div>
    </section>
    <section className="space-y-3"><h2 className="font-mono text-sm">RAILWAY DEPLOYMENT</h2>
      <p className="text-sm text-muted-foreground">Railway hosts the scanner separately from this website. A running cloud service does not guarantee Binance access or active scanning. Costs and uninterrupted operation are not guaranteed.</p>
      <ol className="list-decimal space-y-3 pl-5 text-sm text-muted-foreground">
        <li>In your existing Railway service, check Settings for the selected region. Keep it unchanged until Binance confirms permitted access.</li>
        <li>Check Variables against the setup reference below. Keep the existing private engine key; it must match Lovable. Railway supplies PORT automatically.</li>
        <li>Publish this website and deploy the matching scanner update using engine-worker/Dockerfile. Keep one scanner instance.</li>
        <li>Check System Health for a fresh cloud heartbeat. If Binance rejects access, the scanner stays paused and reports the restriction.</li>
        <li>For HTTP 451, share only the public error message and selected region. Confirm eligibility with Binance before restarting; do not use proxies or change regions to bypass restrictions.</li>
      </ol>
    </section>
    <SetupReference configuration={health} />
    <section className="border-t border-border pt-5"><h2 className="mb-2 font-mono text-sm">SECURE CONNECTION</h2><p className="text-sm text-muted-foreground">The scanner sends updates over an encrypted connection using the private engine key. Its public address only answers "ok"; it exposes no trades, keys or controls.</p></section>
    <section className="border-t border-border pt-5"><h2 className="mb-2 font-mono text-sm">CONTRACT AVAILABILITY</h2><p className="text-sm text-muted-foreground">Your 12 approved coins (BTC, ETH, SOL, XRP, BNB, DOGE, LINK, NEAR, BCH, LTC, ADA, AVAX) are the only contracts scanned and traded.</p></section>
  </div>;
}