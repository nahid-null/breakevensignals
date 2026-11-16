import { describe, expect, it } from 'vitest';
import { CLOUD_SETUP, WORKER_SETUP, setupCopyText } from '@/lib/setup-reference';

describe('safe setup reference', () => {
  it('copies the actual published website address for Railway', () => {
    const entry = WORKER_SETUP.find((row) => row.name === 'ENGINE_APP_URL');
    expect(entry).toBeDefined();
    if (!entry) throw new Error('Missing required website address');
    expect(setupCopyText(entry, 'value')).toBe('https://breakevensignals.lovable.app');
  });

  it('allows copying the engine key name but never a private value', () => {
    const entry = WORKER_SETUP.find((row) => row.name === 'ENGINE_SHARED_SECRET');
    expect(entry).toBeDefined();
    if (!entry) throw new Error('Missing required engine key reference');
    expect(setupCopyText(entry, 'name')).toBe('ENGINE_SHARED_SECRET');
    expect(setupCopyText(entry, 'value')).toBeNull();
    expect('value' in entry).toBe(false);
  });

  it.each(['TELEGRAM_CHAT_ID', 'TELEGRAM_API_KEY', 'LOVABLE_API_KEY'])('keeps %s private and out of Railway setup', (name) => {
    const entry = CLOUD_SETUP.find((row) => row.name === name);
    expect(entry).toBeDefined();
    if (!entry) throw new Error('Missing cloud-only key reference');
    expect(setupCopyText(entry, 'name')).toBe(name);
    expect(setupCopyText(entry, 'value')).toBeNull();
    expect('value' in entry).toBe(false);
    expect(WORKER_SETUP.some((row) => row.name === name)).toBe(false);
  });
});