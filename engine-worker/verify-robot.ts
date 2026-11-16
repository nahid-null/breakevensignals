/** Real Binance paper-worker check against an isolated local database. Never hosted writes or Telegram delivery. */
import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { RobotService } from './robot-service';
import { robotCommitSchema } from '../src/lib/robot/protocol';
import { robotOpenMessage, robotFillMessages } from '../src/lib/robot/telegram-format';

const db = new PGlite();
const instance = '22222222-2222-4222-8222-222222222222';
const secret = 'isolated-paper-verification-only';
const dir = new URL('../drizzle/migrations/', import.meta.url);
await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
for (const name of (await readdir(dir)).filter((n) => n.endsWith('.sql') && !n.startsWith('0001')).sort())
  await db.exec((await readFile(new URL(name, dir), 'utf8')).replace(/^ALTER PUBLICATION.*$/gm, ''));
// Fixture account exists ONLY inside the throwaway DB. No hosted history is touched.
await db.exec('UPDATE robot_account SET balance=20,start_balance=10,total_deposited=20;');
const heartbeat = () => db.query('select engine_heartbeat($1::jsonb)', [JSON.stringify({ instance_id: instance, status: 'RUNNING', websocket_connected: true, binance_connected: true, available_symbols: 40, scanned_symbols: 40, error: null })]);
await heartbeat(); const timer = setInterval(() => void heartbeat(), 20000);
const server = createServer(async (req,res) => {
  if(req.headers.authorization !== `Bearer ${secret}`){res.writeHead(401).end();return;}
  try {
    const chunks=[];for await(const c of req) chunks.push(c);
    const p=JSON.parse(Buffer.concat(chunks).toString()); let result: unknown;
    if(p.action==='robot-state') {
      const settings=(await db.query('select * from robot_settings where id=1')).rows[0];
      const account=(await db.query('select * from robot_account where id=1')).rows[0];
      const open=(await db.query("select * from robot_positions where status='OPEN'")).rows;
      result={settings,account,open};
    } else if(p.action==='robot-commit') {
      const d=robotCommitSchema.parse(p.data);
      const payload={...d,opens:d.opens.map((o)=>({...o,message:robotOpenMessage(o)})),updates:d.updates.map(({fills,notify,...u})=>({...u,messages:notify?robotFillMessages({...u,fills,notify}):[]}))};
      result=(await db.query<{r:unknown}>('select robot_commit_audited($1::jsonb) r',[JSON.stringify(payload)])).rows[0]?.r;
    } else throw new Error('Unexpected isolated request');
    res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(result));
  } catch(e){console.error('Isolated API:',e instanceof Error?e.message:'error');res.writeHead(500).end();}
});
await new Promise<void>((resolve)=>server.listen(0,'127.0.0.1',resolve));
const address=server.address();if(!address||typeof address==='string')throw new Error('No isolated server address');
const worker=new RobotService(`http://127.0.0.1:${address.port}`,secret,()=>instance,()=>true,()=>false);
try {
  await worker.start();
  await new Promise((resolve)=>setTimeout(resolve,Number(process.env['ROBOT_VERIFY_MS']??180000)));
  const markets=(await db.query('select symbol,status,last_candle_at,score_long,score_short,note_long,note_short from robot_market order by symbol')).rows;
  const scanner=(await db.query('select * from robot_scanner')).rows[0];
  const positions=(await db.query('select * from robot_positions order by opened_at')).rows;
  const signals=(await db.query('select symbol,direction,setup,decision,reason,candle_time from robot_signals order by candle_time')).rows;
  const messages=(await db.query('select message,delivery_status from telegram_logs')).rows;
  await mkdir('/tmp/entry-audit',{recursive:true});
  await writeFile('/tmp/entry-audit/live-paper.json',JSON.stringify({observed_at:new Date().toISOString(),scope:'Real Binance; isolated in-memory PostgreSQL; no hosted writes; Telegram messages recorded locally only, NEVER sent',markets,scanner,positions,signals,messages},null,2));
  console.log(JSON.stringify({coins:markets.length,live:markets.filter((m)=>m.status==='LIVE').length,positions:positions.length,signals:signals.length,telegram_sent:0}));
} finally {await worker.stop();clearInterval(timer);await new Promise<void>((resolve)=>server.close(()=>resolve()));await db.close();}