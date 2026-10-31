import path from "node:path";
import {
  buildSourceRecord, completeBuildStage, PROJECT_ROOT, readBoundedJson, validateSourceRecord, writeRecord,
} from "./build-source-identity.mjs";

const fresh = process.env.BUILD_IDENTITY_MODE === "self-host-fresh";
const startFile = path.join(PROJECT_ROOT, fresh ? ".local/build-identity/self-host-web-stage-start.json" : ".local/build-identity/web-stage-start.json");
try {
  if (process.argv.length !== 3) throw new Error("Invalid web build identity arguments.");
  const identityMode = process.env.BUILD_IDENTITY_MODE;
  if (identityMode !== undefined && identityMode !== "development" && identityMode !== "publish" && identityMode !== "self-host-fresh") {
    throw new Error("Invalid web build identity mode.");
  }
  const { buildFreshSourceRecord, completeFreshBuildStage, validateFreshSourceRecord } = fresh
    ? await import("../self-host/build-identity.mjs") : {};
  if (process.argv[2] === "--start") {
    writeRecord(startFile, fresh ? buildFreshSourceRecord(PROJECT_ROOT) : buildSourceRecord(PROJECT_ROOT, identityMode ?? "publish"));
  } else if (process.argv[2] === "--complete") {
    if (fresh) completeFreshBuildStage(PROJECT_ROOT, validateFreshSourceRecord(readBoundedJson(startFile)), "web");
    else completeBuildStage(PROJECT_ROOT, validateSourceRecord(readBoundedJson(startFile)), "web");
  } else {
    throw new Error("Invalid web build identity stage.");
  }
} catch {
  console.error("Web build identity is incomplete or stale. Run prepare:publish and rebuild both application stages.");
  process.exitCode = 1;
}