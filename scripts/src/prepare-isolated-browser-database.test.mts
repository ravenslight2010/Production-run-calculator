import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDisposableBrowserDatabase,
  prepareIsolatedBrowserDatabase,
} from "./prepare-isolated-browser-database.mts";

const remoteUrl = "postgresql://user:password@db.example.test/shared";

test("accepts local and explicitly named disposable databases", () => {
  assert.equal(
    assertDisposableBrowserDatabase({
      DATABASE_URL: "postgresql://user:password@localhost/app",
    }).hostname,
    "localhost",
  );
  assert.equal(
    assertDisposableBrowserDatabase({
      DATABASE_URL: "postgresql://user:password@db.example.test/browser-e2e",
    }).pathname,
    "/browser-e2e",
  );
});

test("rejects a shared remote database by default", () => {
  assert.throws(
    () => assertDisposableBrowserDatabase({ DATABASE_URL: remoteUrl }),
    /Refusing to prepare a shared database/,
  );
});

test("allows a verified disposable environment only with both approval flags", () => {
  assert.throws(
    () =>
      assertDisposableBrowserDatabase({
        DATABASE_URL: remoteUrl,
        E2E_TEST_DB: "1",
      }),
    /Refusing to prepare a shared database/,
  );
  assert.doesNotThrow(() =>
    assertDisposableBrowserDatabase({
      DATABASE_URL: remoteUrl,
      E2E_TEST_DB: "1",
      E2E_APPROVED_DESTRUCTIVE_MODE: "1",
    })
  );
});

test("production markers override every disposable approval signal", () => {
  for (const marker of [
    { NODE_ENV: "production" },
    { APP_ENV: "prod" },
    { REPLIT_DEPLOYMENT: "1" },
  ]) {
    assert.throws(
      () =>
        assertDisposableBrowserDatabase({
          DATABASE_URL: "postgresql://user:password@localhost/browser-e2e",
          E2E_TEST_DB: "1",
          E2E_APPROVED_DESTRUCTIVE_MODE: "1",
          ...marker,
        }),
      /production environment/,
    );
  }
});

test("applies the canonical schema before starting the API", async () => {
  const calls: string[] = [];
  await prepareIsolatedBrowserDatabase(
    { DATABASE_URL: "postgresql://user:password@localhost/browser-e2e" },
    async (command, args) => {
      calls.push([command, ...args].join(" "));
    },
  );
  assert.deepEqual(calls, [
    "pnpm --filter @workspace/db run push-force",
    "pnpm --filter @workspace/api-server run dev:without-schema-push",
  ]);
});

test("rejects missing, malformed, and non-PostgreSQL URLs", () => {
  assert.throws(() => assertDisposableBrowserDatabase({}), /DATABASE_URL is required/);
  assert.throws(
    () => assertDisposableBrowserDatabase({ DATABASE_URL: "not a URL" }),
    /valid PostgreSQL/,
  );
  assert.throws(
    () =>
      assertDisposableBrowserDatabase({
        DATABASE_URL: "mysql://user:password@localhost/browser-e2e",
      }),
    /postgres or postgresql/,
  );
});