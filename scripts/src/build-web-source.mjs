import path from "node:path";
import {
  buildSourceRecord, completeBuildStage, PROJECT_ROOT, readBoundedJson, validateSourceRecord, writeRecord,
} from "./build-source-identity.mjs";

const startFile = path.join(PROJECT_ROOT, ".local/build-identity/web-stage-start.json");
try {
  if (process.argv.length !== 3) throw new Error("Invalid web build identity arguments.");
  if (process.argv[2] === "--start") {
    writeRecord(startFile, buildSourceRecord());
  } else if (process.argv[2] === "--complete") {
    completeBuildStage(PROJECT_ROOT, validateSourceRecord(readBoundedJson(startFile)), "web");
  } else {
    throw new Error("Invalid web build identity stage.");
  }
} catch {
  console.error("Web build identity is incomplete or stale. Run prepare:publish and rebuild both application stages.");
  process.exitCode = 1;
}