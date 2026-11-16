// @vitest-environment node
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { cloudHealthResponse, keepAwakeUrl, KEEP_AWAKE_INTERVAL_MS } from '../../engine-worker/cloud-health';

describe('independent worker hosting configuration', () => {
  it('prepares one free Render web service that keeps the scanner awake', () => {
    const schema = z.object({ services: z.array(z.object({ type: z.string(), runtime: z.string(), numInstances: z.number(),
      region: z.string(), autoDeployTrigger: z.string(), dockerfilePath: z.string(), plan: z.string(), healthCheckPath: z.string(), envVars: z.array(z.object({ key: z.string(), sync: z.boolean().optional(), value: z.string().optional() })) })) });
    const config = schema.parse(parse(readFileSync(new URL('../../render.yaml', import.meta.url), 'utf8')));
    expect(config.services).toHaveLength(1);
    expect(config.services[0]).toMatchObject({ type: 'web', plan: 'free', healthCheckPath: '/healthz', runtime: 'docker', numInstances: 1, region: 'frankfurt', autoDeployTrigger: 'off' });
    expect(config.services[0]?.envVars).toEqual([{ key: 'ENGINE_APP_URL', sync: false }, { key: 'ENGINE_SHARED_SECRET', sync: false }, { key: 'ENGINE_HOST_KIND', value: 'hosted' }]);
  });
  it('keeps the scanner awake with a request well inside the 15-minute free-plan idle limit', () => {
    expect(KEEP_AWAKE_INTERVAL_MS).toBeLessThan(15 * 60_000);
    expect(keepAwakeUrl('https://crypto-signal-engine.onrender.com/')).toBe('https://crypto-signal-engine.onrender.com/healthz');
    expect(keepAwakeUrl(undefined)).toBeNull();
  });
  it('public liveness reveals nothing, detailed health still requires the key', async () => {
    const secret = 'isolated-cloud-health-key-with-32-characters';
    const ok = cloudHealthResponse(new Request('https://x.onrender.com/healthz'), secret, () => ({ private: true }));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('ok');
    expect(cloudHealthResponse(new Request('https://x.onrender.com/health'), secret, () => ({})).status).toBe(401);
  });
});
