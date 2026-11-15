// @vitest-environment node
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('actual Bun supervisor subprocess without production access', () => {
  it('rejects duplicate supervisors before spawning and restarts a crashed child', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'supervisor-test-'));
    const port = 22000 + Math.floor(Math.random() * 1000);
    const env = { PATH: process.env['PATH'], HOME: process.env['HOME'], LOCAL_HEALTH_SECRET: 'isolated-test-only-health-key-at-least-32',
      SUPERVISOR_PORT: String(port), ENGINE_HEALTH_PORT: String(port + 1000), ENGINE_LOG_DIR: dir,
      ENGINE_APP_URL: '', ENGINE_SHARED_SECRET: '' };
    const worker = spawn('bun', ['engine-worker/supervisor.ts'], { cwd: process.cwd(), env, stdio: 'ignore' });
    const get = async () => {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { headers: { authorization: `Bearer ${env.LOCAL_HEALTH_SECRET}` } });
      return response.json() as Promise<{ restarts: number; workerProcessAlive: boolean }>;
    };
    try {
      let health: Awaited<ReturnType<typeof get>> | null = null;
      for (let i = 0; i < 30; i++) { try { health = await get(); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
      expect(health).not.toBeNull();
      const duplicate = spawn('bun', ['engine-worker/supervisor.ts'], { cwd: process.cwd(), env, stdio: 'ignore' });
      const code = await new Promise<number | null>(resolve => duplicate.on('exit', resolve));
      expect(code).not.toBe(0);
      for (let i = 0; i < 80; i++) { health = await get(); if (health.restarts >= 2) break; await new Promise(r => setTimeout(r, 100)); }
      expect(health?.restarts).toBeGreaterThanOrEqual(2);
    } finally {
      worker.kill('SIGTERM');
      await new Promise(r => worker.on('exit', r));
      await rm(dir, { recursive: true, force: true });
    }
  }, 15000);
});