/** Build isolated old/new fixtures without changing the parent process. */
export function pwaFixtureBuildEnv(
  inherited: Readonly<NodeJS.ProcessEnv>,
  version: "old" | "new",
): NodeJS.ProcessEnv {
  return {
    ...inherited,
    // Vite still derives DEV/PROD from NODE_ENV during `vite build`.
    // A development/test parent must not disable update checks in this fixture.
    NODE_ENV: "production",
    PWA_HANDOFF_BUILD_ID: `pwa-${version}-build`,
    // Preserve the existing fixture-only idle interval.
    VITE_UPDATE_RELOAD_IDLE_MS: "1000",
  };
}
