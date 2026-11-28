// prompt-82: isolated historical research only. This never imports the live Simulator or writes to Lovable Cloud.
// Re-run with --refresh to download the same fixed 30-day window again from official Binance USD-M endpoints.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { Indicator, PineTS, type ISymbolInfo } from 'pinets';
import { firstTargetFill, grossAtPrice, hasFreeSlot, marginFor, RULES, targetPrice, type AggregateTrade, type Side } from './rules';

const PAIRS = ['SUSDT', 'ETHUSDT', 'XRPUSDT', 'LINKUSDT', 'NEARUSDT', 'BCHUSDT', 'LTCUSDT', 'ADAUSDT', 'BNBUSDT', 'DOTUSDT'] as const;
type Pair = typeof PAIRS[number];
const MINUTE = 60_000;
const TF = 30 * MINUTE;
const DAY = 24 * 60 * MINUTE;
const AS_OF = Date.UTC(2026, 10, 28, 11, 39, 0); // last user-message time; all times UTC
const WINDOW_START = AS_OF - 30 * DAY;
const WARMUP_BARS = 1_500;
const TAKER_FEE = 0.0005;
const MAKER_FEE = 0.0002;
const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(ROOT, 'data');
const refresh = process.argv.includes('--refresh');
const iso = (t: number) => new Date(t).toISOString().replace('.000Z', 'Z');
const round = (x: number, n = 8) => Number(x.toFixed(n));
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

type RawKline = unknown[];
interface RawFunding { symbol: string; fundingTime: number; fundingRate: string; markPrice: string; rateType?: string }
interface FrozenSymbol { symbol: Pair; bars30: RawKline[]; last1: RawKline[]; mark1: RawKline[]; funding: RawFunding[] }
interface FuturesSymbol { symbol: string; status: string; contractType: string; baseAsset: string; quoteAsset: string; quantityPrecision: number; pricePrecision: number; filters: Record<string, unknown>[] }
interface ExchangeInfo { serverTime: number; symbols: FuturesSymbol[] }
interface RiskBracket { bracketSeq: number; bracketNotionalFloor: number; bracketNotionalCap: number; bracketMaintenanceMarginRate: number; cumFastMaintenanceAmount: number; minOpenPosLeverage: number; maxOpenPosLeverage: number }
interface BracketSymbol { symbol: string; updateTime: number; riskBrackets: RiskBracket[] }
interface Brackets { code: string; data: { brackets: BracketSymbol[] } }
interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }
interface Contract { symbol: Pair; stepSize: number; minQty: number; minNotional: number; tickSize: number; quantityPrecision: number; tiers: RiskBracket[] }
interface Signal { id: string; symbol: Pair; side: Side; type: string; confirmedAt: number; alertBarOpen: number; pineBarIndex: number }
interface Position {
  id: string; signalId: string; symbol: Pair; side: Side; entryTime: number; entry: number; quantity: number;
  requestedMargin: number; margin: number; entryFee: number; fundingNet: number; target: number; liquidation: number;
  mmr: number; cumMaintenance: number; liquidationTriggerTime: number | null;
}
interface ClosedTrade {
  id: string; signalId: string; symbol: Pair; side: Side; entryTime: number; entry: number; quantity: number;
  requestedMargin: number; margin: number; entryFee: number; fundingNet: number; target: number;
  closeTime: number; closeMinuteEnd: number; closeKind: 'TARGET' | 'LIQUIDATION'; exitPrice: number | null;
  liquidationTrigger: number | null; targetTradePrice: number | null; targetTradeQuantity: number | null;
  executionTimeSource: 'BINANCE_AGG_TRADES' | 'BINANCE_1M_OHLC' | 'BINANCE_MARK_1M';
  exitFee: number; gross: number | null; net: number; durationLowMs: number;
  durationHighMs: number; mainAfter: number;
}

function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  let lastMessage = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    let response: Response;
    try { response = await fetch(url, init); }
    catch (error) { lastMessage = error instanceof Error ? error.message : String(error); await delay(500 * (attempt + 1)); continue; }
    if (response.status === 451 || response.status === 418) throw new Error(`Binance rejected the research request (${response.status}); no alternate data endpoint will be tried.`);
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after'));
      await delay(Math.max(1000, Number.isFinite(retryAfter) ? retryAfter * 1000 : 2000 * (attempt + 1)));
      lastMessage = 'rate limited';
      continue;
    }
    if (response.ok) return response.json();
    lastMessage = `HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`;
    if (response.status < 500) throw new Error(`${lastMessage} (${url})`);
    await delay(800 * (attempt + 1));
  }
  throw new Error(`Failed to read Binance data after retries: ${lastMessage} (${url})`);
}

async function readGzip<T>(path: string): Promise<T | null> {
  if (!existsSync(path)) return null;
  return JSON.parse(gunzipSync(await readFile(path)).toString('utf8')) as T;
}

async function writeGzip(path: string, value: unknown): Promise<void> {
  await writeFile(path, gzipSync(Buffer.from(JSON.stringify(value)), { level: 9 }));
}

async function fetchKlines(base: string, endpoint: string, symbol: Pair, interval: '1m' | '30m', start: number, end: number): Promise<RawKline[]> {
  const step = interval === '1m' ? MINUTE : TF;
  const limit = 1500;
  const result: RawKline[] = [];
  for (let from = start; from < end;) {
    const query = new URLSearchParams({ symbol, interval, limit: String(limit), startTime: String(from), endTime: String(end - 1) });
    const rows = await getJson(`${base}${endpoint}?${query}`);
    if (!Array.isArray(rows)) throw new Error(`${symbol} ${interval} response was not a candle list`);
    const valid = rows.filter((row): row is RawKline => Array.isArray(row) && Number(row[0]) >= from && Number(row[0]) + step <= end);
    result.push(...valid);
    if (rows.length === 0 || valid.length === 0) break;
    const lastOpen = Number(valid[valid.length - 1]?.[0]);
    if (!Number.isFinite(lastOpen) || lastOpen + step <= from) throw new Error(`${symbol} ${interval} paging stopped progressing`);
    from = lastOpen + step;
    if (rows.length < limit) break;
    await delay(80);
  }
  return result;
}

async function fetchFunding(symbol: Pair): Promise<RawFunding[]> {
  const result: RawFunding[] = [];
  for (let from = WINDOW_START; from < AS_OF;) {
    const query = new URLSearchParams({ symbol, startTime: String(from), endTime: String(AS_OF - 1), limit: '1000' });
    const rows = await getJson(`https://fapi.binance.com/fapi/v1/fundingRate?${query}`);
    if (!Array.isArray(rows)) throw new Error(`${symbol} funding response was not a list`);
    const valid = rows.filter((row): row is RawFunding => typeof row === 'object' && row !== null && Number((row as RawFunding).fundingTime) >= from && Number((row as RawFunding).fundingTime) < AS_OF);
    result.push(...valid);
    if (rows.length < 1000 || valid.length === 0) break;
    from = Number(valid[valid.length - 1]?.fundingTime) + 1;
    await delay(80);
  }
  return result;
}

async function fetchFrozenSymbol(symbol: Pair): Promise<FrozenSymbol> {
  const warmStart = Math.floor(WINDOW_START / TF) * TF - WARMUP_BARS * TF;
  const data: FrozenSymbol = {
    symbol,
    bars30: await fetchKlines('https://fapi.binance.com', '/fapi/v1/klines', symbol, '30m', warmStart, AS_OF),
    last1: await fetchKlines('https://fapi.binance.com', '/fapi/v1/klines', symbol, '1m', WINDOW_START, AS_OF),
    mark1: await fetchKlines('https://fapi.binance.com', '/fapi/v1/markPriceKlines', symbol, '1m', WINDOW_START, AS_OF),
    funding: await fetchFunding(symbol),
  };
  await writeGzip(join(DATA_DIR, `${symbol}.json.gz`), data);
  console.log(`${symbol}: fetched ${data.bars30.length} x 30m, ${data.last1.length} x last-price 1m, ${data.mark1.length} x mark 1m, ${data.funding.length} funding events`);
  return data;
}

async function mapConcurrent<T, R>(items: readonly T[], max: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(max, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      if (item === undefined) continue;
      output[index] = await fn(item);
    }
  }));
  return output;
}

async function getDataset(): Promise<{ data: Map<Pair, FrozenSymbol>; exchange: ExchangeInfo; brackets: Brackets }> {
  await mkdir(DATA_DIR, { recursive: true });
  const exchangePath = join(DATA_DIR, 'exchange-info.json.gz');
  const bracketsPath = join(DATA_DIR, 'risk-brackets.json.gz');
  let exchange = !refresh ? await readGzip<ExchangeInfo>(exchangePath) : null;
  let brackets = !refresh ? await readGzip<Brackets>(bracketsPath) : null;
  if (!exchange) {
    const response = await getJson('https://fapi.binance.com/fapi/v1/exchangeInfo') as ExchangeInfo;
    exchange = { serverTime: response.serverTime, symbols: response.symbols.filter((s) => (PAIRS as readonly string[]).includes(s.symbol)) };
    await writeGzip(exchangePath, exchange);
  }
  if (!brackets) {
    const response = await getJson('https://www.binance.com/bapi/futures/v1/friendly/future/common/brackets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }) as Brackets;
    brackets = { ...response, data: { ...response.data, brackets: response.data.brackets.filter((b) => (PAIRS as readonly string[]).includes(b.symbol)) } };
    await writeGzip(bracketsPath, brackets);
  }
  const loaded = new Map<Pair, FrozenSymbol>();
  let allCached = !refresh;
  if (allCached) for (const pair of PAIRS) if (!existsSync(join(DATA_DIR, `${pair}.json.gz`))) allCached = false;
  if (allCached) {
    for (const pair of PAIRS) {
      const file = await readGzip<FrozenSymbol>(join(DATA_DIR, `${pair}.json.gz`));
      if (!file) { allCached = false; break; }
      loaded.set(pair, file);
    }
  }
  if (!allCached) {
    loaded.clear();
    const downloaded = await mapConcurrent(PAIRS, 2, fetchFrozenSymbol);
    for (const file of downloaded) loaded.set(file.symbol, file);
  }
  return { data: loaded, exchange, brackets };
}

function asCandle(row: RawKline): Candle {
  return { time: Number(row[0]), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]) };
}

function validateData(data: Map<Pair, FrozenSymbol>): string[] {
  const problems: string[] = [];
  const warmStart = Math.floor(WINDOW_START / TF) * TF - WARMUP_BARS * TF;
  const end30 = Math.floor(AS_OF / TF) * TF;
  const expected30 = (end30 - warmStart) / TF;
  const expected1 = (AS_OF - WINDOW_START) / MINUTE;
  for (const pair of PAIRS) {
    const frozen = data.get(pair);
    if (!frozen) { problems.push(`${pair}: no frozen data`); continue; }
    const check = (rows: RawKline[], expectedStart: number, expectedCount: number, step: number, label: string) => {
      if (rows.length !== expectedCount) problems.push(`${pair}: ${label} has ${rows.length}/${expectedCount} bars`);
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row) { problems.push(`${pair}: ${label} missing row ${i}`); break; }
        const expected = expectedStart + i * step;
        const actual = Number(row[0]);
        if (actual !== expected) { problems.push(`${pair}: ${label} gap/duplicate at ${iso(expected)} (found ${iso(actual)})`); break; }
        for (const field of [1, 2, 3, 4]) if (!Number.isFinite(Number(row[field]))) problems.push(`${pair}: ${label} invalid OHLC at ${iso(actual)}`);
      }
    };
    check(frozen.bars30, warmStart, expected30, TF, '30m');
    check(frozen.last1, WINDOW_START, expected1, MINUTE, 'last-price 1m');
    check(frozen.mark1, WINDOW_START, expected1, MINUTE, 'mark-price 1m');
    const times = frozen.funding.map((f) => Number(f.fundingTime));
    if (new Set(times).size !== times.length) problems.push(`${pair}: duplicate funding timestamps`);
    if (frozen.funding.some((f) => !Number.isFinite(Number(f.fundingRate)) || !Number.isFinite(Number(f.markPrice)))) problems.push(`${pair}: invalid funding rate/mark price`);
  }
  return [...new Set(problems)];
}

function contractFor(pair: Pair, exchange: ExchangeInfo, brackets: Brackets): Contract {
  const symbol = exchange.symbols.find((s) => s.symbol === pair);
  const risk = brackets.data.brackets.find((b) => b.symbol === pair);
  if (!symbol || symbol.status !== 'TRADING' || symbol.contractType !== 'PERPETUAL' || symbol.quoteAsset !== 'USDT' || !risk) throw new Error(`${pair} is not an active USDⓈ-M perpetual with published risk brackets`);
  const filter = (kind: string) => symbol.filters.find((f) => f.filterType === kind);
  const lot = filter('MARKET_LOT_SIZE') ?? filter('LOT_SIZE');
  const price = filter('PRICE_FILTER');
  const min = filter('MIN_NOTIONAL') ?? filter('NOTIONAL');
  if (!lot || !price || !min) throw new Error(`${pair} lacks market lot, price tick or minimum-notional filters`);
  return {
    symbol: pair,
    stepSize: Number(lot.stepSize),
    minQty: Number(lot.minQty),
    minNotional: Number(min.notional ?? min.minNotional),
    tickSize: Number(price.tickSize),
    quantityPrecision: symbol.quantityPrecision,
    tiers: risk.riskBrackets,
  };
}

async function pineSignals(pair: Pair, frozen: FrozenSymbol, contract: Contract, pineSource: string): Promise<{ signals: Signal[]; warnings: string[] }> {
  const candles = frozen.bars30.map(asCandle);
  const bars = candles.map((c) => ({
    open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
    openTime: c.time, closeTime: c.time + TF - 1, quoteAssetVolume: 0, numberOfTrades: 0,
    takerBuyBaseAssetVolume: 0, takerBuyQuoteAssetVolume: 0, ignore: 0,
  }));
  const metadata = {
    ticker: pair, tickerid: `BINANCE:${pair}`, mintick: contract.tickSize,
    pricescale: Math.round(1 / contract.tickSize), type: 'crypto', timezone: 'Etc/UTC',
    session: '24x7', currency: 'USDT', basecurrency: pair.slice(0, -4),
  } as unknown as ISymbolInfo;
  const provider = { async getMarketData() { return bars; }, async getSymbolInfo() { return metadata; }, configure() {} };
  const runtime = new PineTS(provider, pair, '30', bars.length, bars[0]?.openTime, bars.at(-1)?.closeTime);
  runtime.setAlertMode('all');
  const context = await runtime.run(new Indicator(pineSource));
  const signals: Signal[] = [];
  for (const [ordinal, alert] of context.alerts.entries()) {
    const title = String(alert.title ?? alert.id ?? alert.message ?? '');
    const side: Side | null = title.toUpperCase().includes('BUY') ? 'LONG' : title.toUpperCase().includes('SELL') ? 'SHORT' : null;
    const index = Number(alert.bar_index);
    const bar = bars[index];
    if (!side || !bar) continue;
    const confirmedAt = bar.openTime + TF;
    if (confirmedAt < WINDOW_START || confirmedAt >= AS_OF) continue;
    signals.push({ id: `${pair}-${confirmedAt}-${side}-${ordinal}`, symbol: pair, side, type: title, confirmedAt, alertBarOpen: bar.openTime, pineBarIndex: index });
  }
  return { signals, warnings: context.warnings.map((w) => `${pair} bar ${w.bar}: ${w.message}`) };
}

function parseContractFilters(exchange: ExchangeInfo, brackets: Brackets): Map<Pair, Contract> {
  return new Map(PAIRS.map((pair) => [pair, contractFor(pair, exchange, brackets)]));
}

function floorStep(quantity: number, stepSize: number, precision: number): number {
  const units = Math.floor(quantity / stepSize + 1e-10);
  return Number((units * stepSize).toFixed(precision));
}

function matchingTier(contract: Contract, notional: number): RiskBracket | undefined {
  return contract.tiers.find((tier) => notional >= tier.bracketNotionalFloor && notional <= tier.bracketNotionalCap);
}

function liquidationPrice(position: Position): number {
  const isolatedWallet = position.margin + position.fundingNet;
  const q = position.quantity;
  const e = position.entry;
  const maintenanceAdjustment = position.cumMaintenance;
  const raw = position.side === 'LONG'
    ? (q * e - isolatedWallet - maintenanceAdjustment) / (q * (1 - position.mmr))
    : (q * e + isolatedWallet + maintenanceAdjustment) / (q * (1 + position.mmr));
  return raw;
}

function isLiquidatedAt(position: Position, markPrice: number): boolean {
  const equity = position.margin + position.fundingNet + grossAtPrice(position.side, position.entry, markPrice, position.quantity);
  const maintenance = position.quantity * markPrice * position.mmr - position.cumMaintenance;
  return equity <= maintenance;
}

function durationLabel(ms: number): string {
  const totalMilliseconds = Math.max(0, Math.round(ms));
  const totalSeconds = Math.floor(totalMilliseconds / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const milliseconds = totalMilliseconds % 1000;
  const secondsLabel = `${seconds}${milliseconds ? `.${String(milliseconds).padStart(3, '0')}` : ''}s`;
  return [days ? `${days}d` : '', hours ? `${hours}h` : '', minutes ? `${minutes}m` : '', seconds || milliseconds || (!days && !hours && !minutes) ? secondsLabel : ''].filter(Boolean).join(' ');
}

function durationRange(trade: ClosedTrade): string {
  const low = durationLabel(trade.durationLowMs);
  const high = durationLabel(trade.durationHighMs);
  return low === high ? low : `${low}–${high}`;
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function markdownTable(headers: string[], rows: (string | number)[][]): string {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map((cell) => String(cell).replaceAll('|', '\\|')).join(' | ')} |`),
  ].join('\n');
}

async function loadAggregateTrades(pair: Pair, date: string): Promise<{ rows: AggregateTrade[]; relativePath: string }> {
  const relativePath = `data/aggTrades/${pair}/${pair}-aggTrades-${date}.zip`;
  const path = join(ROOT, relativePath);
  await mkdir(dirname(path), { recursive: true });
  if (refresh || !existsSync(path)) {
    const url = `https://data.binance.vision/data/futures/um/daily/aggTrades/${pair}/${pair}-aggTrades-${date}.zip`;
    let response: Response | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try { response = await fetch(url); }
      catch { await delay(500 * (attempt + 1)); continue; }
      if (response.status === 451 || response.status === 418) throw new Error(`Binance rejected aggregate-trade archive access (${response.status}); no alternate source will be tried.`);
      if (response.status === 429) { await delay(2000 * (attempt + 1)); continue; }
      if (!response.ok) throw new Error(`Binance aggregate-trade archive failed with HTTP ${response.status}: ${url}`);
      break;
    }
    if (!response?.ok) throw new Error(`Could not download Binance aggregate-trade archive: ${url}`);
    await writeFile(path, Buffer.from(await response.arrayBuffer()));
  }
  const csv = execFileSync('unzip', ['-p', path], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  const lines = csv.split(/\r?\n/);
  const rows: AggregateTrade[] = [];
  for (const line of lines) {
    if (!line || line.startsWith('agg_trade_id,')) continue;
    const fields = line.split(',');
    const time = Number(fields[5]);
    const price = Number(fields[1]);
    const quantity = Number(fields[2]);
    const makerFlag = fields[6];
    if (Number.isFinite(time) && Number.isFinite(price) && Number.isFinite(quantity) && (makerFlag === 'true' || makerFlag === 'false')) {
      rows.push({ time, price, quantity, isBuyerMaker: makerFlag === 'true' });
    }
  }
  if (!rows.length) throw new Error(`Binance aggregate-trade archive had no usable trades: ${relativePath}`);
  return { rows, relativePath };
}

async function main(): Promise<void> {
  console.log(`Loading official Binance USDⓈ-M candles for ${iso(WINDOW_START)} → ${iso(AS_OF)} (UTC)…`);
  const { data, exchange, brackets } = await getDataset();
  const dataProblems = validateData(data);
  if (dataProblems.length) throw new Error(`Data validation failed; no results will be published:\n${dataProblems.join('\n')}`);
  for (const pair of PAIRS) contractFor(pair, exchange, brackets);
  const source = await readFile(join(ROOT, 'Q-Trend_zigzag_v8.original.pine'), 'utf8');
  if (!source.includes('//@version=5') || !source.includes('Big swings (confirmed)') || !source.includes('alertcondition(sell_show or drawnSell')) throw new Error('The saved original Pine source does not match the expected Q-Trend v5 confirmed-alert script.');

  const contracts = parseContractFilters(exchange, brackets);
  const signals: Signal[] = [];
  const pineWarnings: string[] = [];
  for (const pair of PAIRS) {
    const frozen = data.get(pair);
    const contract = contracts.get(pair);
    if (!frozen || !contract) throw new Error(`${pair} data or contract filters are missing`);
    const result = await pineSignals(pair, frozen, contract, source);
    signals.push(...result.signals);
    pineWarnings.push(...result.warnings);
    console.log(`${pair}: ${result.signals.length} confirmed Q-Trend alerts in the 30-day window; ${result.warnings.length} interpreter warnings`);
  }
  const pairOrder = new Map(PAIRS.map((pair, i) => [pair, i]));
  signals.sort((a, b) => a.confirmedAt - b.confirmedAt || (pairOrder.get(a.symbol) ?? 0) - (pairOrder.get(b.symbol) ?? 0) || a.pineBarIndex - b.pineBarIndex);

  const last1 = new Map<Pair, Map<number, Candle>>();
  const mark1 = new Map<Pair, Map<number, Candle>>();
  const fundingAt = new Map<number, { symbol: Pair; rate: number; mark: number }[]>();
  for (const pair of PAIRS) {
    const frozen = data.get(pair);
    if (!frozen) throw new Error(`No frozen candles for ${pair}`);
    last1.set(pair, new Map(frozen.last1.map((row) => { const c = asCandle(row); return [c.time, c]; })));
    mark1.set(pair, new Map(frozen.mark1.map((row) => { const c = asCandle(row); return [c.time, c]; })));
    for (const event of frozen.funding) {
      const time = Number(event.fundingTime);
      const list = fundingAt.get(time) ?? [];
      list.push({ symbol: pair, rate: Number(event.fundingRate), mark: Number(event.markPrice) });
      fundingAt.set(time, list);
    }
  }
  const signalAt = new Map<number, Signal[]>();
  for (const signal of signals) signalAt.set(signal.confirmedAt, [...(signalAt.get(signal.confirmedAt) ?? []), signal]);

  let mainBalance = RULES.startingBalance;
  const positions: Position[] = [];
  const closed: ClosedTrade[] = [];
  const opened: { signal: Signal; entryTime: number; entry: number; quantity: number; requestedMargin: number; margin: number; entryFee: number; target: number; liquidation: number }[] = [];
  const skipped: { signalId: string; symbol: Pair; side: Side; time: number; reason: string }[] = [];
  let totalFundingNet = 0;
  let totalEntryFees = 0;
  let totalTargetExitFees = 0;
  let peakSlots = 0;

  const closeLiquidation = (position: Position, time: number, trigger: number) => {
    const collateralLost = Math.max(0, position.margin + position.fundingNet);
    mainBalance -= collateralLost;
    const closeMinuteEnd = time % MINUTE === 0 ? time : Math.ceil(time / MINUTE) * MINUTE;
    closed.push({
      id: position.id, signalId: position.signalId, symbol: position.symbol, side: position.side,
      entryTime: position.entryTime, entry: position.entry, quantity: position.quantity,
      requestedMargin: position.requestedMargin, margin: position.margin, entryFee: position.entryFee,
      fundingNet: position.fundingNet, target: position.target, closeTime: time, closeMinuteEnd,
      closeKind: 'LIQUIDATION', exitPrice: null, liquidationTrigger: trigger,
      targetTradePrice: null, targetTradeQuantity: null, executionTimeSource: 'BINANCE_MARK_1M', exitFee: 0, gross: null,
      net: -position.margin - position.entryFee, durationLowMs: Math.max(0, time - position.entryTime),
      durationHighMs: Math.max(0, closeMinuteEnd - position.entryTime), mainAfter: mainBalance,
    });
    const index = positions.findIndex((p) => p.id === position.id);
    if (index >= 0) positions.splice(index, 1);
  };

  const closeTarget = (position: Position, time: number, exitPrice: number, exactAtOpen: boolean) => {
    const gross = grossAtPrice(position.side, position.entry, exitPrice, position.quantity);
    const exitFee = position.quantity * exitPrice * MAKER_FEE;
    mainBalance += gross - exitFee;
    totalTargetExitFees += exitFee;
    const closeMinuteEnd = exactAtOpen ? time : time + MINUTE;
    closed.push({
      id: position.id, signalId: position.signalId, symbol: position.symbol, side: position.side,
      entryTime: position.entryTime, entry: position.entry, quantity: position.quantity,
      requestedMargin: position.requestedMargin, margin: position.margin, entryFee: position.entryFee,
      fundingNet: position.fundingNet, target: position.target, closeTime: time, closeMinuteEnd,
      closeKind: 'TARGET', exitPrice, liquidationTrigger: null,
      targetTradePrice: null, targetTradeQuantity: null, executionTimeSource: 'BINANCE_1M_OHLC', exitFee, gross,
      net: gross - position.entryFee - exitFee + position.fundingNet,
      durationLowMs: Math.max(0, time - position.entryTime), durationHighMs: Math.max(0, closeMinuteEnd - position.entryTime),
      mainAfter: mainBalance,
    });
    const index = positions.findIndex((p) => p.id === position.id);
    if (index >= 0) positions.splice(index, 1);
  };

  for (let time = WINDOW_START; time < AS_OF; time += MINUTE) {
    const fundingEvents = (fundingAt.get(time) ?? []).sort((a, b) => (pairOrder.get(a.symbol) ?? 0) - (pairOrder.get(b.symbol) ?? 0));
    for (const event of fundingEvents) {
      for (const position of [...positions]) {
        if (position.symbol !== event.symbol || position.entryTime >= time) continue;
        const signedSide = position.side === 'LONG' ? 1 : -1;
        const cashflow = -signedSide * position.quantity * event.mark * event.rate;
        position.fundingNet += cashflow;
        mainBalance += cashflow;
        totalFundingNet += cashflow;
        position.liquidation = liquidationPrice(position);
        if (isLiquidatedAt(position, event.mark)) closeLiquidation(position, time, event.mark);
      }
    }

    const entries = signalAt.get(time) ?? [];
    for (const signal of entries) {
      if (!hasFreeSlot(positions.length)) { skipped.push({ signalId: signal.id, symbol: signal.symbol, side: signal.side, time, reason: 'Six simultaneous slots were already occupied at the entry minute open' }); continue; }
      if (!(mainBalance > 0)) { skipped.push({ signalId: signal.id, symbol: signal.symbol, side: signal.side, time, reason: 'Main balance was not positive' }); continue; }
      const market = last1.get(signal.symbol)?.get(time);
      const contract = contracts.get(signal.symbol);
      if (!market || !contract) throw new Error(`${signal.symbol}: missing entry candle or contract data at ${iso(time)}`);
      const requestedMargin = marginFor(mainBalance);
      const rawQuantity = requestedMargin * RULES.leverage / market.open;
      const quantity = floorStep(rawQuantity, contract.stepSize, contract.quantityPrecision);
      const notional = quantity * market.open;
      if (quantity < contract.minQty || notional < contract.minNotional) {
        skipped.push({ signalId: signal.id, symbol: signal.symbol, side: signal.side, time, reason: `Rounded order ${notional.toFixed(8)} USDT is below the current ${contract.minNotional} USDT exchange minimum` });
        continue;
      }
      const tier = matchingTier(contract, notional);
      if (!tier || tier.maxOpenPosLeverage < RULES.leverage) {
        skipped.push({ signalId: signal.id, symbol: signal.symbol, side: signal.side, time, reason: 'The current exchange risk tier does not permit the requested 75x leverage' });
        continue;
      }
      const margin = notional / RULES.leverage;
      const entryFee = notional * TAKER_FEE;
      const locked = sum(positions.map((p) => p.margin));
      if (mainBalance - locked < margin + entryFee) {
        skipped.push({ signalId: signal.id, symbol: signal.symbol, side: signal.side, time, reason: 'Insufficient free wallet balance for the isolated margin and entry fee' });
        continue;
      }
      const target = targetPrice(signal.side, market.open, margin, quantity, contract.tickSize);
      const id = `Q82-${String(opened.length + 1).padStart(4, '0')}`;
      const position: Position = {
        id, signalId: signal.id, symbol: signal.symbol, side: signal.side, entryTime: time, entry: market.open,
        quantity, requestedMargin, margin, entryFee, fundingNet: 0, target,
        liquidation: 0, mmr: tier.bracketMaintenanceMarginRate, cumMaintenance: tier.cumFastMaintenanceAmount,
        liquidationTriggerTime: null,
      };
      position.liquidation = liquidationPrice(position);
      mainBalance -= entryFee;
      totalEntryFees += entryFee;
      positions.push(position);
      peakSlots = Math.max(peakSlots, positions.length);
      opened.push({ signal, entryTime: time, entry: market.open, quantity, requestedMargin, margin, entryFee, target, liquidation: position.liquidation });
    }

    for (const position of [...positions]) {
      const market = last1.get(position.symbol)?.get(time);
      const mark = mark1.get(position.symbol)?.get(time);
      if (!market || !mark) throw new Error(`${position.symbol}: missing execution candle at ${iso(time)}`);
      position.liquidation = liquidationPrice(position);
      const liqAtOpen = isLiquidatedAt(position, mark.open);
      const targetAtOpen = position.side === 'LONG' ? market.open >= position.target : market.open <= position.target;
      if (liqAtOpen) { closeLiquidation(position, time, mark.open); continue; }
      if (targetAtOpen) { closeTarget(position, time, market.open, true); continue; }
      const targetHit = position.side === 'LONG' ? market.high >= position.target : market.low <= position.target;
      const liquidationHit = position.side === 'LONG' ? isLiquidatedAt(position, mark.low) : isLiquidatedAt(position, mark.high);
      if (liquidationHit) { closeLiquidation(position, time, position.liquidation); continue; }
      if (targetHit) closeTarget(position, time, position.target, false);
    }
  }

  const aggregateArchivePaths = new Set<string>();
  for (const trade of closed.filter((item) => item.closeKind === 'TARGET')) {
    const date = iso(trade.closeTime).slice(0, 10);
    const archive = await loadAggregateTrades(trade.symbol, date);
    const fill = firstTargetFill(trade.side, trade.target, trade.quantity, trade.entryTime, archive.rows);
    if (!fill) throw new Error(`${trade.id}: no Binance aggregate trade crossed the target with enough aggressor-side volume`);
    const expectedMinuteEnd = trade.closeMinuteEnd > trade.closeTime ? trade.closeMinuteEnd : trade.closeTime + MINUTE;
    if (fill.time < trade.closeTime || fill.time >= expectedMinuteEnd) {
      throw new Error(`${trade.id}: aggregate-trade crossing ${iso(fill.time)} conflicts with the 1m target-hit candle ${iso(trade.closeTime)}`);
    }
    trade.closeTime = fill.time;
    trade.closeMinuteEnd = fill.time;
    trade.durationLowMs = fill.time - trade.entryTime;
    trade.durationHighMs = fill.time - trade.entryTime;
    trade.targetTradePrice = fill.price;
    trade.targetTradeQuantity = fill.cumulativeQuantity;
    trade.executionTimeSource = 'BINANCE_AGG_TRADES';
    aggregateArchivePaths.add(archive.relativePath);
  }

  const open = positions.map((position) => {
    const mark = mark1.get(position.symbol)?.get(AS_OF - MINUTE);
    if (!mark) throw new Error(`${position.symbol}: missing final mark candle`);
    return {
      id: position.id, signalId: position.signalId, symbol: position.symbol, side: position.side,
      entryTime: iso(position.entryTime), entry: position.entry, quantity: position.quantity,
      requestedMargin: round(position.requestedMargin), margin: round(position.margin), entryFee: round(position.entryFee),
      target: position.target, lastMark: mark.close, unrealizedGross: grossAtPrice(position.side, position.entry, mark.close, position.quantity),
      fundingNet: round(position.fundingNet), liquidationTrigger: position.liquidation,
      liquidationTriggerTime: position.liquidationTriggerTime,
    };
  });
  const targetTrades = closed.filter((trade) => trade.closeKind === 'TARGET');
  const targetDurations = targetTrades.map((trade) => trade.durationLowMs);
  const targetDurationHigh = targetTrades.map((trade) => trade.durationHighMs);
  const openUnrealized = sum(open.map((trade) => trade.unrealizedGross));
  const profitable = closed.filter((trade) => trade.net > 0);
  const feeTotal = totalEntryFees + totalTargetExitFees;
  const expectedBalance = RULES.startingBalance + sum(closed.map((trade) => trade.net)) + sum(open.map((trade) => trade.fundingNet - trade.entryFee));
  if (Math.abs(expectedBalance - mainBalance) > 1e-7) throw new Error(`Account ledger does not reconcile: ${expectedBalance} != ${mainBalance}`);

  const perCoin = PAIRS.map((symbol) => {
    const coinSignals = signals.filter((s) => s.symbol === symbol);
    const coinOpened = opened.filter((p) => p.signal.symbol === symbol);
    const coinSkipped = skipped.filter((s) => s.symbol === symbol);
    const coinClosed = closed.filter((t) => t.symbol === symbol);
    const coinTargets = coinClosed.filter((t) => t.closeKind === 'TARGET');
    const coinOpen = open.filter((p) => p.symbol === symbol);
    return {
      symbol, signals: coinSignals.length, opened: coinOpened.length, skipped: coinSkipped.length,
      targetClosed: coinTargets.length, liquidated: coinClosed.length - coinTargets.length,
      profitable: coinClosed.filter((t) => t.net > 0).length, stillOpen: coinOpen.length,
      closedNet: sum(coinClosed.map((t) => t.net)), fees: sum(coinClosed.map((t) => t.entryFee + t.exitFee)) + sum(coinOpen.map((t) => t.entryFee)),
      fundingNet: sum(coinClosed.map((t) => t.fundingNet)) + sum(coinOpen.map((t) => t.fundingNet)),
      openUnrealizedGross: sum(coinOpen.map((t) => t.unrealizedGross)),
    };
  });

  const hashes: Record<string, string> = {};
  for (const filename of ['Q-Trend_zigzag_v8.original.pine', 'plan.txt', ...PAIRS.map((p) => `data/${p}.json.gz`), 'data/exchange-info.json.gz', 'data/risk-brackets.json.gz', ...aggregateArchivePaths]) {
    hashes[filename] = createHash('sha256').update(await readFile(join(ROOT, filename))).digest('hex');
  }
  const completedSorted = [...targetTrades].sort((a, b) => a.durationLowMs - b.durationLowMs || a.entryTime - b.entryTime);
  const summary = {
    windowStart: iso(WINDOW_START), asOf: iso(AS_OF),
    signalsGenerated: signals.length, tradesOpened: opened.length, signalsSkipped: skipped.length,
    tradesClosed: closed.length, targetClosed: targetTrades.length, liquidations: closed.length - targetTrades.length,
    profitableClosedTrades: profitable.length, openAtEnd: open.length,
    realizedClosedTradeNet: sum(closed.map((trade) => trade.net)),
    mainBalanceChange: mainBalance - RULES.startingBalance, finalMainBalance: mainBalance,
    realizedReturnPct: (mainBalance / RULES.startingBalance - 1) * 100,
    feesPaid: feeTotal, fundingNet: totalFundingNet,
    openUnrealizedGross: openUnrealized, markedEquity: mainBalance + openUnrealized,
    markedReturnPct: ((mainBalance + openUnrealized) / RULES.startingBalance - 1) * 100,
    maxSimultaneousSlotsUsed: peakSlots,
    fastestTargetDurationLowMs: targetDurations.length ? Math.min(...targetDurations) : null,
    fastestTargetDurationHighMs: targetDurations.length ? Math.min(...targetDurationHigh) : null,
    slowestTargetDurationLowMs: targetDurations.length ? Math.max(...targetDurations) : null,
    slowestTargetDurationHighMs: targetDurations.length ? Math.max(...targetDurationHigh) : null,
    averageTargetDurationLowMs: targetDurations.length ? sum(targetDurations) / targetDurations.length : null,
    averageTargetDurationHighMs: targetDurationHigh.length ? sum(targetDurationHigh) / targetDurationHigh.length : null,
  };
  const result = {
    reportTitle: 'Q-Trend ZigZag Big Swings v8 — 30-day Binance USDⓈ-M Futures backtest',
    researchOnly: true,
    window: { start: iso(WINDOW_START), end: iso(AS_OF), timezone: 'UTC', latestSignalBarCloseIncluded: iso(Math.floor(AS_OF / TF) * TF) },
    rules: {
      indicator: 'Exact attached Q-Trend ZigZag Big Swings v8 Pine v5; source file hash is in dataHashes.',
      sourceInputs: 'Pine defaults, unchanged: close, trend period 300, ATR 20, multiplier 2.2, Type A, no EMA smoothing, Big swings (confirmed), normal+strong Buy and Sell accepted, 10% swing, 20-bar signal tolerance, 7% min run.',
      signalTiming: 'The script backdates labels to the original Q-Trend bar, but its alert only fires after the swing and min-run confirmation. Entry is at the next 1m Futures candle open after that alert; no backdated entry is used.',
      pairs: PAIRS,
      startingBalance: RULES.startingBalance, maxSlots: RULES.maxSlots, marginRate: RULES.marginRate,
      leverage: RULES.leverage, targetGrossProfitMarginMultiple: RULES.targetMarginMultiple,
      targetUsesGrossPnlBeforeFeesAndFunding: true,
      positionModel: 'Independent isolated position per signal; hedge-mode behavior permits opposite directions on the same pair; no per-pair position cap was added.',
      exits: '200% gross profit on actual rounded allocated margin, or exchange-triggered isolated liquidation only. Opposite signals and elapsed time do not close positions.',
      fees: { entryMarketTaker: TAKER_FEE, targetRestingLimitMaker: MAKER_FEE, liquidationClearance: 'Not separately charged; forced liquidation is modeled as loss of remaining isolated collateral, capped at the allocated margin.' },
      fillAssumptions: 'Entry at next 1m candle open; target is a resting limit order filled at its limit or better if the 1m open gaps through it. No spread/slippage estimate is invented. Quantity is rounded down to current Binance market lot step and current minimum-notional filters are applied.',
      liquidation: 'Mark-price candles and the current public Binance maintenance tiers are used. If a target and liquidation are both touched in one 1m candle, liquidation wins because OHLC does not reveal the sequence.',
      funding: 'Historical Binance USDⓈ-M funding rates and their published mark prices are applied to positions held before each settlement timestamp.',
    },
    data: {
      source: 'Binance USDⓈ-M Futures official public API (30m klines, 1m last-price klines, 1m mark-price klines, funding history); public exchangeInfo filters and risk-bracket snapshot.',
      fetchedAt: iso(exchange.serverTime),
      targetExecutionTimes: 'Official Binance daily aggregate-trade archives; first correctly directed trade at/through the limit with cumulative volume at least the modeled position quantity.',
      aggregateTradeArchives: [...aggregateArchivePaths],
      expected30mBarsPerPair: (Math.floor(AS_OF / TF) * TF - (Math.floor(WINDOW_START / TF) * TF - WARMUP_BARS * TF)) / TF,
      expectedExecutionMinutesPerPair: (AS_OF - WINDOW_START) / MINUTE,
      missingData: [],
      pineInterpreter: 'Local PineTS 0.13.1 interpreter on the intact Pine v5 source; not independently certified against TradingView exported alerts.',
      warnings: pineWarnings,
      dataHashes: hashes,
    },
    summary,
    perCoin,
    signals: signals.map((s) => ({ id: s.id, symbol: s.symbol, side: s.side, signalType: s.type, confirmedAt: iso(s.confirmedAt), alertConfirmationBarOpen: iso(s.alertBarOpen), entryTime: iso(s.confirmedAt) })),
    skipped,
    trades: closed.map((t) => ({
      ...t, entryTime: iso(t.entryTime), closeTime: iso(t.closeTime), closeMinuteEnd: iso(t.closeMinuteEnd),
      duration: t.closeKind === 'TARGET' ? durationRange(t) : null,
    })),
    open,
  };
  await writeFile(join(ROOT, 'result.json'), JSON.stringify(result, null, 2));

  const money = (value: number) => `${value < 0 ? '-$' : '$'}${Math.abs(value).toFixed(4)}`;
  const percent = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  const targetFast = completedSorted[0];
  const targetSlow = [...targetTrades].sort((a, b) => b.durationLowMs - a.durationLowMs)[0];
  const avgDurationLow = summary.averageTargetDurationLowMs === null ? null : durationLabel(summary.averageTargetDurationLowMs);
  const avgDurationHigh = summary.averageTargetDurationHighMs === null ? null : durationLabel(summary.averageTargetDurationHighMs);
  const avgDuration = avgDurationLow === null ? 'N/A' : avgDurationLow === avgDurationHigh ? avgDurationLow : `${avgDurationLow}–${avgDurationHigh}`;
  const topQuick = completedSorted.slice(0, 20);
  const fmtWindow = (t: ClosedTrade) => durationRange(t);
  const fastLine = targetFast ? `${fmtWindow(targetFast)} (${targetFast.symbol} ${targetFast.side}, entry ${iso(targetFast.entryTime)}, first target-cross trade ${iso(targetFast.closeTime)})` : 'No target executions';
  const slowLine = targetSlow ? `${fmtWindow(targetSlow)} (${targetSlow.symbol} ${targetSlow.side}, entry ${iso(targetSlow.entryTime)}, first target-cross trade ${iso(targetSlow.closeTime)})` : 'No target executions';
  const coinRows = perCoin.map((coin) => [
    coin.symbol, coin.signals, coin.opened, coin.skipped, coin.targetClosed, coin.liquidated, coin.profitable,
    coin.stillOpen, money(coin.closedNet), money(coin.fees), money(coin.fundingNet), money(coin.openUnrealizedGross),
  ]);
  const quickRows = topQuick.map((trade, i) => [
    i + 1, trade.symbol, trade.side, iso(trade.entryTime), trade.entry.toPrecision(10), iso(trade.closeTime),
    trade.exitPrice?.toPrecision(10) ?? '', trade.targetTradePrice?.toPrecision(10) ?? '', fmtWindow(trade), money(trade.margin), trade.target.toPrecision(10), money(trade.net),
  ]);
  const report = `# Q-Trend ZigZag Big Swings v8 — 30-day Futures backtest

**Research only.** No live website, Simulator, balances, saved trades, Telegram, worker, or deployment was changed.

## Window and headline

- **Period:** ${iso(WINDOW_START)} to ${iso(AS_OF)} UTC (the latest 30 days ending at the user message time).
- **Signals generated:** ${summary.signalsGenerated}; **trades opened:** ${summary.tradesOpened}; **signals skipped:** ${summary.signalsSkipped}.
- **Trades closed:** ${summary.tradesClosed} (${summary.targetClosed} target hits; ${summary.liquidations} forced liquidations).
- **Profitable closed trades after modeled costs:** ${summary.profitableClosedTrades}.
- **Still open at cutoff:** ${summary.openAtEnd}.
- **Net realized account change:** ${money(summary.mainBalanceChange)}; **final main balance:** ${money(summary.finalMainBalance)} (**${percent(summary.realizedReturnPct)}**).
- **Mark-to-market equity including open gross P&L:** ${money(summary.markedEquity)} (**${percent(summary.markedReturnPct)}** from $10).
- **Entry and target-exit fees modeled:** ${money(summary.feesPaid)}; **net funding received/(paid):** ${money(summary.fundingNet)}.
- **Target completion duration:** fastest ${fastLine}; slowest ${slowLine}; average ${avgDuration}.
- **Maximum slots used:** ${summary.maxSimultaneousSlotsUsed} of 6.

` + markdownTable(['Pair', 'Signals', 'Opened', 'Skipped', 'Target closes', 'Liquidated', 'Profitable', 'Open', 'Closed net', 'Fees', 'Funding net', 'Open gross P&L'], coinRows) + `

## Fastest target completions

Target completion time is the first Binance aggregate trade in the required aggressor direction that reaches the limit and has cumulative volume at least as large as the simulated position. This gives millisecond timestamps from the official historical trade archives; actual queue position and a personal account fill cannot be reconstructed. The attached CSV contains every closed trade; this table lists the ${topQuick.length} shortest target hits.

` + (quickRows.length ? markdownTable(['#', 'Pair', 'Side', 'Entry UTC', 'Entry', 'Target-cross trade UTC', 'Limit fill assumption', 'Observed trade price', 'Duration', 'Margin', 'Target price', 'Net trade result'], quickRows) : 'No trades reached the target during the window.') + `

## Rules and execution

- **Indicator:** the exact attached Pine v5 source, using its defaults without edits: close source; trend period 300; ATR 20; multiplier 2.2; Type A; no EMA smoothing; Big swings (confirmed); normal and strong Buy/Sell accepted; 10% big swing; 20-bar signal tolerance; 7% minimum favorable move.
- **Confirmation timing:** labels are drawn on the earlier signal candle, but the indicator's alert is delayed until pivot and minimum-run confirmation. Entries therefore occur at the first 1-minute Futures candle open after the alert. No entry is backdated to the label candle.
- **Pairs:** ${PAIRS.join(', ')} only. Signals and execution use Binance USDⓈ-M Futures candles.
- **Account model:** $10 start; six simultaneous slots; each new trade requests 5% of the current main balance; 75x; quantity rounded down to the current exchange market step. The margin for the target calculation is the actual rounded notional divided by 75.
- **Target:** a resting limit target at 200% gross profit on allocated margin. Fees and funding reduce realized net results; they do not move the user's specified gross target.
- **Fees:** modeled as VIP-0 market taker 0.05% on entries and resting maker 0.02% on target exits, with no BNB/VIP discount. Binance's fees vary by account tier and the exchange lists commission, funding, and forced-liquidation clearance as distinct cost types; actual account-specific fees may differ ([fee schedule](https://www.binance.com/en/support/faq/detail/360033544231), [fee types](https://www.binance.com/en/support/faq/detail/98488a516eb84e3eb34605683dffd554)).
- **Funding and liquidation:** actual historical funding rates and published mark prices are applied. Public maintenance tiers are a current snapshot, not an archived tier history. A forced liquidation is an exchange event, not an added stop-loss; it is recorded separately. For this isolated-margin model, liquidation consumes remaining allocated collateral, capped at the position margin; no additional account-specific liquidation-clearance rate is separately assessed.
- **Parallel positions:** each slot is treated as an independent isolated position, so same-pair or opposite-direction alerts can coexist (hedge-mode assumption). The plan did not define a per-pair limit or one-way netting rule.
- **Balance:** fees and funding update the main balance as incurred; open unrealized P&L is excluded from that main-balance figure and shown separately as mark-to-market equity.

## Data integrity and limitations

- All requested symbols returned active USDⓈ-M perpetual contracts and complete data for the full execution window. Each pair has ${result.data.expectedExecutionMinutesPerPair.toLocaleString()} of ${result.data.expectedExecutionMinutesPerPair.toLocaleString()} last-price 1m bars and the same number of mark-price bars, plus ${result.data.expected30mBarsPerPair.toLocaleString()} 30m bars including ${WARMUP_BARS} pre-window warmup bars. No candles were interpolated or synthesized.
- Target hits and liquidations are first detected from 1-minute OHLC. If both target and liquidation fall inside the same minute, liquidation is chosen conservatively because candle data cannot establish event order. The three target hits were then checked against the official daily aggregate-trade archives, which provide millisecond crossing times and aggressor-side volume.
- Target completion time assumes a resting order fills once the first qualifying aggregate trade reaches the limit and its cumulative volume covers the simulated quantity. Order-book queue priority, partial-fill timing and personal account execution are unavailable; timestamps are therefore reproducible market-cross/fill-model times, not a claim about a real account fill.
- No market-order slippage, bid/ask spread, partial fills, or user-specific fee discount is invented. Actual fills may differ from candle opens and resting targets.
- The source was executed using the local PineTS interpreter against identical official Binance Futures candles; this is not an independent TradingView-exported alert parity certification. Pine runtime warnings: ${pineWarnings.length}.
- Current Binance exchange lot/minimum-notional filters and maintenance tiers were used for this historical replay; they may differ from their exact historical values.
- Liquidation clearance is a distinct Binance charge, but its account/contract-specific rate is unavailable in this public historical dataset. The model caps isolated forced loss at allocated margin and does not add a separate clearance fee; liquidation results should therefore be treated as an estimate.

## Reproducibility

- Original indicator and plan are retained byte-for-byte in this research folder.
- Run: bun research/prompt-82/backtest.ts (uses the frozen, compressed Binance data); add --refresh to fetch the same fixed window again.
- Files: result.json (full signals, skipped entries, trade ledger, open positions, hashes), trades.csv (all closed and open trades), data/*.json.gz (frozen candles/funding), and data/aggTrades/ (official target-date tick archives).
- SHA-256 fingerprints of the source, plan, market data and exchange metadata are in result.json.
`;
  await writeFile(join(ROOT, 'report.md'), report);

  const csvRows = [
    ['id', 'signal_id', 'pair', 'side', 'status', 'entry_time_utc', 'entry_price', 'quantity', 'requested_margin', 'actual_margin', 'entry_fee', 'target_price', 'close_time_utc', 'close_time_end_utc', 'exit_price', 'target_cross_trade_price', 'target_cross_volume', 'liquidation_trigger', 'exit_fee', 'gross_profit', 'funding_net', 'net_result', 'duration_ms', 'close_reason', 'execution_time_source', 'main_balance_after'],
    ...closed.map((t) => [t.id, t.signalId, t.symbol, t.side, t.closeKind, iso(t.entryTime), t.entry, t.quantity, t.requestedMargin, t.margin, t.entryFee, t.target, iso(t.closeTime), iso(t.closeMinuteEnd), t.exitPrice, t.targetTradePrice, t.targetTradeQuantity, t.liquidationTrigger, t.exitFee, t.gross, t.fundingNet, t.net, t.durationLowMs, t.closeKind, t.executionTimeSource, t.mainAfter]),
    ...open.map((t) => [t.id, t.signalId, t.symbol, t.side, 'OPEN', t.entryTime, t.entry, t.quantity, t.requestedMargin, t.margin, t.entryFee, t.target, '', '', '', '', '', t.liquidationTrigger, '', '', t.fundingNet, '', '', 'OPEN_AT_CUTOFF', '', '']),
  ];
  await writeFile(join(ROOT, 'trades.csv'), csvRows.map((row) => row.map(csvCell).join(',')).join('\n') + '\n');

  const fastestDuration = summary.fastestTargetDurationLowMs === null ? null : durationLabel(summary.fastestTargetDurationLowMs);
  const slowestDuration = summary.slowestTargetDurationLowMs === null ? null : durationLabel(summary.slowestTargetDurationLowMs);
  console.log(JSON.stringify({ ...summary, fastestTargetDuration: fastestDuration, slowestTargetDuration: slowestDuration, averageTargetDuration: avgDuration, dataProblems, report: join(ROOT, 'report.md'), ledger: join(ROOT, 'trades.csv') }, null, 2));
}

await main();
