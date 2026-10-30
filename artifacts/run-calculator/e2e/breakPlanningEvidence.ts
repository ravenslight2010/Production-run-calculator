/** WebKit reports cancelled old-document fetches as access-control messages.
 * Only recognize observed API origins, exact paths and a recorded navigation.
 * Real request failures and save responses are checked independently.
 */
export function cancelledDocumentMessage(input: {
  webkit: boolean;
  text: string;
  successfulOrigins: ReadonlySet<string>;
  navigationPaths: ReadonlySet<string>;
  duringReload: boolean;
}): string | undefined {
  if (!input.webkit || !input.text.endsWith("due to access control checks.")) return;
  const paths = [
    "/api/incidents/actionable-count",
    "/api/incidents",
    "/api/field-checks/observations",
    "/api/sync/today",
    "/api/sync/auto-track/claim",
    "/api/factory-data",
  ];
  for (const origin of input.successfulOrigins) {
    const host = new URL(origin).host;
    const path = paths.find(path =>
      input.text.includes(`${host}${path} `) || input.text.includes(`${host}${path}?`));
    if (path && (input.duringReload || input.navigationPaths.has(path))) return path;
  }
}
