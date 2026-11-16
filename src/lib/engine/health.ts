export const HEARTBEAT_MAX_AGE_MS = 90_000;
const CANDLE_INTERVAL_MS = 60_000;
export type EngineHealthInput = {
  host_kind?: string; runtime_mode?: string; status: string;
  last_heartbeat_at: string; binance_connected: boolean; websocket_connected: boolean;
  uptime_seconds?: number; scanned_symbols?: number; last_scan_at?: string | null;
};

export function engineHealth(engine: EngineHealthInput | null | undefined, databaseOk: boolean, now = Date.now()) {
  const age = engine ? now - Date.parse(engine.last_heartbeat_at) : NaN;
  const fresh = databaseOk && Number.isFinite(age) && age >= -5000 && age < HEARTBEAT_MAX_AGE_MS;
  const alive = fresh && !!engine && engine.status !== 'STOPPED';
  const scanTime = Date.parse(engine?.last_scan_at ?? '');
  const scanFresh = Number.isFinite(scanTime) && now - scanTime >= -5000 && now - scanTime < 3 * CANDLE_INTERVAL_MS;
  const processing = alive && engine?.status === 'RUNNING' && engine.binance_connected && engine.websocket_connected && scanFresh;
  return {
    heartbeatFresh: fresh,
    cloud: alive && engine?.host_kind === 'hosted' && engine.runtime_mode === 'production' ? 'ONLINE' : 'OFFLINE',
    scanner: alive ? engine.status === 'RUNNING' && !processing ? 'RECOVERING' : engine.status : 'STOPPED',
    binance: alive && engine.binance_connected ? 'CONNECTED' : 'DISCONNECTED',
    websocket: alive && engine.websocket_connected ? 'CONNECTED' : 'DISCONNECTED',
    uptimeSeconds: fresh ? engine?.uptime_seconds ?? 0 : null,
    scannedSymbols: engine?.scanned_symbols ?? 0,
    lastScanAt: engine?.last_scan_at ?? null,
    nextScanAt: processing ? new Date((Math.floor(now / CANDLE_INTERVAL_MS) + 1) * CANDLE_INTERVAL_MS).toISOString() : null,
  };
}

export function formatUptime(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return '—';
  const n = Math.max(0, Math.floor(seconds));
  return `${Math.floor(n / 86400)}d ${Math.floor(n % 86400 / 3600)}h ${Math.floor(n % 3600 / 60)}m`;
}