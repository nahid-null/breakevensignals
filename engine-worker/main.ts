import { SignalService } from './service';

const observe = process.argv.includes('--observe');
const url = process.env['ENGINE_APP_URL'];
const secret = process.env['ENGINE_SHARED_SECRET'];
if (!observe && (!url || !secret)) throw new Error('Set ENGINE_APP_URL and ENGINE_SHARED_SECRET in the worker hosting settings');
if (url && !url.startsWith('https://') && !url.startsWith('http://localhost:')) throw new Error('Engine app URL must use HTTPS');
const service = new SignalService((url ?? '').replace(/\/$/, ''), secret ?? '', observe);
for (const event of ['SIGINT', 'SIGTERM'] as const) process.on(event, () => { void service.stop().then(() => process.exit(0)); });
await service.start();