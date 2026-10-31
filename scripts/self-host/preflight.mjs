// Read-only prerequisite diagnostics. Never a replacement for build/release gates.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  fingerprintSource,
  SELF_HOST_FRESH_SOURCE_POLICY,
} from "../src/build-source-files.mjs";
import {
  REPORT_DIRECTORY,
  REPORT_BASENAME,
  REVIEWED_REPORT_SHA256,
} from "./reviewed-input-contract.mjs";
import { validateSetup } from "./config.mjs";

function boundedFile(root, relative, maximum) {
  let file = root;
  for (const part of relative.split("/")) {
    file = path.join(file, part);
    if (lstatSync(file).isSymbolicLink()) throw new Error("unsafe-input");
  }
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.size > maximum) throw new Error("unsafe-input");
  const bytes = readFileSync(file);
  if (bytes.length > maximum) throw new Error("unsafe-input");
  return bytes;
}

// Explicit dependency injection is for synthetic unit fixtures only. The CLI
// defaults to the real production contract; explicit fresh builds omit the legacy
// audit only. No env/argument can override the production pin.
export function inspectPreflight(
  directory,
  {
    runtimeVersion = process.versions.node,
    setup,
    profile = "production",
    expectedReportSha256 = REVIEWED_REPORT_SHA256,
  } = {},
) {
  if (!["production", "self-host-fresh"].includes(profile))
    return {
      status: "blocked",
      checks: [
        {
          id: "build-profile",
          status: "blocked",
          code: "unsupported-build-profile",
        },
      ],
      scope: "build-prerequisites-only",
      productionReadiness: "not-assessed",
    };
  const root = path.resolve(directory);
  const checks = [];
  const add = (id, status, code) => checks.push({ id, status, code });
  try {
    if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink())
      throw new Error();
    add("checkout", "pass", "directory-readable");
  } catch {
    return {
      status: "blocked",
      checks: [
        {
          id: "checkout",
          status: "blocked",
          code: "checkout-unavailable-or-unsafe",
        },
      ],
      scope: "build-prerequisites-only",
      productionReadiness: "not-assessed",
    };
  }
  try {
    const pin = boundedFile(root, ".nvmrc", 64).toString("utf8").trim();
    if (!/^\d+\.\d+\.\d+$/.test(pin) || runtimeVersion !== pin)
      throw new Error();
    add("node-version", "pass", "exact-project-pin");
  } catch {
    add("node-version", "blocked", "exact-project-node-required");
  }
  if (setup !== undefined) {
    try {
      validateSetup(setup);
      add("configuration", "pass", "setup-values-valid");
    } catch {
      add("configuration", "blocked", "invalid-site-timezone-or-manager");
    }
  }
  if (profile === "self-host-fresh") {
    add(
      "reviewed-source-report",
      "not-applicable",
      "legacy-audit-not-packaged",
    );
  } else {
    const report = `${REPORT_DIRECTORY}/${REPORT_BASENAME}.json`;
    const digestFile = `${REPORT_DIRECTORY}/${REPORT_BASENAME}.sha256`;
    try {
      const bytes = boundedFile(root, report, 1024 * 1024);
      const declared = boundedFile(root, digestFile, 128)
        .toString("utf8")
        .trim();
      const actual = createHash("sha256").update(bytes).digest("hex");
      if (
        !/^[a-f0-9]{64}$/.test(expectedReportSha256) ||
        declared !== expectedReportSha256 ||
        actual !== expectedReportSha256
      )
        throw new Error("pin-mismatch");
      add("reviewed-source-report", "pass", "reviewed-digest-matches");
    } catch (error) {
      add(
        "reviewed-source-report",
        "blocked",
        error.code === "ENOENT"
          ? "approved-private-report-missing"
          : "reviewed-report-invalid-or-unsafe",
      );
    }
  }
  try {
    if (profile === "self-host-fresh")
      fingerprintSource(root, SELF_HOST_FRESH_SOURCE_POLICY);
    else fingerprintSource(root);
    add("build-source-inputs", "pass", "source-prerequisites-readable");
  } catch {
    add(
      "build-source-inputs",
      "blocked",
      "source-prerequisites-missing-or-unsafe",
    );
  }
  return {
    status: checks.every(
      (check) => check.status === "pass" || check.status === "not-applicable",
    )
      ? "ready"
      : "blocked",
    checks,
    scope: "build-prerequisites-only",
    productionReadiness: "not-assessed",
    profile,
  };
}

export function parseArguments(args) {
  const values = new Map();
  const allowed = new Set([
    "--root",
    "--site",
    "--time-zone",
    "--manager",
    "--profile",
  ]);
  for (let i = 0; i < args.length; i += 2) {
    if (
      !allowed.has(args[i]) ||
      values.has(args[i]) ||
      !args[i + 1] ||
      args[i + 1].startsWith("--")
    )
      throw new Error("invalid-arguments");
    values.set(args[i], args[i + 1]);
  }
  if (!values.has("--root")) throw new Error("invalid-arguments");
  const setupKeys = ["--site", "--time-zone", "--manager"];
  const count = setupKeys.filter((key) => values.has(key)).length;
  if (count !== 0 && count !== 3) throw new Error("invalid-arguments");
  const profile = values.get("--profile") ?? "production";
  if (!["production", "self-host-fresh"].includes(profile))
    throw new Error("invalid-arguments");
  return {
    root: values.get("--root"),
    profile,
    setup: count
      ? {
          site: values.get("--site"),
          timeZone: values.get("--time-zone"),
          manager: values.get("--manager"),
        }
      : undefined,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const { root, setup, profile } = parseArguments(process.argv.slice(2));
    const result = inspectPreflight(root, { setup, profile });
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "ready") process.exitCode = 2;
  } catch {
    // Do not echo paths, raw errors, argument values or environment contents.
    console.error(
      JSON.stringify({ status: "blocked", code: "invalid-preflight-request" }),
    );
    process.exitCode = 2;
  }
}
