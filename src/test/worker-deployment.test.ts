// @vitest-environment node
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

describe('independent worker hosting configuration', () => {
  it('prepares one persistent Render background worker, not a browser or web-request process', () => {
    const schema = z.object({ services: z.array(z.object({ type: z.string(), runtime: z.string(), numInstances: z.number(),
      region: z.string(), autoDeployTrigger: z.string(), dockerfilePath: z.string(), envVars: z.array(z.object({ key: z.string(), sync: z.boolean() })) })) });
    const config = schema.parse(parse(readFileSync(new URL('../../render.yaml', import.meta.url), 'utf8')));
    expect(config.services).toHaveLength(1);
    expect(config.services[0]).toMatchObject({ type: 'worker', runtime: 'docker', numInstances: 1, region: 'frankfurt', autoDeployTrigger: 'off' });
    expect(config.services[0]?.envVars).toEqual([{ key: 'ENGINE_APP_URL', sync: false }, { key: 'ENGINE_SHARED_SECRET', sync: false }]);
  });
});