import { sealBuildIdentity } from "./build-source-identity.mjs";

try {
  const info = sealBuildIdentity();
  console.log(JSON.stringify({ status: "sealed", appBuildId: info.appBuildId,
    sourceFingerprintSha256: info.sourceFingerprintSha256, gitBinding: info.gitBinding }));
} catch {
  console.error("Build identity could not be sealed. Rebuild both API and web from the prepared source.");
  process.exitCode = 1;
}