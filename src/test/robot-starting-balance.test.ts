// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_PAPER_BALANCE } from '../lib/robot/config';

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  const dir = new URL('../../drizzle/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter((f) => f.endsWith('.sql') && !f.startsWith('0001')).sort())
    await db.exec((await readFile(new URL(name, dir), 'utf8')).replace(/^ALTER PUBLICATION.*$/gm, ''));
}, 60000);
afterAll(async () => { await db?.close(); });

const account = async () => (await db.query<{ balance: number; start: number; deposited: number }>(
  'select balance::float8 balance, start_balance::float8 start, total_deposited::float8 deposited from robot_account where id = 1')).rows[0];

describe('paper initial capital (isolated PostgreSQL)', () => {
  it('uses the user-requested 10 USDT default in both database and website', async () => {
    expect(DEFAULT_PAPER_BALANCE).toBe(10);
    await db.exec('BEGIN; DELETE FROM robot_account WHERE id = 1; INSERT INTO robot_account(id) VALUES (1);');
    try { expect(await account()).toEqual({ balance: 10, start: 10, deposited: 10 }); }
    finally { await db.exec('ROLLBACK'); }
  });

  it('corrects unused starting funds to 10 USDT without losing a separate 10 USDT deposit or its receipt', async () => {
    await db.query('select robot_deposit(10)');
    const receipt = (await db.query('select * from robot_account_events')).rows;
    await db.query('select robot_correct_initial_balance(10)');
    expect(await account()).toEqual({ balance: 20, start: 10, deposited: 20 });
    expect((await db.query('select * from robot_account_events')).rows).toEqual(receipt);
    expect((await db.query('select amount::float8 amount, balance_before::float8 before, balance_after::float8 after from robot_capital_adjustments')).rows)
      .toEqual([{ amount: -990, before: 1010, after: 20 }]);
  });

  it('does not apply the initial allocation correction twice', async () => {
    await db.query('select robot_correct_initial_balance(10)');
    expect(await account()).toEqual({ balance: 20, start: 10, deposited: 20 });
    expect((await db.query('select count(*)::int n from robot_capital_adjustments')).rows).toEqual([{ n: 1 }]);
  });

  it('refuses to reset starting capital after any trade has been recorded', async () => {
    const before = await account();
    await db.exec(`INSERT INTO robot_positions(id, symbol, direction, status, setup, score, leverage, band, entry_price, quantity, quantity_open,
      margin, notional, stop_loss, initial_stop, tp1, tp2, liquidation_price, risk_usdt, opened_at, last_candle_time)
      VALUES ('isolated-history', 'BTCUSDT', 'LONG', 'CLOSED', 'PULLBACK', 80, 3, 'Normal', 100, 0.01, 0, 0, 1, 99, 99, 101, 102, 67, 0.01, now(), 0);`);
    await expect(db.query('select robot_correct_initial_balance(5)')).rejects.toThrow(/recorded trades/);
    expect(await account()).toEqual(before);
    expect((await db.query('select count(*)::int n from robot_positions')).rows).toEqual([{ n: 1 }]);
  });

  it('keeps capital corrections service-only and the account anon-read-only', async () => {
    await db.exec('SET ROLE anon;');
    try {
      await expect(db.query('select robot_correct_initial_balance(10)')).rejects.toThrow(/permission denied/);
      await expect(db.query('update robot_account set balance = 10 where id = 1')).rejects.toThrow(/permission denied/);
      expect(await account()).toEqual({ balance: 20, start: 10, deposited: 20 });
    } finally { await db.exec('RESET ROLE;'); }
  });
});