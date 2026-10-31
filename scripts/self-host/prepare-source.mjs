import { PROJECT_ROOT } from "../src/build-source-identity.mjs";
import { prepareFreshSource } from "./build-identity.mjs";
try {
  if (process.argv.length !== 2) throw new Error();
  const record = prepareFreshSource(PROJECT_ROOT);
  console.log(
    JSON.stringify({
      status: "prepared",
      buildProfile: record.mode,
      sourceFingerprintSha256: record.sourceFingerprintSha256,
      gitBinding: record.gitBinding,
    }),
  );
} catch {
  console.error(
    "Fresh source preparation failed; required inputs must be present and unchanged.",
  );
  process.exitCode = 1;
}
