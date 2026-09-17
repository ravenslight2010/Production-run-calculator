import assert from "node:assert/strict";
import { webkitLaunchOptions } from "./webkit-runtime.ts";

const previousConfigured = process.env.PLAYWRIGHT_WEBKIT_LIBRARY_PATH;
const previousLibraryPath = process.env.LD_LIBRARY_PATH;
const previousHostValidation =
  process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS;

try {
  process.env.PLAYWRIGHT_WEBKIT_LIBRARY_PATH =
    "  /configured/webkit:/configured/extra  ";
  process.env.LD_LIBRARY_PATH = "/existing/lib";
  delete process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS;

  const options = webkitLaunchOptions();
  assert.ok(options, "an explicit WebKit library path must enable the wrapper");
  assert.match(
    options.executablePath,
    /run-playwright-webkit-nix\.sh$/,
    "the launcher must use the repository WebKit wrapper",
  );
  assert.equal(
    options.env.LD_LIBRARY_PATH,
    "/configured/webkit:/configured/extra:/existing/lib",
    "the TypeScript launcher must preserve the trimmed configured path before inherited libraries",
  );
  assert.equal(
    process.env.LD_LIBRARY_PATH,
    options.env.LD_LIBRARY_PATH,
    "host validation and the browser child must receive the same library path",
  );
  assert.equal(
    options.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS,
    "1",
    "the local wrapper launch must retain the host-validation bypass",
  );
} finally {
  if (previousConfigured === undefined) {
    delete process.env.PLAYWRIGHT_WEBKIT_LIBRARY_PATH;
  } else {
    process.env.PLAYWRIGHT_WEBKIT_LIBRARY_PATH = previousConfigured;
  }
  if (previousLibraryPath === undefined) {
    delete process.env.LD_LIBRARY_PATH;
  } else {
    process.env.LD_LIBRARY_PATH = previousLibraryPath;
  }
  if (previousHostValidation === undefined) {
    delete process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS;
  } else {
    process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS =
      previousHostValidation;
  }
}

console.log("WebKit runtime launcher tests passed.");