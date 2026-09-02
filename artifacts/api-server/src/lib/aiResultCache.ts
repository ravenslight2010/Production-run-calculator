import { createHash } from "node:crypto";
import { and, desc, eq, lt } from "drizzle-orm";
import { aiResultCacheTable, db } from "@workspace/db";
import { currentScope } from "../lib/requestScope";

export const AI_RESULT_CACHE_NAMESPACE = "ai-results:v1";
export const AI_RESULT_CACHE_TTL_MS = 15 * 60_000;
export const AI_RESULT_CACHE_MAX_BYTES = 512 * 1024;
export const AI_RESULT_CACHE_MAX_ROWS = 1_000;

type CacheLogger = {
  debug?: (obj: unknown, msg?: string) => void;
  info?: (obj: unknown, msg?: string) => void;
  warn?: (obj: unknown, msg?: string) => void;
  error?: (obj: unknown, msg?: string) => void;
};

export type AiCacheLoadResult<T> = {
  value: T;
  /** False for provider/fallback outcomes that must not poison future hits. */
  cacheable?: boolean;
};

export type AiCacheResult<T> = {
  value: T;
  hit: boolean;
};

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableSerialize(child)}`);
  return `{${entries.join(",")}}`;
}

// Prompt builders preserve source ordering for readability, but list/object
// ordering is not part of the meaning of these read-only operations. Sorting
// prompt lines for the fingerprint lets equivalent requests share a result
// without changing the prompt sent to the provider.
function canonicalPrompt(prompt: string): string {
  return prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .join("\n");
}

/** Fingerprint the operation without retaining the prompt or any grounded text. */
export function fingerprintAiOperation(input: {
  operation: string;
  model: string;
  system: string;
  user: string;
}): string {
  return createHash("sha256")
    .update(
      stableSerialize({
        namespace: AI_RESULT_CACHE_NAMESPACE,
        operation: input.operation,
        model: input.model,
        system: input.system,
        user: canonicalPrompt(input.user),
      }),
    )
    .digest("hex");
}

type InFlightValue = Promise<AiCacheResult<unknown>>;
const inFlight = new Map<string, InFlightValue>();

export type AiResultCacheStore = {
  read: (scope: string, key: string) => Promise<{ value: unknown; expiresAt: Date } | null>;
  remove: (scope: string, key: string) => Promise<void>;
  write: (scope: string, key: string, value: unknown, expiresAt: Date) => Promise<void>;
  prune: (scope: string) => Promise<void>;
};

const databaseCacheStore: AiResultCacheStore = {
  async read(scope, key) {
    const rows = await db
      .select()
      .from(aiResultCacheTable)
      .where(
        and(
          eq(aiResultCacheTable.scope, scope),
          eq(aiResultCacheTable.namespace, AI_RESULT_CACHE_NAMESPACE),
          eq(aiResultCacheTable.operationKey, key),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? { value: row.result, expiresAt: row.expiresAt } : null;
  },
  async remove(scope, key) {
    await db
      .delete(aiResultCacheTable)
      .where(
        and(
          eq(aiResultCacheTable.scope, scope),
          eq(aiResultCacheTable.namespace, AI_RESULT_CACHE_NAMESPACE),
          eq(aiResultCacheTable.operationKey, key),
        ),
      );
  },
  async write(scope, key, value, expiresAt) {
    await db
      .insert(aiResultCacheTable)
      .values({
        scope,
        namespace: AI_RESULT_CACHE_NAMESPACE,
        operationKey: key,
        result: value,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: [
          aiResultCacheTable.scope,
          aiResultCacheTable.namespace,
          aiResultCacheTable.operationKey,
        ],
        set: { result: value, expiresAt, updatedAt: new Date() },
      });
  },
  async prune(scope) {
    await db
      .delete(aiResultCacheTable)
      .where(and(eq(aiResultCacheTable.scope, scope), lt(aiResultCacheTable.expiresAt, new Date())));
    const rows = await db
      .select({ id: aiResultCacheTable.id })
      .from(aiResultCacheTable)
      .where(eq(aiResultCacheTable.scope, scope))
      .orderBy(desc(aiResultCacheTable.updatedAt), desc(aiResultCacheTable.id));
    if (rows.length <= AI_RESULT_CACHE_MAX_ROWS) return;
    for (const row of rows.slice(AI_RESULT_CACHE_MAX_ROWS)) {
      await db.delete(aiResultCacheTable).where(eq(aiResultCacheTable.id, row.id));
    }
  },
};

function logFields(operation: string, key: string) {
  return { operation, key: key.slice(0, 12) };
}

async function executeCache<T>(opts: {
  operation: string;
  key: string;
  ttlMs?: number;
  validate: (value: unknown) => value is T;
  load: () => Promise<AiCacheLoadResult<T>>;
  log?: CacheLogger;
  store: AiResultCacheStore;
}): Promise<AiCacheResult<T>> {
  const scope = currentScope();
  const fields = logFields(opts.operation, opts.key);
  const now = new Date();

  try {
    const row = await opts.store.read(scope, opts.key);
    if (row && row.expiresAt > now) {
      if (opts.validate(row.value)) {
        opts.log?.debug?.(fields, "ai result cache hit");
        return { value: row.value, hit: true };
      }
      opts.log?.warn?.(fields, "ai result cache entry was malformed; ignoring");
      await opts.store.remove(scope, opts.key);
    } else if (row) {
      await opts.store.remove(scope, opts.key);
    }
  } catch (err) {
    // The cache is an optimization. A database outage must never change the
    // existing AI route's provider/fallback behavior.
    opts.log?.error?.({ err, ...fields }, "ai result cache read failed; bypassing");
  }

  opts.log?.debug?.(fields, "ai result cache miss");
  const loaded = await opts.load();
  if (loaded.cacheable === false) return { value: loaded.value, hit: false };

  let serialized: string;
  try {
    const encoded = JSON.stringify(loaded.value);
    if (typeof encoded !== "string") {
      throw new Error("result is not JSON-serializable");
    }
    serialized = encoded;
  } catch (err) {
    opts.log?.warn?.({ err, ...fields }, "ai result cache serialization failed; bypassing write");
    return { value: loaded.value, hit: false };
  }
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes > AI_RESULT_CACHE_MAX_BYTES) {
    opts.log?.warn?.({ ...fields, bytes }, "ai result cache result too large; bypassing write");
    return { value: loaded.value, hit: false };
  }

  try {
    const expiresAt = new Date(Date.now() + (opts.ttlMs ?? AI_RESULT_CACHE_TTL_MS));
    await opts.store.write(scope, opts.key, loaded.value, expiresAt);
    await opts.store.prune(scope);
  } catch (err) {
    opts.log?.error?.({ err, ...fields }, "ai result cache write failed; continuing");
  }
  return { value: loaded.value, hit: false };
}

/**
 * Read a validated result, or load/store one on a miss. Calls for the same
 * scope/operation/fingerprint share one promise in this process. Provider
 * failures propagate so the caller's existing error/fallback contract remains
 * authoritative and no failure is persisted.
 */
export async function getOrCreateAiResult<T>(opts: {
  operation: string;
  key: string;
  ttlMs?: number;
  validate: (value: unknown) => value is T;
  load: () => Promise<AiCacheLoadResult<T>>;
  log?: CacheLogger;
  store?: AiResultCacheStore;
}): Promise<AiCacheResult<T>> {
  const lockKey = `${currentScope()}:${AI_RESULT_CACHE_NAMESPACE}:${opts.key}`;
  const existing = inFlight.get(lockKey);
  if (existing) return (await existing) as AiCacheResult<T>;

  const promise = executeCache({
    ...opts,
    store: opts.store ?? databaseCacheStore,
  }) as Promise<AiCacheResult<unknown>>;
  inFlight.set(lockKey, promise);
  try {
    return await promise as AiCacheResult<T>;
  } finally {
    if (inFlight.get(lockKey) === promise) inFlight.delete(lockKey);
  }
}

export async function clearAiResultCacheForTests(): Promise<void> {
  inFlight.clear();
  try {
    await db.delete(aiResultCacheTable);
  } catch {
    // Unit tests that mock the database still need the in-flight reset; a
    // missing/unavailable cache table must not make those tests fail.
  }
}