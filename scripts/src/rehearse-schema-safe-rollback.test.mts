import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function run(): Promise<void> {
  const rehearsal = await readFile(
    new URL("./rehearse-schema-safe-rollback.mts", import.meta.url),
    "utf8",
  );
  const runtime = await readFile(
    new URL("../../artifacts/api-server/src/index.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    rehearsal,
    /schemaSnapshot\("after-migration"\)[\s\S]*?schemaSnapshot\("after-current-runtime"\)[\s\S]*?schemaSnapshot\("after-parent-runtime"\)/,
    "the rehearsal must snapshot the migrated database, current runtime, and parent runtime separately",
  );
  assert.match(
    rehearsal,
    /public schema changed while starting the current runtime/,
    "the rehearsal must distinguish a current-runtime schema mutation from a rollback mutation",
  );
  assert.match(
    rehearsal,
    /captureSchemaDifference\("after-current-runtime", "after-parent-runtime"\)/,
    "a rollback schema failure must retain the actual schema diff",
  );
  assert.doesNotMatch(
    runtime,
    /drizzle-kit|RUN_DB_MIGRATION|applyDatabaseSchema|spawnSync/,
    "the long-lived API runtime must not contain a schema-migration path",
  );
}

await run();