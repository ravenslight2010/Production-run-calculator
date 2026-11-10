/**
 * Explicit resolution anchors for packages used via transports/config rather
 * than static imports. Keeps `pnpm run check:app-dependencies --strict` honest
 * without changing runtime behavior.
 *
 * Resolve is best-effort: production Docker images may omit optional pretty
 * transports; failing closed here would prevent the API from starting.
 */
for (const name of ["pino-pretty", "thread-stream"] as const) {
  try {
    void import.meta.resolve(name);
  } catch {
    // Optional at runtime; presence is enforced by check:app-dependencies in CI.
  }
}

export {};
