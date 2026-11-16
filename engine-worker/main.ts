import { SignalService } from './service';
import { localHealthResponse } from './local-health';
import { cloudHealthResponse, keepAwakeUrl, KEEP_AWAKE_INTERVAL_MS } from './cloud-health';

const observe = process.argv.includes('--observe');
const url = process.env['ENGINE_APP_URL'];
const secret = process.env['ENGINE_SHARED_SECRET'];
if (!observe && (!url || !secret)) throw new Error('Set ENGINE_APP_URL and ENGINE_SHARED_SECRET in the worker hosting settings');
if (url && !url.startsWith('https://') && !url.startsWith('http://localhost:')) throw new Error('Engine app URL must use HTTPS');
const kind = process.env['ENGINE_HOST_KIND'] ?? (process.env['RENDER'] || process.env['RAILWAY_ENVIRONMENT_ID'] ? 'hosted' : undefined);
const hostKind = kind === 'windows_pc' || kind === 'hosted' || kind === 'temporary' ? kind : 'unknown';
const runtimeMode = observe || process.env['ENGINE_RUNTIME_MODE'] === 'temporary' ? 'temporary' : 'production';
const service = new SignalService((url ?? '').replace(/\/$/, ''), secret ?? '', observe, runtimeMode, hostKind);
const healthSecret = process.env['LOCAL_HEALTH_SECRET'] ?? '';
// Worker scripts run on Bun, outside SSR. Cloud web services bind their assigned PORT.
const cloudPort = hostKind === 'hosted' ? Number(process.env['PORT'] ?? 0) : 0;
const local = cloudPort > 0 ? Bun.serve({ hostname: '0.0.0.0', port: cloudPort,
  fetch: (request) => cloudHealthResponse(request, healthSecret, () => service.snapshot()),
}) : hostKind === 'windows_pc' ? Bun.serve({ hostname: '127.0.0.1', port: Number(process.env['ENGINE_HEALTH_PORT'] ?? 8788),
  fetch: (request) => localHealthResponse(request, healthSecret, () => service.snapshot()),
}) : null;
if (hostKind === 'windows_pc' && healthSecret.length < 32) throw new Error('Local health key is missing');
const awakeUrl = cloudPort > 0 ? keepAwakeUrl(process.env['RENDER_EXTERNAL_URL']) : null;
if (awakeUrl) setInterval(() => { void fetch(awakeUrl, { signal: AbortSignal.timeout(10_000) }).catch(() => undefined); }, KEEP_AWAKE_INTERVAL_MS);
let stopping = false;
async function shutdown(code: number) {
  if (stopping) return;
  stopping = true;
  local?.stop(true);
  await service.stop();
  process.exit(code);
}
for (const event of ['SIGINT', 'SIGTERM'] as const) process.on(event, () => { void shutdown(0); });
const parentId = process.env['SUPERVISOR_INSTANCE'];
let parentLastSeen = Date.now();
if (parentId) setInterval(() => { void (async () => {
  try {
    const response = await fetch(`http://127.0.0.1:${Number(process.env['SUPERVISOR_PORT'] ?? 8787)}/owner`, {
      headers: { authorization: `Bearer ${healthSecret}` }, signal: AbortSignal.timeout(4000),
    });
    if (response.ok && (await response.json()).instance === parentId) parentLastSeen = Date.now();
  } catch { /* Parent outage is checked against a deadline, not assumed healthy. */ }
  if (Date.now() - parentLastSeen > 45_000) await shutdown(1);
})(); }, 15_000);
try { await service.start(); }
catch (error) { console.error(error instanceof Error ? error.message : 'Worker startup failed'); await shutdown(1); }