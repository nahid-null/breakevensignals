import { Copy, LockKeyhole } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CLOUD_SETUP, RENDER_SETUP, setupCopyText, type SetupEntry } from '@/lib/setup-reference';

type Configuration = { engineConfigured?: boolean; botConfigured?: boolean; chatConfigured?: boolean };

function CopyAction({ text, label }: { text: string; label: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied');
    } catch {
      toast.error('Could not copy. Select and copy the visible text instead.');
    }
  };
  return <Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon" aria-label={label} onClick={copy} className="shrink-0"><Copy /></Button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
}

function ReferenceRow({ entry, configuration }: { entry: SetupEntry; configuration: Configuration | undefined }) {
  const publicValue = setupCopyText(entry, 'value');
  const configured = entry.kind === 'private' ? entry.status === 'engine' ? configuration?.engineConfigured : entry.status === 'chat' ? configuration?.chatConfigured : configuration?.botConfigured : undefined;
  return <div className="grid min-w-0 gap-2 border-b border-border/60 py-4 last:border-b-0 sm:grid-cols-2 sm:gap-6">
    <div className="min-w-0">
      <div className="flex items-center gap-2"><code className="min-w-0 break-all text-xs">{entry.name}</code><CopyAction text={entry.name} label={`Copy ${entry.name} name`} /></div>
      <p className="text-xs text-muted-foreground">{entry.note}</p>
    </div>
    {publicValue !== null ? <div className="flex min-w-0 items-center gap-2"><code className="min-w-0 break-all text-xs">{publicValue}</code><CopyAction text={publicValue} label={`Copy ${entry.name} value`} /></div> :
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><LockKeyhole className="h-4 w-4 shrink-0" /><span>Private value hidden · {configured === undefined ? 'checking configuration' : configured ? 'configured' : 'not configured'}</span></div>}
  </div>;
}

export function SetupReference({ configuration }: { configuration: Configuration | undefined }) {
  return <TooltipProvider><section aria-labelledby="render-values" className="border-y border-border py-5">
    <h2 id="render-values" className="font-mono text-sm">RENDER SETUP VALUES</h2>
    <div>{RENDER_SETUP.map((entry) => <ReferenceRow key={entry.name} entry={entry} configuration={configuration} />)}</div>
    <div className="mt-4 border-l-2 border-waiting bg-waiting/5 p-4 text-sm">
      <h3 className="mb-2 font-semibold">Forgot the private engine key?</h3>
      <p className="text-muted-foreground">Saved private keys cannot be retrieved here. Ask for a secure ENGINE_SHARED_SECRET replacement in Lovable. Copy the new value from that secure form into Render, save it in both places, then republish this website. Never paste the key into chat.</p>
    </div>
  </section>
    <section aria-labelledby="cloud-values" className="border-b border-border pb-5">
      <h2 id="cloud-values" className="font-mono text-sm">LOVABLE-ONLY KEYS</h2>
      <p className="mt-2 text-sm text-muted-foreground">These stay in Lovable. Do not add them to Render. Binance market data needs no trading API key, and Render needs no database key.</p>
      <div>{CLOUD_SETUP.map((entry) => <ReferenceRow key={entry.name} entry={entry} configuration={configuration} />)}</div>
    </section></TooltipProvider>;
}