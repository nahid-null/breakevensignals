// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  const dir = new URL('../../drizzle/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter((f) => f.endsWith('.sql') && !f.startsWith('0001')).sort())
    await db.exec((await readFile(new URL(name, dir), 'utf8')).replace(/^ALTER PUBLICATION.*$/gm, ''));
}, 60000);
afterAll(async () => { await db?.close(); });

const tables = async () => (await db.query<{ t: string }>(
  "select tablename t from pg_tables where schemaname = 'public' order by 1")).rows.map((r) => r.t);

describe('private dashboard data (isolated PostgreSQL)', () => {
  it('no public table is readable by browser roles', async () => {
    const list = await tables();
    expect(list).toContain('robot_positions');
    for (const role of ['anon', 'authenticated']) {
      const r = await db.query<{ t: string }>(`select c.relname t from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege('${role}', c.oid, 'SELECT')`);
      expect(r.rows).toEqual([]);
    }
  });
  it('no table keeps an open read rule', async () => {
    expect((await db.query("select policyname from pg_policies where schemaname = 'public' and cmd = 'SELECT'")).rows).toEqual([]);
  });
  it('browser roles cannot read trades, Telegram history or statistics', async () => {
    await db.exec('SET ROLE anon;');
    try {
      await expect(db.query('select * from robot_positions')).rejects.toThrow(/permission denied/);
      await expect(db.query('select * from telegram_logs')).rejects.toThrow(/permission denied/);
      await expect(db.query('select terminal_statistics()')).rejects.toThrow(/permission denied/);
    } finally { await db.exec('RESET ROLE;'); }
  });
  it('the server role still reads everything', async () => {
    await db.exec('SET ROLE service_role;');
    try { for (const t of await tables()) await db.query(`select count(*) from public.${t}`); }
    finally { await db.exec('RESET ROLE;'); }
  });
});
