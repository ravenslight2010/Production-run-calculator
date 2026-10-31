import path from "node:path";
import {
  PROJECT_ROOT,
  readBoundedJson,
} from "../src/build-source-identity.mjs";
import { sealFreshBuildIdentity } from "./build-identity.mjs";
import { FRESH_RUNTIME_BUILD_CONTRACT } from "./runtime-build-policy.mjs";
try {
  if (process.argv.length !== 2) throw new Error();
  const contract = readBoundedJson(
    path.join(
      PROJECT_ROOT,
      "artifacts/api-server/dist/self-host-build-contract.json",
    ),
  );
  if (JSON.stringify(contract) !== JSON.stringify(FRESH_RUNTIME_BUILD_CONTRACT))
    throw new Error();
  const info = sealFreshBuildIdentity(PROJECT_ROOT);
  console.log(
    JSON.stringify({
      status: "sealed",
      buildProfile: info.buildMode,
      sourceFingerprintSha256: info.sourceFingerprintSha256,
      gitBinding: info.gitBinding,
    }),
  );
} catch {
  console.error(
    "Fresh identity could not be sealed; rebuild matching API/web stages with the fresh runtime boundary.",
  );
  process.exitCode = 1;
}
