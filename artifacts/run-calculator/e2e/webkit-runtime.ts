import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const NIX_LIBRARY_ATTRIBUTES = ["gcc.cc.lib", "libglvnd", "x264.lib"] as const;

function resolveNixLibraryPath(): string | undefined {
  const configured = process.env.PLAYWRIGHT_WEBKIT_LIBRARY_PATH?.trim();
  if (configured) return configured;
  if (process.env.CI) return undefined;

  try {
    const paths = NIX_LIBRARY_ATTRIBUTES.map((attribute) => {
      const outputPath = execFileSync(
        "nix",
        ["eval", "--raw", `nixpkgs#${attribute}.outPath`],
        { encoding: "utf8" },
      ).trim();
      return `${outputPath}/lib`;
    });
    return paths.join(":");
  } catch {
    return undefined;
  }
}

export function webkitLaunchOptions():
  | { executablePath: string; env: NodeJS.ProcessEnv }
  | undefined {
  const nixLibraryPath = resolveNixLibraryPath();
  if (!nixLibraryPath) return undefined;

  const libraryPath = [
    nixLibraryPath,
    process.env.LD_LIBRARY_PATH,
  ]
    .filter(Boolean)
    .join(":");
  const skipHostValidation =
    process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS ?? "1";

  // Host validation runs before launchOptions.env is applied. Export the
  // scoped Nix values at config load time as well as to the browser child.
  process.env.LD_LIBRARY_PATH = libraryPath;
  process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = skipHostValidation;

  return {
    executablePath: fileURLToPath(
      new URL("./run-playwright-webkit-nix.sh", import.meta.url),
    ),
    env: {
      ...process.env,
      LD_LIBRARY_PATH: libraryPath,
      // Replit's Nix libraries are available to the browser process, but are
      // not registered in the host's Debian package database. Playwright's
      // runtime launch is the authoritative check in this environment.
      PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS: skipHostValidation,
    },
  };
}