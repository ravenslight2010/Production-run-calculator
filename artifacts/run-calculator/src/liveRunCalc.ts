import type { Calc } from "./contexts/LiveRunContext";

// Home reads the latest calculation for non-live UI without subscribing to the
// per-second LiveRunContext clock. Keeping this bridge separate prevents the
// provider module from exporting a non-component value alongside its provider.
export const calcRef: { current: Calc | null } = { current: null };