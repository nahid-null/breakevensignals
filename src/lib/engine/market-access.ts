/** Stable public error codes shared by worker telemetry and dashboard health. */
export const BINANCE_ACCESS_RESTRICTED = 'BINANCE_ACCESS_RESTRICTED';
export const BINANCE_IP_BANNED = 'BINANCE_IP_BANNED';

export function marketAccessCode(error: string | null | undefined) {
  if (error?.startsWith(`${BINANCE_ACCESS_RESTRICTED}:`)) return BINANCE_ACCESS_RESTRICTED;
  if (error?.startsWith(`${BINANCE_IP_BANNED}:`)) return BINANCE_IP_BANNED;
  return null;
}

export function marketAccessLabel(error: string | null | undefined) {
  const code = marketAccessCode(error);
  return code === BINANCE_ACCESS_RESTRICTED ? 'ACCESS RESTRICTED' : code === BINANCE_IP_BANNED ? 'IP BANNED' : null;
}