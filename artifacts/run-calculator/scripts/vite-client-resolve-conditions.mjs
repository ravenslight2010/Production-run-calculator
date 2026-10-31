// Keep source-boundary checks aligned with Vite's default client conditions.
// Vite resolves the development|production condition from NODE_ENV.
export const VITE_CLIENT_RESOLVE_CONDITIONS = Object.freeze([
  "module",
  "browser",
  "development|production",
]);
