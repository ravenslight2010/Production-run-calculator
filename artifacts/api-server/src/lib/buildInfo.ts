import { fileURLToPath } from "node:url";
import {
  readBoundedJson, validateBuildInfo, type BuildInfo,
} from "../../../../scripts/src/build-source-identity.mjs";

// In the bundled server import.meta.url is dist/index.mjs. Load once: neither
// later workspace edits nor runtime Git/version labels can change this identity.
function loadBuildInfo(): Readonly<BuildInfo> | null {
  try {
    const record = validateBuildInfo(readBoundedJson(
      fileURLToPath(new URL("./build-info.json", import.meta.url)),
    ));
    const identifier = (value: string | undefined): string | null =>
      value && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : null;
    const platformDeploymentId = identifier(process.env.REPLIT_DEPLOYMENT_ID);
    const platformBuildId = identifier(process.env.REPLIT_BUILD_ID);
    return Object.freeze({
      ...record, platformDeploymentId, platformBuildId,
      platformIdentitySource: platformDeploymentId || platformBuildId ? "runtime-reported" : "unavailable",
    });
  } catch {
    // The handler makes this unavailable state explicit with a safe 503.
    return null;
  }
}

const sealedBuildInfo = loadBuildInfo();
export const getBuildInfo = (): Readonly<BuildInfo> | null => sealedBuildInfo;

export type FieldCheckBuildIdentity = {
  appBuildId: string;
  revision: string;
  environment: "deployed" | "development" | "unknown";
};

export const UNKNOWN_FIELD_CHECK_BUILD_IDENTITY: Readonly<FieldCheckBuildIdentity> = Object.freeze({
  appBuildId: "unknown",
  revision: "unknown",
  environment: "unknown",
});

export function getFieldCheckBuildIdentity(): Readonly<FieldCheckBuildIdentity> {
  const info = getBuildInfo();
  if (!info) return UNKNOWN_FIELD_CHECK_BUILD_IDENTITY;
  const deploymentMarker = process.env.REPLIT_DEPLOYMENT?.trim().toLowerCase();
  const deployed = Boolean(info.platformDeploymentId) ||
    deploymentMarker === "1" || deploymentMarker === "true" || deploymentMarker === "yes";
  return Object.freeze({
    appBuildId: info.appBuildId,
    revision: info.gitBinding === "verified" && info.gitRevision
      ? info.gitRevision
      : "unknown",
    environment: deployed ? "deployed"
      : info.buildMode === "development" ? "development"
        : "unknown",
  });
}