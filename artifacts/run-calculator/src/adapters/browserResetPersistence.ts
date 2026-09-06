/** Browser cache reset adapter; epoch comparison is intentionally side-effect scoped here. */
const RESET_EPOCH_KEY = "run-calc-reset-epoch";

export function getStoredResetEpoch(): number {
  if (typeof localStorage === "undefined") return 0;
  try {
    const value = Number.parseInt(localStorage.getItem(RESET_EPOCH_KEY) ?? "0", 10);
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

export function applyResetWipe(serverEpoch: number): boolean {
  if (typeof localStorage === "undefined" || !Number.isFinite(serverEpoch) || serverEpoch <= getStoredResetEpoch()) return false;
  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith("run-calc") && key !== RESET_EPOCH_KEY) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
    localStorage.setItem(RESET_EPOCH_KEY, String(serverEpoch));
    return true;
  } catch {
    return false;
  }
}