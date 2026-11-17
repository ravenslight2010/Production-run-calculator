/**
 * WPE projects javascript-source network console messages as pageerror and
 * splits their first colon into Error.name/message. Retain these diagnostics,
 * but do not make a scoped QC test certify unrelated background endpoints.
 * This identifies the message, not its underlying cause or harmlessness.
 */
export function isBackgroundWebKitNetworkDiagnostic(error, engine) {
  if (engine !== "webkit" || !/^Fetch API cannot load https?$/.test(error.name)) return false;
  const suffix = " due to access control checks.";
  if (!error.message.endsWith(suffix)) return false;
  try {
    const protocol = error.name.slice("Fetch API cannot load ".length);
    const url = new URL(`${protocol}:/${error.message.slice(0, -suffix.length)}`);
    return ["127.0.0.1", "localhost"].includes(url.hostname)
      && ["/api/me", "/app-build.json", "/api/incidents", "/api/field-checks/observations"].includes(url.pathname);
  } catch {
    return false;
  }
}
