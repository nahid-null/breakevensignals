/** Runtime source coverage, not repository metadata or credentials. Stable sorted UTF-8 bytes are hashed at worker start. */
export const ROBOT_STRATEGY_VERSION = 'SMC_V1';
export const RELEASE_FILES = [
  'engine-worker/binance.ts', 'engine-worker/cloud-health.ts', 'engine-worker/local-health.ts', 'engine-worker/main.ts',
  'engine-worker/release-fingerprint.ts', 'engine-worker/robot-service.ts', 'engine-worker/service.ts', 'engine-worker/websocket.ts',
  'src/lib/config.ts', 'src/lib/engine/calculations.ts', 'src/lib/engine/feed-health.ts', 'src/lib/engine/five-minute.ts', 'src/lib/engine/market-access.ts', 'src/lib/engine/model.ts', 'src/lib/engine/ob-vp.ts',
  'src/lib/engine/mtf-trend.ts', 'src/lib/engine/pine-numbers.ts', 'src/lib/engine/protocol.ts', 'src/lib/engine/scalper.ts', 'src/lib/engine/stats.ts',
  'src/lib/robot/config.ts', 'src/lib/robot/engine.ts', 'src/lib/robot/entry-audit.ts', 'src/lib/robot/indicators.ts', 'src/lib/robot/liquidity-sweep.ts',
  'src/lib/robot/paper.ts', 'src/lib/robot/protocol.ts', 'src/lib/robot/release-files.ts', 'src/lib/robot/risk.ts', 'src/lib/robot/series.ts', 'src/lib/robot/smc.ts',
  'src/lib/robot/strategy.ts', 'src/lib/robot/telegram-format.ts', 'package.json', 'bun.lock', 'engine-worker/Dockerfile',
] as const;