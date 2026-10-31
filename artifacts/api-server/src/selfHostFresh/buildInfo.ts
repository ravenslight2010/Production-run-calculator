import { fileURLToPath } from "node:url";
import { readBoundedJson } from "../../../../scripts/src/build-source-identity.mjs";
import {
  validateFreshBuildInfo,
  type FreshBuildInfo,
} from "../../../../scripts/self-host/build-identity.mjs";
function load(): Readonly<FreshBuildInfo> | null {
  try {
    return Object.freeze(
      validateFreshBuildInfo(
        readBoundedJson(
          fileURLToPath(new URL("./build-info.json", import.meta.url)),
        ),
      ),
    );
  } catch {
    return null;
  }
}
// No Replit/runtime environment labels can convert this profile into a release.
const sealed = load();
export const getBuildInfo = (): Readonly<FreshBuildInfo> | null => sealed;
