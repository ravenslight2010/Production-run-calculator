/** Test-only Compose context. Runtime Compose networking is never modified here. */
export function dockerCaddyBuildContext(repoRoot, environment = process.env) {
  const network = environment.DOCKER_CADDY_BUILD_NETWORK ?? "default";
  if (!["default", "host"].includes(network)) {
    throw new Error("Docker/Caddy build network must be default or host.");
  }
  if (network === "host" && (environment.GITHUB_ACTIONS === "true"
      || (environment.CI && environment.CI !== "false"))) {
    throw new Error("Host-network Docker/Caddy builds are not permitted in CI.");
  }
  // A constrained local Replit runtime may opt in when bridge DNS is broken.
  // CI uses ordinary isolated build networking, with no Bake entitlement grants.
  return `context: ${JSON.stringify(repoRoot)}${network === "host" ? "\n      network: host" : ""}`;
}
