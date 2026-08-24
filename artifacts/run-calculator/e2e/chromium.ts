import { execFileSync } from "node:child_process";

/**
 * Replit's Nix environment provides Chromium system-wide instead of through
 * Playwright's browser cache. Keep an explicit env override for CI and
 * connected-browser jobs, then discover the local executable for the normal
 * release command.
 */
export function resolveChromiumExecutable(): string {
  const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  if (configured) return configured;

  try {
    const executable = execFileSync(
      "sh",
      [
        "-lc",
        "command -v chromium || command -v chromium-browser || command -v google-chrome",
      ],
      { encoding: "utf8" },
    ).trim();
    if (executable) return executable;
  } catch {
    // Use a purpose-built error below instead of Playwright's less actionable
    // browser launch error.
  }

  throw new Error(
    "No Chromium executable found. Install Chromium or set " +
      "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to an executable browser path.",
  );
}