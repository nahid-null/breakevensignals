import { PGlite } from '@electric-sql/pglite';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SignalService } from './service';
import { commitSchema, heartbeatSchema, marketSchema } from '../src/lib/engine/protocol';
import { formatSignalMessage } from '../src/lib/telegram-format';
import { delay } from './binance';
import { feedHasLiveEvidence } from '../src/lib/engine/feed-health';

// Real Binance + isolated disk PostgreSQL. Never uses the hosted app or its credentials.
const directory = await mkdtemp(join(tmpdir(), 'worker-verification-'));
let db = new PGlite(join(directory, 'db'));
await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
for (const migration of (await readdir(new URL('../drizzle/migrations/', import.meta.url))).filter((f) => f.endsWith('.sql') && f !== '0001_migration.sql').sort()) {
  const sql = (await readFile(new URL(`../drizzle/migrations/${migration}`, import.meta.url), 'utf8')).replace(/^ALTER PUBLICATION.*$/gm, '');
  await db.exec(sql);
}
const report = { scope: 'Temporary real Binance worker verification with isolated disk PostgreSQL; NOT deployed production',
  directory, startedAt: new Date().toISOString(), initialContracts: 0, reconnectPassed: false, candleAdvancePassed: false,
  restoredCheckpoints: 0, restartPassed: false, successfulCandleScans: 0, scanCountRestored: false, validatedLiveFeeds: 0, isolatedPendingNotifications: 0, productionWrites: 0, completedAt: '' };
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  if (request.headers.get('authorization') !== 'Bearer isolated-verification-key') return new Response('Unauthorized', { status: 401 });
  try {
    const input = await request.json();
    if (input.action === 'heartbeat') {
      const data = heartbeatSchema.parse(input.data);
      const result = await db.query<{ acquired: boolean }>('select engine_heartbeat($1::jsonb) acquired', [JSON.stringify(data)]);
      return Response.json({ acquired: result.rows[0]?.acquired ?? false });
    }
    if (input.action === 'state') return Response.json({ checkpoints: (await db.query('select symbol,revision,state from engine_checkpoints')).rows });
    if (input.action === 'market-state') return Response.json({ markets: (await db.query('select * from market_state')).rows });
    if (input.action === 'commit') {
      const data = commitSchema.parse(input.data);
      const events = data.events.map((e) => ({ ...e, telegram_message: data.mode === 'live' ? formatSignalMessage(e) : '' }));
      const result = await db.query<{ result: unknown }>('select commit_engine_candle($1::jsonb) result', [JSON.stringify({ ...data, events })]);
      return Response.json(result.rows[0]?.result);
    }
    if (input.action === 'market') {
      const m = marketSchema.parse(input.data.market);
      await db.query('insert into market_state(symbol,price,trend,status,last_candle_at,long_score,short_score,error) values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(symbol) do update set price=excluded.price', [m.symbol,m.price,m.trend,m.status,m.last_candle_at,m.long_score,m.short_score,m.error]);
      return Response.json({ ok: true });
    }
    if (input.action === 'stop') {
      const result = await db.query<{ stopped: boolean }>('select stop_engine($1::uuid) stopped', [input.data.instance_id]);
      return Response.json({ stopped: result.rows[0]?.stopped });
    }
    // Do not deliver historical fixture notifications to a real chat. Test live Telegram separately.
    if (input.action === 'deliveries') return Response.json({ ok: true });
    return new Response('Unknown action', { status: 422 });
  } catch (error) { console.error('Isolated verification failed', error instanceof Error ? error.message : 'unknown'); return new Response('Failed', { status: 500 }); }
} });
const url = `http://localhost:${server.port}`;
let service: SignalService | null = new SignalService(url, 'isolated-verification-key', false, 'temporary');
try {
  await service.start();
  const first = service.snapshot();
  report.initialContracts = first.available;
  if (!first.connected || first.available < 1) throw new Error('Real Binance worker did not connect');
  service.disconnectForTest();
  const deadline = Date.now() + 155_000;
  while (Date.now() < deadline) {
    await delay(2000);
    const latest = service.snapshot();
    report.reconnectPassed = latest.connected;
    report.validatedLiveFeeds = latest.feed_health.feeds.filter((feed) => feedHasLiveEvidence(feed)).length;
    report.candleAdvancePassed = first.counts.every((saved) => {
      const current = latest.counts.find((c) => c.symbol === saved.symbol);
      return current?.lastTime !== null && current?.lastTime !== undefined && saved.lastTime !== null && current.lastTime > saved.lastTime;
    });
    if (report.reconnectPassed && report.candleAdvancePassed && latest.running && report.validatedLiveFeeds === latest.available) break;
  }
  if (!report.reconnectPassed || !report.candleAdvancePassed || report.validatedLiveFeeds !== first.available) throw new Error('Real reconnection/validated live feed/candle advance failed');
  await service.stop(); service = null;
  const before = (await db.query<{ symbol: string; revision: number; state: { lastTime: number } }>('select symbol,revision,state from engine_checkpoints')).rows;
  report.successfulCandleScans = (await db.query<{ n: number }>('select sum(successful_scans)::int n from market_state')).rows[0]?.n ?? 0;
  if (report.successfulCandleScans < first.available) throw new Error('Successful scan counters did not advance');
  await db.close();
  db = new PGlite(join(directory, 'db'));
  const restored = (await db.query<{ symbol: string; revision: number; state: { lastTime: number } }>('select symbol,revision,state from engine_checkpoints')).rows;
  if (JSON.stringify(before) !== JSON.stringify(restored)) throw new Error('Disk persistence mismatch');
  report.scanCountRestored = (await db.query<{ n: number }>('select sum(successful_scans)::int n from market_state')).rows[0]?.n === report.successfulCandleScans;
  if (!report.scanCountRestored) throw new Error('Scan counter disk persistence mismatch');
  report.restoredCheckpoints = restored.length;
  service = new SignalService(url, 'isolated-verification-key', false, 'temporary');
  await service.start();
  report.restartPassed = before.every((row) => {
    const saved = service?.snapshot().counts.find((c) => c.symbol === row.symbol);
    return saved?.lastTime !== null && saved?.lastTime !== undefined && saved.lastTime >= row.state.lastTime;
  });
  if (!report.restartPassed) throw new Error('Worker restart checkpoint mismatch');
  report.isolatedPendingNotifications = (await db.query<{ count: number }>("select count(*)::int count from telegram_logs where delivery_status='PENDING'")).rows[0]?.count ?? 0;
  report.completedAt = new Date().toISOString();
} finally {
  if (service) await service.stop();
  server.stop(true); await db.close();
  const output = process.env['WORKER_REPORT_PATH'] ?? join(tmpdir(), 'worker-verification-report.json');
  await writeFile(output, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));