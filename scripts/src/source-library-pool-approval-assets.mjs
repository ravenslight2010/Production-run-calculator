// Shared by source preparation, API bundling, and the runtime verifier.
// Only these reviewed files are runtime inputs; unrelated evidence stays out.
export const DEFAULT_SOURCE_LIBRARY_POOL_EXCEPTIONS =
  "docs/evidence/source-library-pool-owner-approved-differences-2026-10-12-v2.json";
export const SOURCE_LIBRARY_POOL_APPROVAL_ASSETS = Object.freeze([
  DEFAULT_SOURCE_LIBRARY_POOL_EXCEPTIONS,
  "docs/evidence/source-library-pool-owner-review-2026-10-12-v2.md",
  "docs/evidence/source-library-pool-diagnostics-2026-10-12-v2.json",
  "docs/evidence/source-library-pool-live-capture-2026-10-12-v2.json",
]);
