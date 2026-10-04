import { preparePublishSource } from "./build-source-identity.mjs";

try {
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  if (args.some((arg) => arg !== "--reuse-current") || args.length > 1)
    throw new Error("Use prepare:publish with optional --reuse-current only.");
  const record = preparePublishSource(undefined, { reuse: args.includes("--reuse-current") });
  console.log(JSON.stringify({ status: "prepared", appBuildId: record.appBuildId,
    sourceFingerprintSha256: record.sourceFingerprintSha256, gitRevision: record.gitRevision,
    gitBinding: record.gitBinding, expectedRecord: ".local/build-identity/expected-source.json" }));
} catch (error) {
  const reason = error instanceof Error &&
    error.message === "Build source changed. Run prepare:publish again before publishing."
    ? error.message : "Check that the required source inputs are readable and contain no unsafe symlinks.";
  console.error(`Build source preparation failed. ${reason}`);
  process.exitCode = 1;
}