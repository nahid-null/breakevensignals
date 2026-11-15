import { join, resolve } from 'node:path';
import { mkdir, appendFile, stat, rename } from 'node:fs/promises';
import { localHealthResponse, authorized } from './local-health';

// Windows task executes this standalone Bun process, never the web runtime.
const root = resolve(import.meta.dir, '..');
const healthSecret = process.env['LOCAL_HEALTH_SECRET'] ?? '';
if (healthSecret.length < 32) throw new Error('LOCAL_HEALTH_SECRET must contain at least 32 characters');
const instance = crypto.randomUUID();
const port = Number(process.env['SUPERVISOR_PORT'] ?? 8787);
const childPort = Number(process.env['ENGINE_HEALTH_PORT'] ?? 8788);
if (![port, childPort].every((p) => Number.isInteger(p) && p > 1024 && p <= 65535) || port === childPort) throw new Error('Invalid local ports');
const logDir = process.env['ENGINE_LOG_DIR'] ?? join(root, 'logs');
await mkdir(logDir, { recursive: true });
let child: ReturnType<typeof Bun.spawn> | null = null;
let stopping = false;
let restarts = 0;
let lastError: string | null = null;
const startedAt = new Date().toISOString();
let childHealth: Record<string, unknown> | null = null;
const redact = (text: string) => ['ENGINE_SHARED_SECRET','LOCAL_HEALTH_SECRET'].reduce((s, key) => {
  const value = process.env[key]; return value ? s.split(value).join('[redacted]') : s;
}, text);
// Bounded operational logs only; never touch trading history.
let logQueue = Promise.resolve();
function log(name: string, message: string) {
  logQueue = logQueue.then(async () => {
    const file = join(logDir, `${name}.log`);
    const info = await stat(file).catch(() => null);
    if (info && info.size > 5_000_000) {
      for (let i = 3; i > 0; i--) await rename(`${file}.${i}`, `${file}.${i + 1}`).catch(() => {});
      await rename(file, `${file}.1`).catch(() => {});
    }
    await appendFile(file, `${new Date().toISOString()} ${redact(message).slice(0, 2000)}\n`);
  }).catch(() => { lastError = 'Unable to write operational logs'; });
}
// Exclusive port is an OS-held lock. A second supervisor exits before spawning.
const server = Bun.serve({ hostname: '127.0.0.1', port, fetch(request) {
  if (new URL(request.url).pathname === '/owner' && request.method === 'GET' && authorized(request, healthSecret)) {
    return Response.json({ instance }, { headers: { 'cache-control': 'no-store' } });
  }
  return localHealthResponse(request, healthSecret, () => ({
    supervisor: stopping ? 'STOPPED' : 'RUNNING', startedAt, restarts,
    workerProcessAlive: child !== null && child.exitCode === null,
    workerPid: child?.pid ?? null,
    engine: childHealth, lastError,
  }));
} });
async function pipe(stream: ReadableStream<Uint8Array>, name: string) {
  const reader = stream.getReader(); const decoder = new TextDecoder();
  try { while (true) { const result = await reader.read(); if (result.done) break; log(name, decoder.decode(result.value, { stream: true })); } }
  finally { reader.releaseLock(); }
}
async function stop() {
  stopping = true; child?.kill(); server.stop(true); await logQueue;
}
for (const event of ['SIGINT','SIGTERM'] as const) process.on(event, () => { void stop().then(() => process.exit(0)); });
log('supervisor', 'Supervisor started; loopback ownership acquired');
while (!stopping) {
  childHealth = null;
  const born = Date.now(); let failures = 0; let initializedOnce = false;
  child = Bun.spawn([process.execPath, join(root, 'engine-worker/main.ts')], {
    cwd: root, env: { ...process.env, ENGINE_HOST_KIND: 'windows_pc', SUPERVISOR_INSTANCE: instance, SUPERVISOR_PORT: String(port), ENGINE_HEALTH_PORT: String(childPort) },
    stdout: 'pipe', stderr: 'pipe',
  });
  void pipe(child.stdout, 'engine'); void pipe(child.stderr, 'engine-error');
  log('supervisor', `Worker started (pid ${child.pid})`);
  const watchdog = setInterval(() => { void (async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${childPort}/health`, { headers: { authorization: `Bearer ${healthSecret}` }, signal: AbortSignal.timeout(4000) });
      if (!response.ok) throw new Error('Worker health unavailable');
      childHealth = await response.json() as Record<string, unknown>;
      if (childHealth['initialized'] === true) initializedOnce = true;
      const messageAge = Date.now() - Number(childHealth['receivedAt'] ?? 0);
      const engineStuck = childHealth['initialized'] === true && messageAge > 300_000;
      const startupStuck = childHealth['initialized'] !== true && Date.now() - born > 600_000;
      if (engineStuck || startupStuck) throw new Error('Worker progress timeout');
      failures = 0; lastError = null;
    } catch {
      failures++;
      childHealth = null;
      if (failures >= 3 && (Date.now() - born > 600_000 || initializedOnce)) {
        lastError = 'Worker unresponsive; restarting'; log('supervisor', lastError); child?.kill();
      }
    }
  })(); }, 15_000);
  const code = await child.exited;
  clearInterval(watchdog); child = null; childHealth = null;
  if (stopping) break;
  restarts++;
  lastError = `Worker exited (${code}); recovery scheduled`;
  log('supervisor', lastError);
  await Bun.sleep(Math.min(60_000, 5000 * 2 ** Math.min(Date.now() - born > 300_000 ? 0 : restarts - 1, 4)));
}
await stop();