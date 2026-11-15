import { PARAMETERS } from './model';

export function breakevenTriggerPrice(position: {
  direction: string; entry_price: number; original_stop_loss: number;
}): number {
  const risk = Math.abs(Number(position.entry_price) - Number(position.original_stop_loss));
  return Number(position.entry_price) + (position.direction === 'LONG' ? 1 : -1) * risk * PARAMETERS.breakevenTrigger;
}

export function lastSignalTime(position: {
  entry_timestamp: string; breakeven_timestamp: string | null; exit_timestamp: string | null;
}): string {
  return [position.entry_timestamp, position.breakeven_timestamp, position.exit_timestamp]
    .filter((value): value is string => value !== null)
    .reduce((latest, value) => Date.parse(value) > Date.parse(latest) ? value : latest, position.entry_timestamp);
}