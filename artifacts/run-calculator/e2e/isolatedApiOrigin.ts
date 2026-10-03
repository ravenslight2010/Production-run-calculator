const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Authorized browser fixtures must use the local API process started with the
 * isolated DATABASE_URL. A web preview or remote dev domain can point fixture
 * signup at a different database than the test process can clean up.
 */
export function requireLocalFixtureApiOrigin(
  operation: string,
  configured = process.env.PLAYWRIGHT_API_BASE_URL,
): string {
  if (!configured?.trim()) {
    throw new Error(
      `${operation} requires PLAYWRIGHT_API_BASE_URL for the isolated local API server.`,
    );
  }

  let url: URL;
  try {
    url = new URL(configured.trim());
  } catch {
    throw new Error(`${operation} requires a valid local PLAYWRIGHT_API_BASE_URL.`);
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    url.protocol !== "http:" ||
    !LOCAL_HOSTS.has(hostname) ||
    url.username ||
    url.password ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `${operation} requires PLAYWRIGHT_API_BASE_URL to be a local HTTP origin bound to the isolated DATABASE_URL.`,
    );
  }

  return url.origin;
}