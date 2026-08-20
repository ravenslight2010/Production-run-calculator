/**
 * Identifier embedded in the web bundle so incident reports can be tied to a
 * particular deployment. Vite replaces this value at build time; local and
 * test builds still get a useful, non-empty fallback.
 */
const configuredBuildId = import.meta.env.VITE_APP_VERSION;

export const WEB_BUILD_ID =
  typeof configuredBuildId === "string" && configuredBuildId.trim()
    ? configuredBuildId.trim()
    : "local";