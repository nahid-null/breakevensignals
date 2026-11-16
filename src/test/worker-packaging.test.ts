// @vitest-environment node
import { cp, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const run = promisify(execFile);

it('starts the Docker COPY set without missing signal or paper-robot modules', async () => {
  const root = resolve(import.meta.dirname, '../..');
  const stage = await mkdtemp(join(tmpdir(), 'worker-package-'));
  try {
    const docker = await readFile(join(root, 'engine-worker/Dockerfile'), 'utf8');
    for (const line of docker.split('\n')) {
      const copy = /^COPY (\S+) (\.\/\S+)\s*$/.exec(line);
      if (!copy?.[1] || !copy[2]) continue;
      const destination = join(stage, copy[2]);
      await mkdir(dirname(destination), { recursive: true });
      await cp(join(root, copy[1]), destination, { recursive: true });
    }
    await symlink(join(root, 'node_modules'), join(stage, 'node_modules'), 'dir');
    // No credentials, market requests or writes. Module resolution precedes the expected startup guard.
    const { stdout } = await run('bun', ['-e', `
      process.env.ENGINE_APP_URL = '';
      process.env.ENGINE_SHARED_SECRET = '';
      try { await import('./engine-worker/main.ts'); process.exit(1); }
      catch (error) {
        if (!(error instanceof Error) || error.message !== 'Set ENGINE_APP_URL and ENGINE_SHARED_SECRET in the worker hosting settings') throw error;
        console.log('packaged modules resolved');
      }
    `], { cwd: stage });
    expect(stdout.trim()).toBe('packaged modules resolved');
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}, 30000);