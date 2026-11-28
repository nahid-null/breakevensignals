// prompt-83 is a standalone historical study; it never imports or writes to the app or live systems.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { Indicator, PineTS, type ISymbolInfo } from 'pinets';
import {
  displayedSignalPrice,
  displayedSignalSide,
  fee,
  grossPnl,
  hasFreeSlot,
  isCrossLiquidated,
  marginFor,
  normalizeAggregateTimestamp,
  parseBuyerMakerFlag,
  portfolioMetrics,
  positionQuantity,
  RULES,
  resolveTimestampBatch,
  targetPrice,
  targetReachedAtPrice,
  type AggregateTrade,
  type PositionRisk,
  type Side,
} from './rules';

const PAIRS = ['SUSDT', 'ETHUSDT', 'XRPUSDT', 'LINKUSDT', 'NEARUSDT', 'BCHUSDT', 'LTCUSDT', 'ADAUSDT', 'BNBUSDT', 'DOTUSDT'] as const;
type Pair = typeof PAIRS[number];
const MINUTE = 60_000;
const TF = 30 * MINUTE;
const DAY = 24 * 60 * MINUTE;
const AS_OF = Date.UTC(2026, 10, 28, 13, 33, 0);
const WINDOW_START = AS_OF - 30 * DAY;
// The supplied TradingView screenshots match this frozen history boundary; Q-Trend's persistent ZigZag state depends on it.
const WARMUP_START = Date.UTC(2026, 0, 1, 0, 0, 0);
const WARMUP_BAR_COUNT = (Math.floor(WINDOW_START / TF) * TF - WARMUP_START) / TF;
const SPOT_API = 'https://api.binance.com';
const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(ROOT, 'data');
const REFRESH = process.argv.includes('--refresh');
const iso = (time: number) => new Date(time).toISOString().replace('.000Z', 'Z');
const round = (value: number, digits = 10) => Number(value.toFixed(digits));
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

type RawKline = unknown[];
interface SpotFilter { filterType: string; tickSize?: string; stepSize?: string; minQty?: string; minNotional?: string }
interface SpotSymbol { symbol: string; status: string; baseAsset: string; quoteAsset: string; filters: SpotFilter[] }
interface SpotExchangeInfo { serverTime: number; symbols: SpotSymbol[] }
interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }
interface FrozenSymbol { symbol: Pair; bars30: RawKline[]; bars1: RawKline[] }
interface SpotContract { symbol: Pair; tickSize: number; stepSize: number; minQty: number; minNotional: number }
interface Signal {
  id: string;
  symbol: Pair;
  side: Side;
  title: string;
  labelBarOpen: number;
  labelPrice: number;
  labelText: string;
  alertBarOpen: number;
  alertConfirmedAt: number;
  pineBarIndex: number;
}
interface Position extends PositionRisk {
  id: string;
  signalId: string;
  alertConfirmedAt: number;
  signalTitle: string;
  labelBarOpen: number;
  labelPrice: number;
  labelText: string;
  alertBarOpen: number;
  entryTime: number;
  entryFee: number;
  target: number;
}
interface ClosedTrade {
  id: string;
  signalId: string;
  symbol: Pair;
  side: Side;
  alertConfirmedAt: number;
  labelBarOpen: number;
  labelPrice: number;
  labelText: string;
  alertBarOpen: number;
  entryTime: number;
  entry: number;
  margin: number;
  notional: number;
  quantity: number;
  target: number;
  exitTime: number;
  exitPrice: number;
  gross: number;
  entryFee: number;
  exitFee: number;
  net: number;
  status: 'TARGET HIT' | 'LIQUIDATED';
  liquidationEventId: string | null;
  durationMs: number;
}
interface OpenTrade {
  id: string;
  signalId: string;
  symbol: Pair;
  side: Side;
  alertConfirmedAt: string;
  labelBarOpen: string;
  labelPrice: number;
  labelText: string;
  alertBarOpen: string;
  entryTime: string;
  entry: number;
  margin: number;
  notional: number;
  quantity: number;
  target: number;
  entryFee: number;
  lastMark: number;
  unrealizedGross: number;
  status: 'STILL OPEN';
}
interface RawAggregateTrade { a: number; p: string; q: string; T: number; m: boolean }
interface AggregateTradeWithSymbol extends AggregateTrade { symbol: Pair; id: number }
interface LiquidationEvent {
  id: string;
  time: number;
  triggerSymbols: Pair[];
  equityBefore: number;
  maintenanceMargin: number;
  availableCollateral: number;
  initialMarginReserved: number;
  maintenanceHeadroom: number;
  combinedExposure: number;
  affectedTradeIds: string[];
  targetTouchesAtSameTimestamp: string[];
  affectedPositions: { tradeId: string; symbol: Pair; side: Side; entryPrice: number; exitPrice: number; quantity: number; grossPnl: number }[];
}
interface SignalRecord extends Signal { status: 'OPENED' | 'SKIPPED'; reason: string | null }

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  let lastMessage = '';
  for (let attempt = 0; attempt < 6; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : String(error);
      await delay(400 * (attempt + 1));
      continue;
    }
    if (response.status === 451 || response.status === 418) {
      throw new Error(`Binance rejected the Spot research request (${response.status}); no alternate market-data source will be used.`);
    }
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after'));
      await delay(Math.max(1000, Number.isFinite(retryAfter) ? retryAfter * 1000 : 1500 * (attempt + 1)));
      lastMessage = 'rate limited';
      continue;
    }
    if (response.ok) return response.json();
    lastMessage = `HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`;
    if (response.status < 500) throw new Error(`${lastMessage} (${url})`);
    await delay(700 * (attempt + 1));
  }
  throw new Error(`Failed to read Binance Spot data after retries: ${lastMessage} (${url})`);
}

async function readGzip<T>(path: string): Promise<T | null> {
  if (!existsSync(path)) return null;
  return JSON.parse(gunzipSync(await readFile(path)).toString('utf8')) as T;
}

async function writeGzip(path: string, value: unknown): Promise<void> {
  await writeFile(path, gzipSync(Buffer.from(JSON.stringify(value)), { level: 9 }));
}

async function fetchKlines(symbol: Pair, interval: '1m' | '30m', start: number, end: number): Promise<RawKline[]> {
  const step = interval === '1m' ? MINUTE : TF;
  const limit = 1000;
  const result: RawKline[] = [];
  for (let from = start; from < end;) {
    const query = new URLSearchParams({ symbol, interval, limit: String(limit), startTime: String(from), endTime: String(end - 1) });
    const rows = await getJson(`${SPOT_API}/api/v3/klines?${query}`);
    if (!Array.isArray(rows)) throw new Error(`${symbol} Spot ${interval} response was not a candle list`);
    const valid = rows.filter((row): row is RawKline => Array.isArray(row) && Number(row[0]) >= from && Number(row[0]) + step <= end);
    result.push(...valid);
    if (rows.length === 0 || valid.length === 0) break;
    const lastOpen = Number(valid[valid.length - 1]?.[0]);
    if (!Number.isFinite(lastOpen) || lastOpen + step <= from) throw new Error(`${symbol} Spot ${interval} paging stopped progressing`);
    from = lastOpen + step;
    if (rows.length < limit) break;
    await delay(45);
  }
  return result;
}

async function fetchSymbol(symbol: Pair): Promise<FrozenSymbol> {
  const warmStart = WARMUP_START;
  const oneMinuteStart = Math.floor(WINDOW_START / MINUTE) * MINUTE;
  const [bars30, bars1] = await Promise.all([
    fetchKlines(symbol, '30m', warmStart, Math.floor(AS_OF / TF) * TF),
    fetchKlines(symbol, '1m', oneMinuteStart, AS_OF),
  ]);
  const frozen = { symbol, bars30, bars1 };
  await writeGzip(join(DATA_DIR, `${symbol}.spot.json.gz`), frozen);
  console.log(`${symbol}: ${bars30.length} x Spot 30m, ${bars1.length} x Spot 1m candles`);
  return frozen;
}

async function mapConcurrent<T, R>(items: readonly T[], max: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const result = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(max, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      if (item === undefined) continue;
      result[index] = await fn(item);
    }
  }));
  return result;
}

async function getDataset(): Promise<{ data: Map<Pair, FrozenSymbol>; exchange: SpotExchangeInfo }> {
  await mkdir(DATA_DIR, { recursive: true });
  const exchangePath = join(DATA_DIR, 'spot-exchange-info.json.gz');
  let exchange = REFRESH ? null : await readGzip<SpotExchangeInfo>(exchangePath);
  if (!exchange) {
    const query = new URLSearchParams({ symbols: JSON.stringify(PAIRS) });
    const response = await getJson(`${SPOT_API}/api/v3/exchangeInfo?${query}`) as SpotExchangeInfo;
    exchange = { serverTime: response.serverTime, symbols: response.symbols.filter((item) => (PAIRS as readonly string[]).includes(item.symbol)) };
    await writeGzip(exchangePath, exchange);
  }

  const loaded = new Map<Pair, FrozenSymbol>();
  let cacheComplete = !REFRESH;
  if (cacheComplete) {
    for (const pair of PAIRS) {
      const file = await readGzip<FrozenSymbol>(join(DATA_DIR, `${pair}.spot.json.gz`));
      if (!file) { cacheComplete = false; break; }
      loaded.set(pair, file);
    }
  }
  if (!cacheComplete) {
    loaded.clear();
    const downloaded = await mapConcurrent(PAIRS, 3, fetchSymbol);
    for (const file of downloaded) loaded.set(file.symbol, file);
  }

  const end30 = Math.floor(AS_OF / TF) * TF;
  const start1 = Math.floor(WINDOW_START / MINUTE) * MINUTE;
  for (const pair of PAIRS) {
    const cached = loaded.get(pair);
    if (!cached) throw new Error(`${pair}: no Spot candle cache after download`);
    const base30 = cached.bars30.filter((row) => Number(row[0]) < end30);
    const base1 = cached.bars1.filter((row) => Number(row[0]) >= start1 && Number(row[0]) < AS_OF);
    const last30 = base30.at(-1);
    const last1 = base1.at(-1);
    const missing30Start = last30 ? Number(last30[0]) + TF : WARMUP_START;
    const missing1Start = last1 ? Number(last1[0]) + MINUTE : start1;
    const [more30, more1] = await Promise.all([
      missing30Start < end30 ? fetchKlines(pair, '30m', missing30Start, end30) : Promise.resolve([] as RawKline[]),
      missing1Start < AS_OF ? fetchKlines(pair, '1m', missing1Start, AS_OF) : Promise.resolve([] as RawKline[]),
    ]);
    const updated = { symbol: pair, bars30: [...base30, ...more30], bars1: [...base1, ...more1] };
    await writeGzip(join(DATA_DIR, `${pair}.spot.json.gz`), updated);
    loaded.set(pair, updated);
  }
  return { data: loaded, exchange };
}

function asCandle(row: RawKline): Candle {
  return { time: Number(row[0]), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]) };
}

function validateData(data: Map<Pair, FrozenSymbol>, exchange: SpotExchangeInfo): string[] {
  const problems: string[] = [];
  const warmStart = WARMUP_START;
  const end30 = Math.floor(AS_OF / TF) * TF;
  const expected30 = (end30 - warmStart) / TF;
  const start1 = Math.floor(WINDOW_START / MINUTE) * MINUTE;
  const expected1 = (AS_OF - start1) / MINUTE;
  for (const pair of PAIRS) {
    const frozen = data.get(pair);
    const info = exchange.symbols.find((symbol) => symbol.symbol === pair);
    if (!frozen) { problems.push(`${pair}: no frozen candles`); continue; }
    if (!info || info.status !== 'TRADING' || info.quoteAsset !== 'USDT') problems.push(`${pair}: no active Binance Spot USDT symbol in exchangeInfo`);
    const check = (rows: RawKline[], expectedStart: number, expectedCount: number, step: number, label: string) => {
      if (rows.length !== expectedCount) problems.push(`${pair}: ${label} has ${rows.length}/${expectedCount} candles`);
      for (let index = 0; index < Math.min(rows.length, expectedCount); index++) {
        const row = rows[index];
        if (!row) { problems.push(`${pair}: ${label} missing row ${index}`); break; }
        const expected = expectedStart + index * step;
        const actual = Number(row[0]);
        if (actual !== expected) { problems.push(`${pair}: ${label} gap/duplicate at ${iso(expected)} (found ${iso(actual)})`); break; }
        for (const field of [1, 2, 3, 4]) if (!Number.isFinite(Number(row[field]))) problems.push(`${pair}: ${label} invalid OHLC at ${iso(actual)}`);
      }
    };
    check(frozen.bars30, warmStart, expected30, TF, 'Spot 30m');
    check(frozen.bars1, start1, expected1, MINUTE, 'Spot 1m');
  }
  return [...new Set(problems)];
}

function getContracts(exchange: SpotExchangeInfo): Map<Pair, SpotContract> {
  const contracts = new Map<Pair, SpotContract>();
  for (const pair of PAIRS) {
    const symbol = exchange.symbols.find((item) => item.symbol === pair);
    if (!symbol || symbol.status !== 'TRADING' || symbol.quoteAsset !== 'USDT') throw new Error(`${pair} is not an active Binance Spot USDT pair`);
    const price = symbol.filters.find((filter) => filter.filterType === 'PRICE_FILTER');
    const lot = symbol.filters.find((filter) => filter.filterType === 'LOT_SIZE');
    const notional = symbol.filters.find((filter) => filter.filterType === 'NOTIONAL' || filter.filterType === 'MIN_NOTIONAL');
    if (!price?.tickSize || !lot?.stepSize || !lot.minQty || !notional?.minNotional) throw new Error(`${pair} is missing Spot exchange filters needed for signal metadata`);
    contracts.set(pair, {
      symbol: pair,
      tickSize: Number(price.tickSize),
      stepSize: Number(lot.stepSize),
      minQty: Number(lot.minQty),
      minNotional: Number(notional.minNotional),
    });
  }
  return contracts;
}

async function pineSignals(pair: Pair, frozen: FrozenSymbol, contract: SpotContract, source: string): Promise<{ signals: Signal[]; warnings: string[] }> {
  const candles = frozen.bars30.map(asCandle);
  const bars = candles.map((candle) => ({
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    openTime: candle.time,
    closeTime: candle.time + TF - 1,
    quoteAssetVolume: 0,
    numberOfTrades: 0,
    takerBuyBaseAssetVolume: 0,
    takerBuyQuoteAssetVolume: 0,
    ignore: 0,
  }));
  const metadata = {
    ticker: pair,
    tickerid: `BINANCE:${pair}`,
    mintick: contract.tickSize,
    pricescale: Math.round(1 / contract.tickSize),
    type: 'crypto',
    timezone: 'Etc/UTC',
    session: '24x7',
    currency: 'USDT',
    basecurrency: pair.slice(0, -4),
  } as unknown as ISymbolInfo;
  const provider = { async getMarketData() { return bars; }, async getSymbolInfo() { return metadata; }, configure() {} };
  const runtime = new PineTS(provider, pair, '30', bars.length, bars[0]?.openTime, bars.at(-1)?.closeTime);
  runtime.setAlertMode('all');
  const context = await runtime.run(new Indicator(source));
  interface RuntimeLabel { id: number; x: number; text: string }
  const labelPlot = (context.plots as unknown as { __labels__?: { data?: { value: unknown }[] } }).__labels__;
  const labels = (labelPlot?.data ?? []).flatMap((bucket): RuntimeLabel[] => {
    if (!Array.isArray(bucket.value)) return [];
    return bucket.value.flatMap((value): RuntimeLabel[] => {
      if (typeof value !== 'object' || value === null) return [];
      const record = value as Record<string, unknown>;
      const id = record['id'];
      const x = record['x'];
      const text = record['text'];
      if (typeof id !== 'number' || typeof x !== 'number' || typeof text !== 'string') {
        throw new Error(`${pair}: PineTS returned an unreadable Q-Trend label object`);
      }
      return [{ id, x, text }];
    });
  }).sort((left, right) => left.id - right.id);
  const alerts = context.alerts.flatMap((alert) => {
    const title = String(alert.title ?? alert.id ?? alert.message ?? '');
    const upperTitle = title.toUpperCase();
    const side: Side | null = upperTitle.includes('BUY') ? 'LONG' : upperTitle.includes('SELL') ? 'SHORT' : null;
    const index = Number(alert.bar_index);
    const bar = bars[index];
    if (!side) return [];
    if (!bar) throw new Error(`${pair}: confirmed alert points to invalid Pine bar ${index}`);
    return [{ title, side, index, bar }];
  });
  if (labels.length !== alerts.length) {
    throw new Error(`${pair}: PineTS returned ${labels.length} plotted labels for ${alerts.length} confirmed alerts`);
  }
  const signals = alerts.flatMap((alert, ordinal): Signal[] => {
    const label = labels[ordinal];
    if (!label) throw new Error(`${pair}: missing plotted label for confirmed alert ${ordinal}`);
    const labelBar = bars[label.x];
    if (!labelBar) throw new Error(`${pair}: Q-Trend label points to invalid Pine bar ${label.x}`);
    const labelSide = displayedSignalSide(label.text);
    if (labelSide !== alert.side) throw new Error(`${pair}: plotted label direction disagrees with its confirmed alert`);
    const labelPrice = displayedSignalPrice(label.text);
    const alertConfirmedAt = alert.bar.openTime + TF;
    if (alertConfirmedAt < WINDOW_START || alertConfirmedAt >= AS_OF) return [];
    return [{
      id: `${pair}-${alertConfirmedAt}-${alert.side}-${ordinal}`,
      symbol: pair,
      side: alert.side,
      title: alert.title,
      labelBarOpen: labelBar.openTime,
      labelPrice,
      labelText: label.text,
      alertBarOpen: alert.bar.openTime,
      alertConfirmedAt,
      pineBarIndex: alert.index,
    }];
  });
  return { signals, warnings: context.warnings.map((warning) => `${pair} bar ${warning.bar}: ${warning.message}`) };
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.map(csvCell).join(','), ...rows.map((row) => row.map(csvCell).join(','))].join('\n') + '\n';
}

function markdownTable(headers: string[], rows: (string | number)[][]): string {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map((cell) => String(cell).replaceAll('|', '\\|')).join(' | ')} |`),
  ].join('\n');
}

async function downloadArchive(path: string, url: string): Promise<void> {
  if (!REFRESH && existsSync(path)) return;
  await mkdir(dirname(path), { recursive: true });
  let lastMessage = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    let response: Response;
    try { response = await fetch(url); }
    catch (error) {
      lastMessage = error instanceof Error ? error.message : String(error);
      await delay(500 * (attempt + 1));
      continue;
    }
    if (response.status === 451 || response.status === 418) throw new Error(`Binance archive access rejected (${response.status}); no alternate data source will be used.`);
    if (response.status === 429) { await delay(1500 * (attempt + 1)); lastMessage = 'rate limited'; continue; }
    if (!response.ok) throw new Error(`Binance Spot aggregate-trade archive returned HTTP ${response.status}: ${url}`);
    await writeFile(path, Buffer.from(await response.arrayBuffer()));
    return;
  }
  throw new Error(`Could not download Binance Spot aggregate-trade archive: ${lastMessage} (${url})`);
}

const dailyTradesCache = new Map<string, AggregateTradeWithSymbol[]>();
const inputArchives = new Set<string>();

function parseAggregateRows(csv: string, symbol: Pair, start: number, end: number): AggregateTradeWithSymbol[] {
  const trades: AggregateTradeWithSymbol[] = [];
  for (const line of csv.split(/\r?\n/)) {
    if (!line || line.startsWith('agg_trade_id,')) continue;
    const fields = line.split(',');
    const id = Number(fields[0]);
    const price = Number(fields[1]);
    const quantity = Number(fields[2]);
    const time = normalizeAggregateTimestamp(Number(fields[5]));
    const isBuyerMaker = parseBuyerMakerFlag(fields[6] ?? '');
    if (Number.isFinite(time) && time >= start && time < end && Number.isFinite(price) && Number.isFinite(quantity) && Number.isFinite(id)) {
      trades.push({ id, time, price, quantity, isBuyerMaker, symbol });
    }
  }
  return trades;
}

async function historicalMinuteTrades(symbol: Pair, minute: number): Promise<AggregateTradeWithSymbol[]> {
  const date = iso(minute).slice(0, 10);
  const key = `${symbol}-${date}`;
  const cached = dailyTradesCache.get(key);
  if (cached) return cached.filter((trade) => trade.time >= minute && trade.time < minute + MINUTE);
  const relativePath = `data/aggTrades/${symbol}/${symbol}-aggTrades-${date}.zip`;
  const path = join(ROOT, relativePath);
  const url = `https://data.binance.vision/data/spot/daily/aggTrades/${symbol}/${symbol}-aggTrades-${date}.zip`;
  await downloadArchive(path, url);
  const csv = execFileSync('unzip', ['-p', path], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
  const trades = parseAggregateRows(csv, symbol, Date.parse(`${date}T00:00:00Z`), Date.parse(`${date}T23:59:59.999Z`) + 1);
  if (trades.length === 0) throw new Error(`${symbol}: aggregate-trade archive had no usable trades for ${date}`);
  dailyTradesCache.set(key, trades);
  inputArchives.add(relativePath);
  return trades.filter((trade) => trade.time >= minute && trade.time < minute + MINUTE);
}

async function currentMinuteTrades(symbol: Pair, minute: number): Promise<AggregateTradeWithSymbol[]> {
  const relativePath = `data/aggTradesMinute/${symbol}-${minute}.json.gz`;
  const path = join(ROOT, relativePath);
  if (!REFRESH) {
    const cached = await readGzip<AggregateTradeWithSymbol[]>(path);
    if (cached) {
      inputArchives.add(relativePath);
      return cached;
    }
  }
  const minuteEnd = Math.min(minute + MINUTE - 1, AS_OF - 1);
  const collected: AggregateTradeWithSymbol[] = [];
  let fromId: number | null = null;
  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({ symbol, limit: '1000' });
    if (fromId === null) {
      params.set('startTime', String(minute));
      params.set('endTime', String(minuteEnd));
    } else {
      params.set('fromId', String(fromId));
    }
    const rows = await getJson(`${SPOT_API}/api/v3/aggTrades?${params}`);
    if (!Array.isArray(rows)) throw new Error(`${symbol}: Spot aggregate-trade response was not a list`);
    const pageRows = rows as RawAggregateTrade[];
    for (const row of pageRows) {
      if (row.T >= minute && row.T <= minuteEnd) {
        collected.push({ id: row.a, time: row.T, price: Number(row.p), quantity: Number(row.q), isBuyerMaker: row.m, symbol });
      }
    }
    if (pageRows.length < 1000) break;
    const last = pageRows.at(-1);
    if (!last || !Number.isFinite(last.a) || last.T >= minuteEnd) break;
    fromId = last.a + 1;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeGzip(path, collected);
  inputArchives.add(relativePath);
  return collected;
}

async function minuteAggregateTrades(symbol: Pair, minute: number): Promise<AggregateTradeWithSymbol[]> {
  const date = iso(minute).slice(0, 10);
  const currentDate = iso(AS_OF - 1).slice(0, 10);
  const trades = date === currentDate
    ? await currentMinuteTrades(symbol, minute)
    : await historicalMinuteTrades(symbol, minute);
  if (trades.length === 0) throw new Error(`${symbol}: no Spot aggregate trades were available during candidate minute ${iso(minute)}`);
  return trades;
}

function priceFor(prices: Map<string, number>, symbol: string): number {
  const value = prices.get(symbol);
  if (value === undefined || !(value > 0)) throw new Error(`Missing positive mark for ${symbol}`);
  return value;
}

async function main(): Promise<void> {
  console.log(`Loading official Binance Spot candles for ${iso(WINDOW_START)} → ${iso(AS_OF)} UTC…`);
  const { data, exchange } = await getDataset();
  const dataProblems = validateData(data, exchange);
  if (dataProblems.length) throw new Error(`Spot data validation failed; no results will be published:\n${dataProblems.join('\n')}`);
  const contracts = getContracts(exchange);
  const source = await readFile(join(ROOT, 'new-indicator.original.pine'), 'utf8');
  if (!source.includes('//@version=5') || !source.includes('Big swings (confirmed)') || !source.includes('alertcondition(sell_show or drawnSell')) {
    throw new Error('The saved new Pine source does not match the attached Q-Trend v5 confirmed-alert script.');
  }

  const candles1 = new Map<Pair, Map<number, Candle>>();
  const candles30 = new Map<Pair, Candle[]>();
  const signals: Signal[] = [];
  const pineWarnings: string[] = [];
  for (const pair of PAIRS) {
    const frozen = data.get(pair);
    const contract = contracts.get(pair);
    if (!frozen || !contract) throw new Error(`${pair}: missing Spot candles or exchange filters`);
    candles1.set(pair, new Map(frozen.bars1.map((row) => { const candle = asCandle(row); return [candle.time, candle]; })));
    candles30.set(pair, frozen.bars30.map(asCandle));
    const result = await pineSignals(pair, frozen, contract, source);
    signals.push(...result.signals);
    pineWarnings.push(...result.warnings);
    console.log(`${pair}: ${result.signals.length} confirmed Q-Trend alerts; ${result.warnings.length} Pine interpreter warnings`);
  }
  const pairOrder = new Map(PAIRS.map((pair, index) => [pair, index] as const));
  signals.sort((left, right) => left.alertConfirmedAt - right.alertConfirmedAt
    || (pairOrder.get(left.symbol) ?? 0) - (pairOrder.get(right.symbol) ?? 0)
    || left.pineBarIndex - right.pineBarIndex);
  const signalsAt = new Map<number, Signal[]>();
  for (const signal of signals) signalsAt.set(signal.alertConfirmedAt, [...(signalsAt.get(signal.alertConfirmedAt) ?? []), signal]);

  let mainBalance = RULES.startingBalance;
  const positions: Position[] = [];
  const closed: ClosedTrade[] = [];
  const skipped: { signalId: string; symbol: Pair; side: Side; time: number; reason: string }[] = [];
  const signalRecords = new Map<string, SignalRecord>();
  const liquidationEvents: LiquidationEvent[] = [];
  const targetTouchTimes = new Map<string, number>();
  const prices = new Map<string, number>();
  const equityHistory: { time: number; equity: number }[] = [];
  let entryFeesPaid = 0;
  let targetExitFeesPaid = 0;
  let liquidationFeesPaid = 0;
  let maxSlotsUsed = 0;
  let positionSequence = 0;

  const closeAtTarget = (position: Position, time: number) => {
    const index = positions.findIndex((item) => item.id === position.id);
    if (index < 0) return;
    const exitPrice = position.target;
    const gross = grossPnl(position.side, position.entry, exitPrice, position.quantity);
    const expectedTargetGross = RULES.targetMarginMultiple * position.margin;
    if (Math.abs(gross - expectedTargetGross) > Math.max(1e-10, Math.abs(expectedTargetGross) * 1e-10)) {
      throw new Error(`${position.id}: target gross PnL ${gross} does not equal 200% of initial margin ${expectedTargetGross}`);
    }
    const exitFee = fee(position.quantity * exitPrice);
    mainBalance += gross - exitFee;
    targetExitFeesPaid += exitFee;
    closed.push({
      id: position.id,
      signalId: position.signalId,
      symbol: position.symbol as Pair,
      side: position.side,
      alertConfirmedAt: position.alertConfirmedAt,
      labelBarOpen: position.labelBarOpen,
      labelPrice: position.labelPrice,
      labelText: position.labelText,
      alertBarOpen: position.alertBarOpen,
      entryTime: position.entryTime,
      entry: position.entry,
      margin: position.margin,
      notional: position.quantity * position.entry,
      quantity: position.quantity,
      target: position.target,
      exitTime: time,
      exitPrice,
      gross,
      entryFee: position.entryFee,
      exitFee,
      net: gross - position.entryFee - exitFee,
      status: 'TARGET HIT',
      liquidationEventId: null,
      durationMs: time - position.entryTime,
    });
    positions.splice(index, 1);
  };

  const closeCrossLiquidation = (time: number, triggerSymbols: Pair[], targetTouchesAtSameTimestamp: string[]) => {
    if (positions.length === 0) return;
    const targetAlreadyReached = positions.find((position) => {
      const targetTime = targetTouchTimes.get(position.id);
      return targetTime !== undefined && targetTime < time;
    });
    if (targetAlreadyReached) {
      throw new Error(`Refusing false liquidation: ${targetAlreadyReached.id} reached its target before ${iso(time)}`);
    }
    const riskRows: PositionRisk[] = positions;
    const before = portfolioMetrics(mainBalance, riskRows, prices);
    const eventId = `Q84-L${String(liquidationEvents.length + 1).padStart(3, '0')}`;
    const affectedTradeIds = positions.map((position) => position.id);
    const affectedPositions = positions.map((position) => ({
      tradeId: position.id,
      symbol: position.symbol,
      side: position.side,
      entryPrice: position.entry,
      exitPrice: priceFor(prices, position.symbol),
      quantity: position.quantity,
      grossPnl: grossPnl(position.side, position.entry, priceFor(prices, position.symbol), position.quantity),
    }));
    liquidationEvents.push({
      id: eventId,
      time,
      triggerSymbols: [...new Set(triggerSymbols)],
      equityBefore: before.equity,
      maintenanceMargin: before.maintenanceMargin,
      availableCollateral: before.sharedAvailableCollateral,
      initialMarginReserved: before.initialMarginReserved,
      maintenanceHeadroom: before.maintenanceHeadroom,
      combinedExposure: sum(positions.map((position) => position.quantity * priceFor(prices, position.symbol))),
      affectedTradeIds,
      targetTouchesAtSameTimestamp: [...targetTouchesAtSameTimestamp],
      affectedPositions,
    });
    for (const position of [...positions]) {
      const exitPrice = priceFor(prices, position.symbol);
      const gross = grossPnl(position.side, position.entry, exitPrice, position.quantity);
      const exitFee = fee(position.quantity * exitPrice);
      mainBalance += gross - exitFee;
      liquidationFeesPaid += exitFee;
      closed.push({
        id: position.id,
        signalId: position.signalId,
        symbol: position.symbol as Pair,
        side: position.side,
        alertConfirmedAt: position.alertConfirmedAt,
        labelBarOpen: position.labelBarOpen,
        labelPrice: position.labelPrice,
        labelText: position.labelText,
        alertBarOpen: position.alertBarOpen,
        entryTime: position.entryTime,
        entry: position.entry,
        margin: position.margin,
        notional: position.quantity * position.entry,
        quantity: position.quantity,
        target: position.target,
        exitTime: time,
        exitPrice,
        gross,
        entryFee: position.entryFee,
        exitFee,
        net: gross - position.entryFee - exitFee,
        status: 'LIQUIDATED',
        liquidationEventId: eventId,
        durationMs: time - position.entryTime,
      });
      const index = positions.findIndex((item) => item.id === position.id);
      if (index >= 0) positions.splice(index, 1);
    }
  };

  const openSignals = (time: number, marketCandles: Map<Pair, Candle>) => {
    for (const signal of signalsAt.get(time) ?? []) {
      const market = marketCandles.get(signal.symbol);
      if (!market) throw new Error(`${signal.symbol}: missing Spot 1m entry candle at ${iso(time)}`);
      if (!hasFreeSlot(positions.length)) {
        skipped.push({ signalId: signal.id, symbol: signal.symbol, side: signal.side, time, reason: 'All six trade slots were occupied at the signal entry time' });
        signalRecords.set(signal.id, { ...signal, status: 'SKIPPED', reason: 'All six trade slots were occupied at the signal entry time' });
        continue;
      }
      if (!(mainBalance > 0)) {
        skipped.push({ signalId: signal.id, symbol: signal.symbol, side: signal.side, time, reason: 'Main balance was not positive' });
        signalRecords.set(signal.id, { ...signal, status: 'SKIPPED', reason: 'Main balance was not positive' });
        continue;
      }
      const margin = marginFor(mainBalance);
      const quantity = positionQuantity(margin, market.open);
      const notional = quantity * market.open;
      const entryFee = fee(notional);
      const currentMarks = new Map(prices);
      for (const active of positions) {
        const activeCandle = marketCandles.get(active.symbol);
        if (!activeCandle) throw new Error(`${active.symbol}: missing collateral mark at ${iso(time)}`);
        currentMarks.set(active.symbol, activeCandle.open);
      }
      currentMarks.set(signal.symbol, market.open);
      const availableCollateral = positions.length
        ? portfolioMetrics(mainBalance, positions, currentMarks).sharedAvailableCollateral
        : mainBalance;
      if (availableCollateral < margin + entryFee) {
        const reason = 'Insufficient shared account equity after open-position losses and initial margin allocations';
        skipped.push({ signalId: signal.id, symbol: signal.symbol, side: signal.side, time, reason });
        signalRecords.set(signal.id, { ...signal, status: 'SKIPPED', reason });
        continue;
      }
      positionSequence++;
      const id = `Q84-${String(positionSequence).padStart(4, '0')}`;
      const position: Position = {
        id,
        signalId: signal.id,
        symbol: signal.symbol,
        side: signal.side,
        alertConfirmedAt: signal.alertConfirmedAt,
        signalTitle: signal.title,
        labelBarOpen: signal.labelBarOpen,
        labelPrice: signal.labelPrice,
        labelText: signal.labelText,
        alertBarOpen: signal.alertBarOpen,
        entryTime: time,
        entry: market.open,
        margin,
        quantity,
        entryFee,
        target: targetPrice(signal.side, market.open, margin, quantity),
      };
      mainBalance -= entryFee;
      entryFeesPaid += entryFee;
      positions.push(position);
      prices.set(signal.symbol, market.open);
      signalRecords.set(signal.id, { ...signal, status: 'OPENED', reason: null });
      maxSlotsUsed = Math.max(maxSlotsUsed, positions.length);
    }
  };

  const exactCandidateMinute = async (time: number, marketCandles: Map<Pair, Candle>) => {
    const symbols = [...new Set(positions.map((position) => position.symbol))];
    const pages = await Promise.all(symbols.map((symbol) => minuteAggregateTrades(symbol, time)));
    const events = pages.flat().sort((left, right) => left.time - right.time
      || (pairOrder.get(left.symbol) ?? 0) - (pairOrder.get(right.symbol) ?? 0)
      || left.id - right.id);
    if (events.length === 0) throw new Error(`No Spot aggregate-trade sequence found for candidate minute ${iso(time)}`);

    for (const position of positions) {
      const candle = marketCandles.get(position.symbol);
      if (!candle) throw new Error(`${position.symbol}: missing candle for target/tape reconciliation at ${iso(time)}`);
      const candleTouches = position.side === 'LONG' ? candle.high >= position.target : candle.low <= position.target;
      const tapeTouches = events.some((event) => event.symbol === position.symbol
        && event.time >= position.entryTime
        && targetReachedAtPrice(position.side, position.target, event));
      if (candleTouches && !tapeTouches) {
        throw new Error(`${position.id}: 1m Spot candle touched target ${position.target}, but no matching aggregate-trade price was returned at ${iso(time)}`);
      }
    }

    let index = 0;
    while (index < events.length && positions.length > 0) {
      const eventTime = events[index]?.time;
      if (eventTime === undefined) break;
      const group: AggregateTradeWithSymbol[] = [];
      while (index < events.length && events[index]?.time === eventTime) {
        const event = events[index];
        if (event) group.push(event);
        index++;
      }
      const resolution = resolveTimestampBatch(mainBalance, positions, prices, group);
      for (const [symbol, price] of resolution.prices) prices.set(symbol, price);
      for (const tradeId of resolution.targetTradeIds) targetTouchTimes.set(tradeId, eventTime);
      if (resolution.liquidated) {
        closeCrossLiquidation(eventTime, group.map((event) => event.symbol), resolution.targetTradeIds);
        break;
      }
      for (const tradeId of resolution.targetTradeIds) {
        const position = positions.find((item) => item.id === tradeId);
        if (position) closeAtTarget(position, eventTime);
      }
    }
    for (const position of positions) {
      const candle = marketCandles.get(position.symbol);
      if (!candle) throw new Error(`${position.symbol}: missing candle after detailed execution at ${iso(time)}`);
      prices.set(position.symbol, candle.close);
    }
  };

  const firstMinute = Math.floor(WINDOW_START / MINUTE) * MINUTE;
  for (let time = firstMinute; time < AS_OF; time += MINUTE) {
    const marketCandles = new Map<Pair, Candle>();
    for (const pair of PAIRS) {
      const candle = candles1.get(pair)?.get(time);
      if (!candle) throw new Error(`${pair}: missing Spot 1m candle at ${iso(time)}`);
      marketCandles.set(pair, candle);
    }

    openSignals(time, marketCandles);
    if (positions.length > 0) {
      const openPrices = new Map(prices);
      for (const position of positions) {
        const candle = marketCandles.get(position.symbol);
        if (!candle) throw new Error(`${position.symbol}: missing opening mark at ${iso(time)}`);
        openPrices.set(position.symbol, candle.open);
      }
      const openMetrics = portfolioMetrics(mainBalance, positions, openPrices);
      let candidate = isCrossLiquidated(openMetrics);
      let targetTouched = false;
      for (const position of positions) {
        const candle = marketCandles.get(position.symbol);
        if (!candle) throw new Error(`${position.symbol}: missing execution candle at ${iso(time)}`);
        if (position.side === 'LONG' ? candle.high >= position.target : candle.low <= position.target) targetTouched = true;
      }
      const adversePrices = new Map(openPrices);
      for (const position of positions) {
        const candle = marketCandles.get(position.symbol);
        if (!candle) throw new Error(`${position.symbol}: missing adverse mark at ${iso(time)}`);
        adversePrices.set(position.symbol, position.side === 'LONG' ? candle.low : candle.high);
      }
      const adverseMetrics = portfolioMetrics(mainBalance, positions, adversePrices);
      candidate = candidate || isCrossLiquidated(adverseMetrics) || targetTouched;
      if (candidate) {
        await exactCandidateMinute(time, marketCandles);
      } else {
        for (const position of positions) {
          const candle = marketCandles.get(position.symbol);
          if (!candle) throw new Error(`${position.symbol}: missing close mark at ${iso(time)}`);
          prices.set(position.symbol, candle.close);
        }
      }
    }

    if (positions.length > 0) {
      const metrics = portfolioMetrics(mainBalance, positions, prices);
      equityHistory.push({ time: time + MINUTE, equity: metrics.equity });
    } else {
      equityHistory.push({ time: time + MINUTE, equity: mainBalance });
    }
  }

  const endMetrics = portfolioMetrics(mainBalance, positions, prices);
  const openTrades: OpenTrade[] = positions.map((position) => {
    const mark = priceFor(prices, position.symbol);
    return {
      id: position.id,
      signalId: position.signalId,
      symbol: position.symbol,
      side: position.side,
      alertConfirmedAt: iso(position.alertConfirmedAt),
      labelBarOpen: iso(position.labelBarOpen),
      labelPrice: position.labelPrice,
      labelText: position.labelText,
      alertBarOpen: iso(position.alertBarOpen),
      entryTime: iso(position.entryTime),
      entry: position.entry,
      margin: position.margin,
      notional: position.quantity * position.entry,
      quantity: position.quantity,
      target: position.target,
      entryFee: position.entryFee,
      lastMark: mark,
      unrealizedGross: grossPnl(position.side, position.entry, mark, position.quantity),
      status: 'STILL OPEN',
    };
  });
  const stillOpenTradeDetails = positions.map((position) => ({ position, mark: priceFor(prices, position.symbol) }));
  const totalEntryFees = entryFeesPaid;
  const totalExitFees = targetExitFeesPaid + liquidationFeesPaid;
  const totalFees = totalEntryFees + totalExitFees;
  const grossClosed = sum(closed.map((trade) => trade.gross));
  const grossProfit = sum(closed.map((trade) => Math.max(0, trade.gross)));
  const grossLoss = sum(closed.map((trade) => Math.min(0, trade.gross)));
  const realizedNet = sum(closed.map((trade) => trade.net));
  const openUnrealizedGross = sum(stillOpenTradeDetails.map(({ position, mark }) => grossPnl(position.side, position.entry, mark, position.quantity)));
  const markedEquity = mainBalance + openUnrealizedGross;
  const targetTrades = closed.filter((trade) => trade.status === 'TARGET HIT');
  const liquidatedTrades = closed.filter((trade) => trade.status === 'LIQUIDATED');
  const profitable = closed.filter((trade) => trade.net > 0);
  const earlierTargetLiquidations = liquidatedTrades.filter((trade) => {
    const touchedAt = targetTouchTimes.get(trade.id);
    return touchedAt !== undefined && touchedAt < trade.exitTime;
  });
  if (earlierTargetLiquidations.length > 0) {
    throw new Error(`Liquidation audit failed: ${earlierTargetLiquidations.map((trade) => trade.id).join(', ')} had a prior target-price trade`);
  }
  const liquidationTargetAudit = {
    liquidatedPositions: liquidatedTrades.length,
    priorTargetTouches: earlierTargetLiquidations.length,
    sameTimestampTargetTouches: liquidatedTrades.filter((trade) => targetTouchTimes.get(trade.id) === trade.exitTime).length,
    allLiquidationsFreeOfEarlierTargetTouches: earlierTargetLiquidations.length === 0,
  };
  const targetDurations = targetTrades.map((trade) => trade.durationMs);
  const sortedDurations = [...targetDurations].sort((left, right) => left - right);
  const fastest = targetTrades.reduce<ClosedTrade | null>((best, trade) => !best || trade.durationMs < best.durationMs ? trade : best, null);
  const slowest = targetTrades.reduce<ClosedTrade | null>((best, trade) => !best || trade.durationMs > best.durationMs ? trade : best, null);
  const averageTargetMs = targetDurations.length ? sum(targetDurations) / targetDurations.length : null;
  const medianTargetMs = sortedDurations.length
    ? sortedDurations.length % 2 === 1
      ? sortedDurations[Math.floor(sortedDurations.length / 2)] ?? null
      : ((sortedDurations[sortedDurations.length / 2 - 1] ?? 0) + (sortedDurations[sortedDurations.length / 2] ?? 0)) / 2
    : null;
  let peakEquity = RULES.startingBalance;
  let maxDrawdown = 0;
  let lowestEquity = RULES.startingBalance;
  for (const point of equityHistory) {
    peakEquity = Math.max(peakEquity, point.equity);
    lowestEquity = Math.min(lowestEquity, point.equity);
    if (peakEquity > 0) maxDrawdown = Math.max(maxDrawdown, (peakEquity - point.equity) / peakEquity);
  }

  const perCoin = PAIRS.map((symbol) => {
    const coinSignals = signals.filter((signal) => signal.symbol === symbol);
    const coinClosed = closed.filter((trade) => trade.symbol === symbol);
    const coinOpen = stillOpenTradeDetails.filter(({ position }) => position.symbol === symbol);
    const coinNet = sum(coinClosed.map((trade) => trade.net)) + sum(coinOpen.map(({ position, mark }) => grossPnl(position.side, position.entry, mark, position.quantity) - position.entryFee));
    const coinTargetDurations = coinClosed.filter((trade) => trade.status === 'TARGET HIT').map((trade) => trade.durationMs);
    return {
      symbol,
      signals: coinSignals.length,
      longSignals: coinSignals.filter((signal) => signal.side === 'LONG').length,
      shortSignals: coinSignals.filter((signal) => signal.side === 'SHORT').length,
      opened: coinSignals.filter((signal) => signalRecords.get(signal.id)?.status === 'OPENED').length,
      completed: coinClosed.length,
      targetCompleted: coinClosed.filter((trade) => trade.status === 'TARGET HIT').length,
      profitable: coinClosed.filter((trade) => trade.net > 0).length,
      liquidated: coinClosed.filter((trade) => trade.status === 'LIQUIDATED').length,
      stillOpen: coinOpen.length,
      netPnlIncludingOpenMark: coinNet,
      averageTargetMs: coinTargetDurations.length ? sum(coinTargetDurations) / coinTargetDurations.length : null,
    };
  });
  const rankedCoins = [...perCoin].sort((left, right) => right.netPnlIncludingOpenMark - left.netPnlIncludingOpenMark);
  const signalsWithRecords = signals.map((signal) => signalRecords.get(signal.id) ?? { ...signal, status: 'SKIPPED' as const, reason: 'No entry decision was recorded' });
  const expectedBalance = RULES.startingBalance + realizedNet - sum(openTrades.map((trade) => trade.entryFee));
  if (Math.abs(expectedBalance - mainBalance) > 1e-7) throw new Error(`Wallet ledger does not reconcile: ${expectedBalance} != ${mainBalance}`);
  if (positions.length > RULES.maxSlots) throw new Error(`Slot limit exceeded: ${positions.length}`);

  const screenshotReferenceLabels: { symbol: Pair; side: Side; price: number; labelText: string }[] = [
    { symbol: 'XRPUSDT', side: 'LONG', price: 1.1473, labelText: 'STRONG BUY\n1.1473' },
  ];
  const screenshotParity = screenshotReferenceLabels.map((reference) => {
    const matches = signals.filter((signal) => signal.symbol === reference.symbol
      && signal.side === reference.side && signal.labelPrice === reference.price);
    const sameDirectionSignals = signals.filter((signal) => signal.symbol === reference.symbol && signal.side === reference.side);
    const nearest = sameDirectionSignals.reduce<Signal | null>((best, signal) => (
      !best || Math.abs(signal.labelPrice - reference.price) < Math.abs(best.labelPrice - reference.price) ? signal : best
    ), null);
    const signal = matches[0] ?? nearest;
    const closedTrade = signal ? closed.find((trade) => trade.signalId === signal.id) : undefined;
    const openTrade = signal ? openTrades.find((trade) => trade.signalId === signal.id) : undefined;
    return {
      symbol: reference.symbol,
      side: reference.side,
      expectedLabelText: reference.labelText,
      expectedPrice: reference.price,
      exactMatchCount: matches.length,
      actualLabelText: signal?.labelText ?? null,
      labelBarOpen: signal ? iso(signal.labelBarOpen) : null,
      labelPrice: signal?.labelPrice ?? null,
      alertBarOpen: signal ? iso(signal.alertBarOpen) : null,
      alertConfirmedAt: signal ? iso(signal.alertConfirmedAt) : null,
      entryTime: closedTrade ? iso(closedTrade.entryTime) : openTrade?.entryTime ?? null,
      entryPrice: closedTrade?.entry ?? openTrade?.entry ?? null,
      entryStatus: signal ? signalRecords.get(signal.id)?.status ?? 'SKIPPED' : 'NO CANDIDATE',
    };
  });

  const hashes: Record<string, string> = {};
  const sortedInputArchives = [...inputArchives].sort();
  const inputPaths = [
    'new-indicator.original.pine',
    'plan.txt',
    'evidence/new-indicator-screenshot.png',
    'data/spot-exchange-info.json.gz',
    ...PAIRS.map((pair) => `data/${pair}.spot.json.gz`),
    ...sortedInputArchives,
  ];
  for (const path of inputPaths) hashes[path] = createHash('sha256').update(await readFile(join(ROOT, path))).digest('hex');

  const summary = {
    signalCount: signals.length,
    longSignals: signals.filter((signal) => signal.side === 'LONG').length,
    shortSignals: signals.filter((signal) => signal.side === 'SHORT').length,
    tradesOpened: signalsWithRecords.filter((signal) => signal.status === 'OPENED').length,
    completedTrades: targetTrades.length + liquidatedTrades.length,
    targetCompleted: targetTrades.length,
    profitableClosedTrades: profitable.length,
    liquidatedTrades: liquidatedTrades.length,
    liquidationEvents: liquidationEvents.length,
    stillOpen: openTrades.length,
    skippedSignalsAllSlotsFull: skipped.filter((item) => item.reason.includes('six trade slots')).length,
    skippedSignalsOther: skipped.filter((item) => !item.reason.includes('six trade slots')).length,
    grossRealizedPnl: grossClosed,
    grossProfit,
    grossLoss,
    entryFees: totalEntryFees,
    targetExitFees: targetExitFeesPaid,
    liquidationExitFees: liquidationFeesPaid,
    totalFees,
    realizedNetPnl: realizedNet,
    initialMainBalance: RULES.startingBalance,
    finalMainBalance: mainBalance,
    realizedReturnPct: (mainBalance / RULES.startingBalance - 1) * 100,
    openUnrealizedGross,
    markedEquity,
    markedReturnPct: (markedEquity / RULES.startingBalance - 1) * 100,
    netProfitIncludingOpenMark: markedEquity - RULES.startingBalance,
    maxDrawdownPct: maxDrawdown * 100,
    lowestAccountEquity: lowestEquity,
    endingMaintenanceMargin: endMetrics.maintenanceMargin,
    endingSharedAvailableCollateral: endMetrics.sharedAvailableCollateral,
    endingMaintenanceHeadroom: endMetrics.maintenanceHeadroom,
    maxSlotsUsed,
    fastestTargetDurationMs: fastest?.durationMs ?? null,
    slowestTargetDurationMs: slowest?.durationMs ?? null,
    averageTargetDurationMs: averageTargetMs,
    medianTargetDurationMs: medianTargetMs,
    targetWithin30m: targetTrades.filter((trade) => trade.durationMs <= 30 * MINUTE).length,
    targetWithin1h: targetTrades.filter((trade) => trade.durationMs <= 60 * MINUTE).length,
    targetWithin4h: targetTrades.filter((trade) => trade.durationMs <= 4 * 60 * MINUTE).length,
    targetWithin12h: targetTrades.filter((trade) => trade.durationMs <= 12 * 60 * MINUTE).length,
    targetWithin24h: targetTrades.filter((trade) => trade.durationMs <= DAY).length,
  };

  const result = {
    reportTitle: 'Q-Trend ZigZag Big Swings v9 — 30-day Binance Spot price research with synthetic 75x cross margin',
    researchOnly: true,
    window: { start: iso(WINDOW_START), end: iso(AS_OF), timezone: 'UTC', latestClosed30m: iso(Math.floor(AS_OF / TF) * TF), latestClosed1m: iso(AS_OF - MINUTE) },
    rules: {
      indicator: 'The newly attached Q-Trend ZigZag Big Swings v9 Pine v5 file, unchanged; exact source and screenshot hashes are listed in inputHashes.',
      inputs: 'Pine defaults unchanged: close, trend period 300, ATR 20, multiplier 2.2, Type A, no EMA smoothing, Big swings (confirmed), normal and strong Buy/Sell accepted, 10% swing, 20-bar signal tolerance, 7% minimum run, and the new 3% maximum adverse move before that run.',
      signalTiming: 'The label timestamp and tick-formatted close price are recorded separately from the later confirmed-alert candle and executable entry. A trade enters at the first Binance Spot 1m open at alert confirmation; it is never backdated to the label.',
      historyBoundary: `Indicator state is history-start-sensitive. The study uses ${WARMUP_BAR_COUNT} complete 30m warmup candles from ${iso(WARMUP_START)}. This fixed boundary is not changed to force the screenshot label to match.`,
      symbols: PAIRS,
      startingBalance: RULES.startingBalance,
      maxSlots: RULES.maxSlots,
      marginRate: RULES.marginRate,
      leverage: RULES.leverage,
      targetGrossPnlMultiple: RULES.targetMarginMultiple,
      targetDefinition: 'Target gross PnL is 200% of the initial allocated margin, before fees; it never changes after entry.',
      accountModel: 'Synthetic portfolio cross margin: all wallet equity and unrealized PnL support every open position; simultaneous positions share one maintenance test, and a breach closes every open position at observed Spot prices.',
      maintenanceAssumption: `Because Binance Spot does not offer 75x cross margin, the study uses an explicitly synthetic fixed maintenance rate of ${RULES.syntheticMaintenanceRate * 100}% of each open position's marked notional. This is a research assumption, not a Binance Spot or Futures rule.`,
      feeAssumption: `Baseline Binance Spot fee assumption is ${RULES.baselineSpotFeeRate * 100}% of notional per side for entry, target and forced exits; no user-specific VIP/BNB discount is assumed.`,
      noBorrowCost: 'No borrowing interest is modeled; these are synthetic leveraged positions, not actual Binance margin-account loans.',
      exits: 'Only target completion or account-level cross liquidation closes positions. Opposite signals, time, stop, trailing, and manual exits are not used.',
      fillAssumptions: 'Entry at next 1m Spot candle open. A target is reached on the first actual Spot aggregate-trade price at or through its fixed target; the full synthetic position closes at the target price. No aggressor-side or aggregate-volume gate is applied, and queue priority cannot be reconstructed.',
      ambiguityHandling: '1m OHLC screens possible exit minutes, but each target touch must be confirmed by an actual Spot aggregate-trade price or the run aborts. Candidate minutes use timestamp-ordered Spot aggregate trades for every open symbol. A cross-maintenance breach takes precedence over a target touch in the same millisecond; every liquidation is audited to ensure no earlier target touch occurred.',
      quantityModel: 'Continuous synthetic quantity = allocated margin × 75 / entry price. Spot LOT_SIZE and minimum-notional constraints are not imposed because the requested account is not an actual Spot order or margin account.',
    },
    data: {
      source: 'Official Binance Spot public API: 30m klines for confirmed signal calculation, 1m klines for entries/range screening/cutoff marks, and official Spot aggregate-trade archives/API for target-price evidence and event order.',
      exchangeInfoServerTime: iso(exchange.serverTime),
      warmupStart: iso(WARMUP_START),
      warmupBars: WARMUP_BAR_COUNT,
      expected30mBarsPerPair: (Math.floor(AS_OF / TF) * TF - WARMUP_START) / TF,
      expected1mBarsPerPair: (AS_OF - Math.floor(WINDOW_START / MINUTE) * MINUTE) / MINUTE,
      missingData: [],
      pineInterpreter: 'Local PineTS 0.13.1 on the intact Pine v5 source, including its actual backdated label drawings; the screenshot label is compared with the closest same-direction XRP label without altering source inputs. This is not independent certification against a TradingView alert export.',
      warnings: pineWarnings,
      inputHashes: hashes,
      detailedTradeInputs: sortedInputArchives,
    },
    summary,
    liquidationTargetAudit,
    fastestTarget: fastest,
    slowestTarget: slowest,
    perCoin,
    coinRankingByNetIncludingOpenMark: rankedCoins.map((coin, index) => ({ rank: index + 1, ...coin })),
    liquidationEvents: liquidationEvents.map((event) => ({ ...event, time: iso(event.time) })),
    screenshotParity,
    signals: signalsWithRecords.map((signal) => ({
      ...signal,
      labelBarOpen: iso(signal.labelBarOpen),
      alertBarOpen: iso(signal.alertBarOpen),
      alertConfirmedAt: iso(signal.alertConfirmedAt),
    })),
    skipped,
    trades: [
      ...closed.map((trade) => ({
        ...trade,
        targetGrossPnl: RULES.targetMarginMultiple * trade.margin,
        labelBarOpen: iso(trade.labelBarOpen),
        alertBarOpen: iso(trade.alertBarOpen),
        alertConfirmedAt: iso(trade.alertConfirmedAt),
        entryTime: iso(trade.entryTime),
        exitTime: iso(trade.exitTime),
      })),
      ...openTrades.map((trade) => ({ ...trade, targetGrossPnl: RULES.targetMarginMultiple * trade.margin, status: 'STILL OPEN' as const })),
    ],
    accountEquitySeries: equityHistory,
  };
  await writeFile(join(ROOT, 'result.json'), JSON.stringify(result, null, 2));

  const tradeRows = [
    ...closed.map((trade) => [
      trade.id, trade.symbol, trade.side, iso(trade.labelBarOpen), trade.labelPrice, trade.labelText,
      iso(trade.alertBarOpen), iso(trade.alertConfirmedAt), iso(trade.entryTime), trade.entry,
      trade.margin, trade.notional, RULES.leverage, trade.target, RULES.targetMarginMultiple * trade.margin, iso(trade.exitTime), trade.exitPrice,
      trade.gross, trade.entryFee, trade.exitFee, trade.net, trade.durationMs, trade.status, trade.liquidationEventId,
    ]),
    ...openTrades.map((trade) => [
      trade.id, trade.symbol, trade.side, trade.labelBarOpen, trade.labelPrice, trade.labelText,
      trade.alertBarOpen, trade.alertConfirmedAt, trade.entryTime, trade.entry,
      trade.margin, trade.notional, RULES.leverage, trade.target, RULES.targetMarginMultiple * trade.margin, '', trade.lastMark,
      trade.unrealizedGross, trade.entryFee, 0, trade.unrealizedGross - trade.entryFee, '', trade.status, '',
    ]),
  ];
  await writeFile(join(ROOT, 'trades.csv'), toCsv([
    'trade_id', 'coin', 'side', 'label_bar_open_utc', 'label_display_price', 'label_text', 'alert_bar_open_utc',
    'alert_confirmed_at_utc', 'entry_time_utc', 'entry_price', 'allocated_margin_usdt',
    'position_notional_usdt', 'leverage', 'target_price', 'target_gross_profit_usdt', 'exit_time_utc', 'exit_price', 'gross_pnl_usdt',
    'entry_fee_usdt', 'exit_fee_usdt', 'net_pnl_usdt', 'duration_ms', 'status', 'liquidation_event_id',
  ], tradeRows));
  await writeFile(join(ROOT, 'signals.csv'), toCsv(
    ['signal_id', 'coin', 'side', 'signal_title', 'label_bar_open_utc', 'label_display_price', 'label_text', 'alert_bar_open_utc', 'alert_confirmed_at_utc', 'entry_status', 'skip_reason'],
    signalsWithRecords.map((signal) => [signal.id, signal.symbol, signal.side, signal.title, iso(signal.labelBarOpen), signal.labelPrice, signal.labelText, iso(signal.alertBarOpen), iso(signal.alertConfirmedAt), signal.status, signal.reason]),
  ));

  const money = (value: number) => `${value < 0 ? '-$' : '$'}${Math.abs(value).toFixed(4)}`;
  const percent = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  const duration = (milliseconds: number | null) => milliseconds === null ? 'N/A' : `${(milliseconds / 1000).toFixed(3)} seconds`;
  const targetFastLine = fastest
    ? `${fastest.symbol} ${fastest.side}: ${iso(fastest.entryTime)} at ${fastest.entry.toPrecision(10)} → ${iso(fastest.exitTime)} at ${fastest.exitPrice.toPrecision(10)} (${duration(fastest.durationMs)})`
    : 'No 200% target was reached.';
  const targetSlowLine = slowest
    ? `${slowest.symbol} ${slowest.side}: ${iso(slowest.entryTime)} at ${slowest.entry.toPrecision(10)} → ${iso(slowest.exitTime)} at ${slowest.exitPrice.toPrecision(10)} (${duration(slowest.durationMs)})`
    : 'No 200% target was reached.';
  const coinRows = rankedCoins.map((coin, index) => [
    index + 1, coin.symbol, coin.signals, coin.longSignals, coin.shortSignals, coin.opened, coin.completed, coin.targetCompleted,
    coin.profitable, coin.liquidated, coin.stillOpen, money(coin.netPnlIncludingOpenMark),
    coin.averageTargetMs === null ? 'N/A' : duration(coin.averageTargetMs),
  ]);
  const liquidationRows = liquidationEvents.map((event) => [
    event.id, iso(event.time), event.triggerSymbols.join(', '), money(event.equityBefore),
    money(event.availableCollateral), money(event.initialMarginReserved), money(event.combinedExposure),
    money(event.maintenanceMargin), money(event.maintenanceHeadroom),
    event.affectedPositions.map((position) => `${position.tradeId} ${position.symbol} ${position.side}`).join('; '),
    event.targetTouchesAtSameTimestamp.join(', ') || 'None',
  ]);
  const targetRows = targetTrades.map((trade) => [
    trade.id, trade.symbol, trade.side, iso(trade.entryTime), trade.entry.toPrecision(10), trade.margin,
    RULES.targetMarginMultiple * trade.margin, iso(trade.exitTime),
    trade.exitPrice.toPrecision(10), duration(trade.durationMs), money(trade.gross), money(trade.entryFee + trade.exitFee), money(trade.net),
  ]);
  const screenshotParityRows = screenshotParity.map((row) => [
    row.symbol,
    row.side,
    row.expectedLabelText.replaceAll('\n', ' '),
    row.actualLabelText?.replaceAll('\n', ' ') ?? 'No same-direction signal',
    row.exactMatchCount === 1 ? 'YES' : 'NO',
    row.labelBarOpen ?? '—',
    row.alertConfirmedAt ?? '—',
    row.entryTime ?? 'Not opened',
    row.entryPrice === null ? 'Not opened' : row.entryPrice,
  ]);
  const screenshotParitySummary = screenshotParity.map((row) => row.exactMatchCount === 1
    ? `Exact screenshot label matched: ${row.expectedLabelText.replaceAll('\n', ' ')}`
    : `NO EXACT MATCH: expected ${row.expectedLabelText.replaceAll('\n', ' ')}; nearest same-direction source label was ${row.actualLabelText?.replaceAll('\n', ' ') ?? 'none'} at ${row.labelBarOpen ?? 'no signal time'}`)
    .join('; ');

  const report = `# Q-Trend ZigZag Big Swings v9 — 30-day Binance Spot price research

**Research only.** No website, live Simulator, account settings, trade history, Telegram, worker, database, or deployment was changed.

## Window and outcome

- **Window:** ${iso(WINDOW_START)} to ${iso(AS_OF)} UTC, using only Binance Spot prices.
- **Signals:** ${summary.signalCount} (${summary.longSignals} LONG, ${summary.shortSignals} SHORT).
- **Opened:** ${summary.tradesOpened}; **completed:** ${summary.completedTrades}; **target completed:** ${summary.targetCompleted}; **profitable closed:** ${summary.profitableClosedTrades}; **liquidated positions:** ${summary.liquidatedTrades}; **open at cutoff:** ${summary.stillOpen}.
- **Skipped because all six slots were full:** ${summary.skippedSignalsAllSlotsFull}; **other skipped:** ${summary.skippedSignalsOther}.
- **Gross winning PnL:** ${money(summary.grossProfit)}; **gross losing PnL:** ${money(summary.grossLoss)}; **all modeled fees:** ${money(summary.totalFees)} (entry ${money(summary.entryFees)}, target exits ${money(summary.targetExitFees)}, liquidation exits ${money(summary.liquidationExitFees)}).
- **Net realized change:** ${money(summary.finalMainBalance - RULES.startingBalance)}; **final main balance:** ${money(summary.finalMainBalance)} (${percent(summary.realizedReturnPct)}).
- **Open unrealized gross PnL:** ${money(summary.openUnrealizedGross)}; **marked account equity:** ${money(summary.markedEquity)} (${percent(summary.markedReturnPct)} return including open positions).
- **Maximum marked-equity drawdown:** ${summary.maxDrawdownPct.toFixed(2)}%; **lowest minute-close equity:** ${money(summary.lowestAccountEquity)}; **maximum slots used:** ${summary.maxSlotsUsed}/6.
- **At cutoff:** shared available collateral ${money(summary.endingSharedAvailableCollateral)}; maintenance requirement ${money(summary.endingMaintenanceMargin)}; maintenance headroom ${money(summary.endingMaintenanceHeadroom)}.

## Attached screenshot signal and executable entry

${screenshotParitySummary}. The backdated label time and display price are recorded separately from the later confirmed alert and 1m entry; entries occur only once confirmation is knowable.

${markdownTable(['Coin', 'Side', 'Expected label', 'Closest source label', 'Exact match', 'Label candle UTC', 'Alert confirmed UTC', 'Entry UTC', 'Entry price'], screenshotParityRows)}

**History boundary:** the replay uses ${WARMUP_BAR_COUNT.toLocaleString()} warmup 30m candles beginning ${iso(WARMUP_START)}. Q-Trend's state depends on the start of loaded chart history, so exact TradingView alerts beyond the screenshot-visible signal cannot be independently certified without an exported TradingView alert list.

## Target completion times

- **Fastest:** ${targetFastLine}
- **Slowest:** ${targetSlowLine}
- **Average:** ${duration(summary.averageTargetDurationMs)}; **median:** ${duration(summary.medianTargetDurationMs)}.
- **Targets completed within:** 30 minutes ${summary.targetWithin30m}; 1 hour ${summary.targetWithin1h}; 4 hours ${summary.targetWithin4h}; 12 hours ${summary.targetWithin12h}; 24 hours ${summary.targetWithin24h}.

${markdownTable(['Trade', 'Coin', 'Side', 'Entry UTC', 'Entry price', 'Initial margin', 'Target gross profit', 'Target UTC', 'Target price', 'Duration', 'Gross PnL', 'Fees', 'Net PnL'], targetRows)}

## Coin-wise results

Coins are ranked by closed net result plus open gross mark-to-market less entry fees; open positions are shown separately in the ledger.

${markdownTable(['Rank', 'Coin', 'Signals', 'LONG', 'SHORT', 'Opened', 'Completed', 'Target hit', 'Profitable closed', 'Liquidated', 'Open', 'Net incl. open mark', 'Avg. target time'], coinRows)}

## Cross-margin liquidation review

- **Account-level liquidation events:** ${liquidationEvents.length}; every event closes all positions open at the breach, rather than liquidating each position in isolation.
- **Synthetic maintenance requirement:** ${RULES.syntheticMaintenanceRate * 100}% of total marked open notional. This is an explicit modeling assumption because Binance Spot does not offer 75x cross margin; it is not an exchange rule.
- **Shared available collateral** below means account equity less the open positions' allocated initial margin; maintenance headroom is equity less the synthetic maintenance requirement. The account-level liquidation test uses all wallet equity and all open-position unrealized PnL as shared support.

${liquidationRows.length ? markdownTable(['Event', 'UTC', 'Trigger symbol(s)', 'Equity before', 'Shared available collateral', 'Initial margin reserved', 'Combined exposure', 'Maintenance', 'Maintenance headroom', 'Affected positions', 'Target touched at same timestamp'], liquidationRows) : 'No account-level maintenance breach occurred.'}

**Target/liquidation audit:** ${liquidationTargetAudit.liquidatedPositions} positions were liquidated; ${liquidationTargetAudit.priorTargetTouches} had an earlier target-price trade; ${liquidationTargetAudit.sameTimestampTargetTouches} had a target trade in the same millisecond as the account breach. Earlier target touches are a hard failure; same-millisecond order remains conservative because Spot data cannot establish which event came first.

## Method and limitations

- The newly attached Pine v5 source was preserved unchanged. PineTS ran its confirmed Big Swings alerts on Binance Spot 30m candles with ${WARMUP_BAR_COUNT.toLocaleString()} warmup bars from ${iso(WARMUP_START)}. The actual backdated label bar and displayed close price are recorded, but never used as the executable entry.
- Entry occurs at the first 1m Spot candle open at the alert confirmation time. Quantity is continuous synthetic exposure: 5% of then-current main balance × 75 ÷ entry price. No actual Spot order, Futures price, exchange leverage tier, or minimum-order filter is used.
- A target is fixed at gross profit equal to 200% of the initial entry margin, before fees. Any actual Spot aggregate-trade price at or through the target triggers a full synthetic close at the target; the prior backtest's aggressor-direction and volume gates are intentionally removed. Actual queue priority and personal account fills cannot be reconstructed.
- Baseline Spot fees are 0.10% per side; personal discounts are unknown. No borrowing interest is charged because the 75x position is synthetic, not a Binance Margin loan. No spread/slippage is invented.
- 1m candles screen for possible exits. Every candidate minute is resolved by time-ordered official Spot aggregate trades for all open symbols; a candle wick without supporting trade-price evidence aborts the run. At the same millisecond, a cross-maintenance breach is checked before target fills. A runtime invariant rejects any liquidation after an earlier target-price trade.
- Cross margin is modeled portfolio-wide: equity is wallet balance plus all unrealized PnL; maintenance is the stated synthetic rate over combined marked notional. When breached, every open position is closed at the latest observed Spot prices. The chosen maintenance rate and lack of an actual 75x Spot product mean this is a reproducible scenario, not an exchange-certified liquidation model.
- The screenshot-visible label is compared with the exact text, direction, and price produced by the attached Pine source and frozen Binance Spot candles; any mismatch is shown rather than tuned away. This local PineTS comparison is not independent TradingView-exported verification. Candle coverage and all input hashes are retained with the result.

## Reproducibility

- Complete trade ledger: trades.csv; all confirmed signals and skipped outcomes: signals.csv; machine-readable details, equity series, per-coin ranking, liquidation events, and the target/liquidation audit: result.json.
- Input source hashes and detailed aggregate-trade archive list are in result.json. Frozen candles are under data/ and may be rechecked with bun research/prompt-84/backtest.ts.
`;
  await writeFile(join(ROOT, 'report.md'), report);
  console.log(`Done: ${summary.signalCount} signals, ${summary.tradesOpened} opened, ${summary.targetCompleted} targets, ${summary.liquidationEvents} cross-margin liquidation events; ending balance ${money(summary.finalMainBalance)}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});