import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

type DbModule = typeof import("@workspace/db");

let pool: DbModule["pool"];
let adminPool: pg.Pool;
let getAuditLogProtectionCheck: typeof import("./health")["getAuditLogProtectionCheck"];
let testDbName = "";
let originalDatabaseUrl: string | undefined;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) {
    throw new Error("DATABASE_URL must be set to run integration tests");
  }

  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  adminPool.on("error", () => {});
  testDbName = `helium_health_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await adminPool.query(`CREATE DATABASE "${testDbName}"`);

  const testUrl = new URL(originalDatabaseUrl);
  testUrl.pathname = `/${testDbName}`;
  const testUrlString = testUrl.toString();
  const push = spawnSync("pnpm", ["--filter", "@workspace/db", "run", "push-force"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: testUrlString },
    encoding: "utf8",
  });
  if (push.status !== 0) {
    throw new Error(`drizzle push failed:\n${push.stdout}\n${push.stderr}`);
  }

  process.env.DATABASE_URL = testUrlString;
  const dbMod = await import("@workspace/db");
  pool = dbMod.pool;
  ({ getAuditLogProtectionCheck } = await import("./health"));
});

afterAll(async () => {
  if (pool) await pool.end();
  if (adminPool) {
    if (testDbName) {
      await adminPool.query(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`);
    }
    await adminPool.end();
  }
  process.env.DATABASE_URL = originalDatabaseUrl;
}, 60_000);

describe("audit append-only protection readiness", () => {
  it("reports a protected disposable database as ready", async () => {
    await expect(getAuditLogProtectionCheck()).resolves.toEqual({ status: "ok" });
  });

  it("reports a deliberately unprotected database with the missing objects", async () => {
    await pool.query("DROP TRIGGER IF EXISTS audit_logs_append_only_guard ON public.audit_logs");
    await pool.query("DROP FUNCTION IF EXISTS public.redact_audit_log(integer, jsonb)");
    await pool.query("DROP FUNCTION IF EXISTS public.delete_audit_log(integer, text)");
    await pool.query("DROP FUNCTION IF EXISTS public.audit_logs_append_only_guard()");

    await expect(getAuditLogProtectionCheck()).resolves.toEqual({
      status: "error",
      detail: "audit_append_only_protection_missing: append-only trigger, guard function, redact_audit_log(integer,jsonb), delete_audit_log(integer,text)",
    });
  });
});