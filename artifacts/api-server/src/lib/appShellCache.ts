import path from "node:path";

/** Mutable entry points must reach the origin, not an intermediary's old shell. */
export function setAppShellCacheHeaders(
  response: { setHeader: (name: string, value: string) => unknown },
  filePath: string,
): void {
  if (["index.html", "service-worker.js", "app-build.json", "manifest.webmanifest"]
    .includes(path.basename(filePath))) {
    response.setHeader("Cache-Control", "no-store");
  }
}
