import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { ABSOLUTE_MAX_ALLOCATION_PCT, ROBOT_SYMBOL_PATTERN } from './config';

/** Adds practice money to the paper robot's main balance. */
export const robotDeposit = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => z.object({ amount: z.number().finite().positive().max(1_000_000_000) }).parse(d))
  .handler(async ({ data }) => {
    throw new Error('Paper Robot account controls have been retired.');
  });

/** Emergency STOP ALL: blocks new entries and closes every paper position at the last saved price. */
export const robotStopAll = createServerFn({ method: 'POST' }).handler(async () => {
  throw new Error('Paper Robot is already retired and stopped.');
});

export const robotResume = createServerFn({ method: 'POST' }).handler(async () => {
  throw new Error('Paper Robot has been retired; new entries are disabled.');
});

/** Editable paper settings. Leverage is fixed at 50x and is not editable. The daily loss limit and loss-streak cooldown are optional switches, off by default. */
export const robotSettingsSchema = z.object({
  enabled: z.boolean(),
  min_score: z.number().int().min(50).max(100), high_score: z.number().int().min(50).max(100),
  max_concurrent: z.number().int().min(1).max(10), max_same_direction: z.number().int().min(1).max(10),
  max_allocation_pct: z.number().positive().max(ABSOLUTE_MAX_ALLOCATION_PCT),
  max_hold_minutes: z.number().int().min(10).max(1440), fee_pct: z.number().min(0).max(1), maker_fee_pct: z.number().min(0).max(1),
  slippage_bps: z.number().min(0).max(100), max_spread_bps: z.number().positive().max(100), min_quote_volume_musd: z.number().min(0).max(100_000),
  entry_max_age_ms: z.number().int().min(1000).max(120000), quote_max_age_ms: z.number().int().min(500).max(30000), max_entry_drift_atr: z.number().positive().max(1),
  min_sweep_atr: z.number().positive().max(3), max_sweep_atr: z.number().positive().max(5), min_rejection_wick: z.number().min(0.1).max(0.9),
  min_volume_ratio: z.number().min(0.1).max(5), min_reward_risk: z.number().min(0.1).max(5), max_candle_atr: z.number().min(0.5).max(5), sweep_max_age_minutes: z.number().int().min(2).max(60),
  risk_per_trade_pct: z.number().positive().max(2),
  daily_loss_limit_enabled: z.boolean(), daily_loss_limit_pct: z.number().positive().max(20),
  loss_streak_enabled: z.boolean(), loss_streak_cooldown: z.number().int().min(1).max(10), cooldown_minutes: z.number().int().min(0).max(1440),
  breakeven_trigger_roi_pct: z.number().min(2).lt(10), ote_min: z.number().min(0.3).lt(1), ote_max: z.number().gt(0.3).max(1),
  symbols: z.array(z.string().regex(ROBOT_SYMBOL_PATTERN)).length(40).refine((xs) => new Set(xs).size === 40 && !xs.includes('WILDUSDT'), 'Use 40 different available futures coins, excluding WILDUSDT'),
}).strict().refine((s) => s.high_score >= s.min_score, { message: 'High-quality score must be at or above the minimum score' })
  .refine((s) => s.max_sweep_atr > s.min_sweep_atr, 'Maximum sweep must exceed minimum sweep')
  .refine((s) => s.ote_max > s.ote_min, 'OTE upper bound must exceed the lower bound');

/** Saves robot settings. The database re-checks every hard limit (70% margin, exactly 50x leverage). */
export const robotSaveSettings = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => robotSettingsSchema.parse(d))
  .handler(async ({ data }) => {
    throw new Error('Paper Robot settings have been retired.');
  });
