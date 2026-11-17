import { ROBOT_SYMBOLS } from '@/lib/robot/config';
import { SYMBOLS } from '@/lib/config';

/** Chart timeframes. Binance interval ids; bar open times are UTC multiples of `ms`. */
export const TIMEFRAMES = [
  { id: '1m', label: '1M', ms: 60_000 }, { id: '3m', label: '3M', ms: 180_000 }, { id: '5m', label: '5M', ms: 300_000 },
  { id: '15m', label: '15M', ms: 900_000 }, { id: '1h', label: '1H', ms: 3_600_000 }, { id: '4h', label: '4H', ms: 14_400_000 },
] as const;
export type TimeframeId = (typeof TIMEFRAMES)[number]['id'];
export const isTimeframe = (v: string): v is TimeframeId => TIMEFRAMES.some((t) => t.id === v);
export const tfMs = (id: TimeframeId) => TIMEFRAMES.find((t) => t.id === id)!.ms;
/** Open time of the displayed-timeframe bar that contains `time`. */
export const barOpen = (time: number, ms: number) => Math.floor(time / ms) * ms;

/** Monitored coins: the Pine signal list plus the robot list. WILDUSDT is not listed on Binance and cannot be charted. */
export const UNAVAILABLE_SYMBOLS = ['WILDUSDT'] as const;
export const CHART_SYMBOLS: string[] = [...new Set<string>([...SYMBOLS, ...ROBOT_SYMBOLS])]
  .filter((s) => !(UNAVAILABLE_SYMBOLS as readonly string[]).includes(s)).sort();
export const PINE_SYMBOLS = new Set<string>(SYMBOLS);
export const ROBOT_SET = new Set<string>(ROBOT_SYMBOLS);
