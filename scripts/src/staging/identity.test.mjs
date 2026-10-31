import { test } from "node:test";
import assert from "node:assert/strict";
import { assertStageIdentity, assertStageApp, stageEnvironment } from "./identity.mjs";

const runId = "a".repeat(32);
const expected = { kind: "isolated-local-staging", runId, host: "127.0.0.1",
  database: `stage_${runId}`, port: 15432, dataDirectory: "/private/new/pg",
  systemIdentifier: "1234567890123456789",
  build: { appBuildId: "app-build:stage", sourceFingerprintSha256: "b".repeat(64) } };
const database = { ...expected, owner: "postgres" };
const app = { ...expected.build, runId, buildMode: "development",
  platformDeploymentId: null, platformBuildId: null };

test("only the independently matched stage database and app are accepted", () => {
  assertStageIdentity(expected, database);
  assertStageApp(expected, app);
});
for (const [name, patch] of Object.entries({
  unknown: { database: undefined }, development: { database: "development" },
  production: { database: "production" }, remote: { host: "example.org" },
  foreignCluster: { systemIdentifier: "9876543210123456789" },
  foreignDirectory: { dataDirectory: "/shared/pg" }, foreignPort: { port: 5432 },
  missingRun: { runId: null }, foreignOwner: { owner: "shared" },
})) {
  test(`database preflight rejects ${name} before write callback`, () => {
    let writes = 0;
    assert.throws(() => { assertStageIdentity(expected, { ...database, ...patch }); writes++; });
    assert.equal(writes, 0);
  });
}
for (const [name, patch] of Object.entries({
  unknown: { appBuildId: null }, oldBuild: { appBuildId: "app-build:old" },
  changedSource: { sourceFingerprintSha256: "c".repeat(64) },
  foreignRun: { runId: "f".repeat(32) }, published: { platformDeploymentId: "published" },
  platformBuild: { platformBuildId: "real-platform-build" }, release: { buildMode: "release" },
})) {
  test(`app preflight rejects ${name}`, () => assert.throws(() => assertStageApp(expected, { ...app, ...patch })));
}
test("development/production/unknown classifications cannot opt into staging", () => {
  for (const kind of ["development", "production", undefined]) {
    assert.throws(() => assertStageIdentity({ ...expected, kind }, database));
    assert.throws(() => assertStageApp({ ...expected, kind }, app));
  }
});
test("child environments do not inherit credentials or target URLs", () => {
  const env = stageEnvironment({ PATH: "/bin", DATABASE_URL: "DO-NOT-COPY",
    PGPASSWORD: "DO-NOT-COPY", SESSION_SECRET: "DO-NOT-COPY",
    AI_INTEGRATIONS_GEMINI_API_KEY: "DO-NOT-COPY", REPLIT_DEPLOYMENT_ID: "prod",
    PRODUCTION_MANAGER_PASSWORD: "DO-NOT-COPY", NODE_OPTIONS: "--import unsafe" });
  assert.equal(env.PATH, "/bin");
  assert.equal(Object.values(env).includes("DO-NOT-COPY"), false);
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.REPLIT_DEPLOYMENT_ID, undefined);
});
