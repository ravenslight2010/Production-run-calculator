/**
 * Explicit resolution anchors for packages referenced by tests/PWA tooling
 * rather than production static imports.
 *
 * Resolve is best-effort: the browser bundle must not crash when optional
 * test-only packages (e.g. @testing-library/dom) are not resolvable as module
 * URLs. Presence is still enforced by check:app-dependencies in CI.
 */
for (const name of ["@testing-library/dom", "workbox-window"] as const) {
  try {
    void import.meta.resolve(name);
  } catch {
    // Optional at runtime in the browser.
  }
}

export {};
