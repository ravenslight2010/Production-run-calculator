/**
 * Factory-standard multiplier used when a run or die setting has no explicit
 * Speed Adjustment. Keep compatibility-only historical blank sentinels local
 * to their recognition code; they are not runtime defaults.
 */
export const FACTORY_SPEED_ADJUSTMENT_BASELINE = 0.92;

/**
 * Current factory-standard equipment and tunnel timing defaults.
 *
 * These are runtime defaults shared by the web form and server blank-shape
 * recognition. Historical persisted values such as 0 remain compatibility
 * sentinels in the consuming normalization code and must not be added here.
 */
export const FACTORY_TIMING_DEFAULTS = {
  mixerLowSec: 330,
  mixerHighSec: 180,
  hopperSec: 70,
  preTunnelMin: 2.5,
  postTunnelMin: 2.5,
} as const;