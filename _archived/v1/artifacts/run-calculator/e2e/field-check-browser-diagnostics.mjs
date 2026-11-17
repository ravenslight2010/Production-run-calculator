/**
 * WPE splits network-console messages at the first colon into Error.name/message.
 * Classify (never discard) only the two observed, same-origin reload diagnostics.
 * The caller must additionally verify fresh successful reads after each reload.
 */
export function reloadNetworkPath(error, { engine, reloading, origin }) {
  if (engine !== "webkit" || !reloading || !/^Fetch API cannot load https?$/.test(error.name)) return null;
  const suffix = " due to access control checks.";
  if (!error.message.endsWith(suffix)) return null;
  try {
    const protocol = error.name.slice("Fetch API cannot load ".length);
    const url = new URL(`${protocol}:/${error.message.slice(0, -suffix.length)}`);
    return url.origin === origin && ["/api/incidents", "/api/factory-data"].includes(url.pathname)
      ? url.pathname
      : null;
  } catch {
    return null;
  }
}
