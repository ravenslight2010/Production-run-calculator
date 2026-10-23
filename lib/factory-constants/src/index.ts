/** Only setup references are eligible for generic master-data compensation. */
export const MASTER_DATA_REFERENCE_VALUE_FIELDS: readonly string[] = [
  "doughRecipeName", "frontlineRecipeName", "app1CheeseRecipeName", "app2CheeseRecipeName", "app3CheeseRecipeName", "app4CheeseRecipeName",
  "doughRecipe", "frontlineRecipe", "app1CheeseRecipe", "app2CheeseRecipe", "app3CheeseRecipe", "app4CheeseRecipe",
  "app1Type", "app2Type", "app3Type", "app4Type", "pep1Type", "pep1TypeB", "pep2Type", "pep2TypeB", "dieType",
];
export {
  OPERATIONAL_DIRECTORY_KEYS, OPERATIONAL_FACTORY_SETTING_KEYS, OPERATIONAL_FACTORY_READ_KEYS,
} from "./operationalDirectory";
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