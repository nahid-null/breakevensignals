type SetupBase = { name: string; note: string };
export type SetupEntry = SetupBase & (
  | { kind: 'public'; value: string }
  | { kind: 'private'; status: 'engine' | 'bot' | 'chat' }
);

export const RENDER_SETUP: readonly SetupEntry[] = [
  { name: 'ENGINE_APP_URL', kind: 'public', value: 'https://breakevensignals.lovable.app', note: 'Required in Render · website address' },
  { name: 'ENGINE_SHARED_SECRET', kind: 'private', status: 'engine', note: 'Required in Render · the same private key saved in Lovable' },
  { name: 'ENGINE_HOST_KIND', kind: 'public', value: 'hosted', note: 'Already supplied by the Render Blueprint' },
];

export const CLOUD_SETUP: readonly SetupEntry[] = [
  { name: 'TELEGRAM_CHAT_ID', kind: 'private', status: 'chat', note: 'Telegram destination · keep in Lovable only' },
  { name: 'TELEGRAM_API_KEY', kind: 'private', status: 'bot', note: 'Telegram connection · keep in Lovable only' },
  { name: 'LOVABLE_API_KEY', kind: 'private', status: 'bot', note: 'Managed connection key · keep in Lovable only' },
];

/** Private entries have no value field; copy actions can only return their names. */
export function setupCopyText(entry: SetupEntry, field: 'name' | 'value'): string | null {
  if (field === 'name') return entry.name;
  return entry.kind === 'public' ? entry.value : null;
}