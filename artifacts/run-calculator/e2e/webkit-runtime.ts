import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const NIX_LIBRARY_ATTRIBUTES = ["gcc.cc.lib", "libglvnd", "x264.lib"] as const;

function resolveNixLibraryPath(): string | undefined {
  const configured = process.env.PLAYWRIGHT_WEBKIT_LIBRARY_PATH?.trim();
  if (configured) return configured;
  // Release gates run with CI=true even in the Replit Nix workspace. Keep the
  // local Nix wrapper there, but leave ordinary CI hosts on Playwright's
  // installed system libraries.
  if (process.env.CI && !process.env.REPLIT_DEV_DOMAIN) return undefined;

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

function resolveGioModulePath(): string | undefined {
  const configured = process.env.GIO_EXTRA_MODULES?.trim();
  if (configured) return configured;

  try {
    const outputPath = execFileSync(
      "nix",
      [
        "build",
        "--no-link",
        "--print-out-paths",
        "nixpkgs#glib-networking",
      ],
      { encoding: "utf8" },
    )
      .trim()
      .split(/\s+/)
      .at(-1);
    if (outputPath) return `${outputPath}/lib/gio/modules`;
  } catch (error) {
    throw new Error(
      "Unable to load WebKit's GIO TLS modules from nixpkgs#glib-networking.",
      { cause: error },
    );
  }

  throw new Error(
    "nixpkgs#glib-networking did not provide a GIO module path for WebKit.",
  );
}

export function webkitLaunchOptions():
  | { executablePath: string; env: NodeJS.ProcessEnv }
  | undefined {
  const nixLibraryPath = resolveNixLibraryPath();
  if (!nixLibraryPath) return undefined;

  const gioModulePath = resolveGioModulePath();
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
  process.env.GIO_EXTRA_MODULES = gioModulePath;
  process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = skipHostValidation;

  return {
    executablePath: fileURLToPath(
      new URL("./run-playwright-webkit-nix.sh", import.meta.url),
    ),
    env: {
      ...process.env,
      LD_LIBRARY_PATH: libraryPath,
      GIO_EXTRA_MODULES: gioModulePath,
      // Replit's Nix libraries are available to the browser process, but are
      // not registered in the host's Debian package database. Playwright's
      // runtime launch is the authoritative check in this environment.
      PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS: skipHostValidation,
    },
  };
}
