/**
 * Explicit resolution anchors for packages referenced by tests/PWA tooling
 * rather than production static imports.
 */
void import.meta.resolve("@testing-library/dom");
void import.meta.resolve("workbox-window");

export {};
