import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertDevelopmentStartupAllowed,
  startApiDevelopment,
} from "./start-api-development.mts";

test("refuses confirmed deployments before invoking any command", async () => {
  for (const marker of [
    { REPLIT_DEPLOYMENT: "1" },
    { REPLIT_DEPLOYMENT: "true" },
    { REPLIT_DEPLOYMENT_ID: "deployment-id" },
  ]) {
    const calls: string[] = [];
    await assert.rejects(
      startApiDevelopment(marker, async (command, args) => {
        calls.push([command, ...args].join(" "));
      }),
      /schema push was not invoked/,
    );
    assert.deepEqual(calls, []);
  }
});

test("does not treat REPLIT_ENVIRONMENT=production alone as a deployment", () => {
  assert.doesNotThrow(() =>
    assertDevelopmentStartupAllowed({
      REPLIT_ENVIRONMENT: "production",
      DATABASE_URL: "postgresql://user@remote.example/shared-development",
    })
  );
});

test("runs schema synchronization before the development server", async () => {
  const calls: string[] = [];
  await startApiDevelopment(
    { REPLIT_ENVIRONMENT: "development" },
    async (command, args) => {
      calls.push([command, ...args].join(" "));
    },
  );
  assert.deepEqual(calls, [
    "pnpm --filter @workspace/db run push-force",
    "pnpm --filter @workspace/api-server run dev:without-schema-push",
  ]);
});

test("the ordinary API dev command enters the guarded runner first", async () => {
  const packageJson = JSON.parse(
    await readFile(
      new URL("../../artifacts/api-server/package.json", import.meta.url),
      "utf8",
    ),
  ) as { scripts?: Record<string, string> };

  assert.equal(
    packageJson.scripts?.dev,
    "../../scripts/node_modules/.bin/tsx ../../scripts/src/start-api-development.mts",
  );
  assert.doesNotMatch(packageJson.scripts?.dev ?? "", /push-force/);
});