import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RELEASE_FILES } from '../src/lib/robot/release-files';

/** Bun worker only. No env files, tokens, Git metadata or private endpoints enter this digest. */
export function sourceFingerprint() {
  const root = new URL('../', import.meta.url); const h = createHash('sha256');
  for (const path of [...RELEASE_FILES].sort()) { h.update(path); h.update('\0'); h.update(readFileSync(fileURLToPath(new URL(path, root)))); h.update('\0'); }
  return h.digest('hex');
}