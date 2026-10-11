import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAX_REVIEW_BUNDLE_BYTES,
  validateSpecImportGoldReviewBundle,
  type SpecImportGoldReviewReport,
} from "@workspace/ai-evaluation/spec-import-gold-review";

type CliDependencies = {
  repositoryRoot: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepositoryRoot = path.resolve(path.dirname(scriptPath), "../..");

function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function blockedReport(issueCode: string): SpecImportGoldReviewReport {
  return {
    format: "spec-import-gold-review-aggregate",
    version: 1,
    status: "blocked",
    provenance: {
      parseVersion: null,
      systemPromptSha256: null,
      scope: "provided_private_bundle_only",
    },
    caseCounts: null,
    fieldCounts: null,
    authorization: "not_verified",
    accessControl: "not_verified",
    privacyReview: "not_approved",
    unreviewedPrivateStoreCaseCount: null,
    unreviewedPrivateStoreCaseCountStatus: "unknown_not_accessed",
    issueCodes: [issueCode],
  };
}

function parseBundleArgument(args: string[]): { help: boolean; bundlePath?: string; error?: string } {
  if (args[0] === "--") args = args.slice(1);
  let bundlePath: string | undefined;
  let help = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--bundle" && index + 1 < args.length && !args[index + 1]!.startsWith("--")) {
      if (bundlePath) return { help: false, error: "duplicate_bundle_argument" };
      bundlePath = args[index + 1];
      index += 1;
    } else {
      return { help: false, error: "invalid_command_arguments" };
    }
  }
  return { help, ...(bundlePath ? { bundlePath } : {}) };
}

export function runSpecImportGoldReviewCli(
  args: string[],
  dependencies: CliDependencies = {
    repositoryRoot: defaultRepositoryRoot,
    stdout: (text) => console.log(text),
    stderr: (text) => console.error(text),
  },
): number {
  const parsed = parseBundleArgument(args);
  if (parsed.help) {
    dependencies.stdout(
      "Usage: pnpm --filter @workspace/scripts run spec-import-gold-review -- --bundle /absolute/private/review-bundle.json\n"
      + "The bundle must be outside the repository. Output contains minimized aggregates only.",
    );
    return 0;
  }
  if (parsed.error) {
    dependencies.stdout(JSON.stringify(blockedReport(parsed.error)));
    return 2;
  }
  if (!parsed.bundlePath) {
    dependencies.stdout(JSON.stringify(blockedReport("private_review_bundle_required")));
    return 2;
  }
  if (!path.isAbsolute(parsed.bundlePath)) {
    dependencies.stdout(JSON.stringify(blockedReport("bundle_path_must_be_absolute")));
    return 2;
  }

  let privateBundlePath: string;
  let repositoryRoot: string;
  try {
    privateBundlePath = fs.realpathSync(parsed.bundlePath);
    repositoryRoot = fs.realpathSync(dependencies.repositoryRoot);
  } catch {
    dependencies.stdout(JSON.stringify(blockedReport("review_bundle_unavailable")));
    return 2;
  }
  if (isWithin(repositoryRoot, privateBundlePath)) {
    dependencies.stdout(JSON.stringify(blockedReport("bundle_must_be_outside_repository")));
    return 2;
  }

  let raw: string;
  try {
    const stat = fs.statSync(privateBundlePath);
    if (!stat.isFile()) {
      dependencies.stdout(JSON.stringify(blockedReport("review_bundle_unavailable")));
      return 2;
    }
    if (stat.size > MAX_REVIEW_BUNDLE_BYTES) {
      dependencies.stdout(JSON.stringify(blockedReport("review_bundle_size_limit_exceeded")));
      return 2;
    }
    raw = fs.readFileSync(privateBundlePath, "utf8");
  } catch {
    dependencies.stdout(JSON.stringify(blockedReport("review_bundle_unavailable")));
    return 2;
  }

  let bundle: unknown;
  try {
    bundle = JSON.parse(raw) as unknown;
  } catch {
    dependencies.stdout(JSON.stringify(blockedReport("review_bundle_schema_invalid")));
    return 2;
  }
  const validation = validateSpecImportGoldReviewBundle(bundle);
  dependencies.stdout(JSON.stringify(validation.report));
  return validation.valid ? 0 : 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  process.exitCode = runSpecImportGoldReviewCli(process.argv.slice(2));
}
