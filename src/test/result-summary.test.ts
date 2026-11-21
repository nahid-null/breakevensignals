import { describe, expect, it } from 'vitest';
import { sentResultSummary } from '@/lib/signal-summary';

const log = (trade_id: string, event_id = `${trade_id}-simulator-result`, delivery_status = 'SENT', is_test = false) => ({ trade_id, event_id, delivery_status, is_test });
describe('Telegram results-only summary', () => {
  it('counts only sent Simulator results as Take profit hit or Stop loss hit', () => {
    const r = sentResultSummary(
      [log('a'), log('b'), log('c'), log('d', 'd-breakeven_activated'), log('e', 'e-simulator-result', 'FAILED'), log('f', 'f-simulator-result', 'SENT', true)],
      [{ trade_id: 'a', exit_reason: 'TAKE_PROFIT' }, { trade_id: 'b', exit_reason: 'BREAKEVEN' }, { trade_id: 'c', exit_reason: 'STOP_LOSS' }],
    );
    expect(r).toMatchObject({ sent: 3, takeProfit: 1, stopLoss: 2 }); expect(r.successRate).toBeCloseTo(33.333, 2);
  });
});

describe('prompt-74 CSTF results', () => {
  it('counts a sent CSTF take profit and a liquidation', () => {
    const r = sentResultSummary([
      { trade_id: 'a', event_id: 'a-cstf-result', delivery_status: 'SENT', is_test: false },
      { trade_id: 'b', event_id: 'b-cstf-result', delivery_status: 'SENT', is_test: false },
    ], [{ trade_id: 'a', exit_reason: 'TAKE_PROFIT' }, { trade_id: 'b', exit_reason: 'LIQUIDATED' }]);
    expect(r).toMatchObject({ sent: 2, takeProfit: 1, stopLoss: 1 });
  });
});
