// Regenerate the corpus snapshots after an INTENTIONAL importer change:
//   pnpm --filter @workspace/corpus-harness run snapshots
// Review the resulting JSON diff like code before committing.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SNAPSHOT_BUILDERS } from "./index.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "snapshots");
fs.mkdirSync(dir, { recursive: true });
for (const [name, build] of Object.entries(SNAPSHOT_BUILDERS)) {
  const file = path.join(dir, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(build(), null, 2) + "\n");
  console.log("wrote", file);
}
