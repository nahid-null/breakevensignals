// prompt-74 offline dry run: real Binance data, in-memory account, no database, no Telegram.
import { CstfService } from './cstf-service';
import { cstfCommitSchema } from '../src/lib/engine/cstf-live';
import { initialCstfAccount } from '../src/lib/engine/cstf-account';
const MIN = 60_000; const back = Number(process.argv[2] ?? 95);
let revision = 0; const start = initialCstfAccount(); start.lastMinute = Math.floor(Date.now() / MIN) * MIN - back * MIN;
const commits: unknown[] = [];
const host = { instance: crypto.randomUUID(), leaseOwned: true, marketAccessPaused: false, reportMarketFailure: (e: unknown) => console.error('PAUSE', e),
  async app<T>(action: string, data: unknown): Promise<T> {
    if (action === 'cstf-state') return { revision, state: revision === 0 ? start : null } as T;
    if (action === 'cstf-status') { console.log('status', JSON.stringify(data)); return {} as T; }
    const p = cstfCommitSchema.parse(data); if (p.expected_revision !== revision) return { conflict: true, revision } as T;
    revision++; commits.push(p);
    console.log(JSON.stringify({ commit: revision, mode: p.mode, first: new Date(p.first_minute).toISOString(), through: new Date(p.state.lastMinute!).toISOString(), opened: p.opened.length, closed: p.closed.length, skipped: p.skipped.length, wallet: p.state.wallet, equity: p.equity, open: p.open.length, bytes: JSON.stringify(p).length }));
    return { conflict: false, revision } as T;
  } };
const s = new CstfService(host); s.start();
await new Promise((r) => setTimeout(r, Number(process.argv[3] ?? 150) * 1000)); s.stop();
console.log('DONE commits', revision, 'error', s.lastError);
