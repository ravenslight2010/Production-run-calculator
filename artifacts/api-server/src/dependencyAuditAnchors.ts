/**
 * Explicit resolution anchors for packages used via transports/config rather
 * than static imports. Keeps `pnpm run check:app-dependencies --strict` honest
 * without changing runtime behavior.
 */
void import.meta.resolve("pino-pretty");
void import.meta.resolve("thread-stream");

export {};
