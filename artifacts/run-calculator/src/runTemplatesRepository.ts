// Server-backed memory reads; only authenticated unsent intents are durable.
import type { RunTemplate } from "./types";
import { browserRecordStore } from "./adapters/browserRecordStore";
import { fetchWithTimeout } from "./fetchWithTimeout";
import { retireMatchingLegacyArray, stableRecordJson } from "./sharedRecordMigration";

export type RunTemplateRecord = RunTemplate & { revision: number; deleted: boolean };
type OutboxOp =
  | { type: "save"; id: string; revision: number; record: RunTemplateRecord }
  | { type: "delete"; id: string; revision: number };

const OUTBOX_KEY = "run-calc-templates-outbox-v1";
const RUN_TEMPLATE_WRITE_TIMEOUT_MS = 30_000;
let writeTimeoutMs = RUN_TEMPLATE_WRITE_TIMEOUT_MS;

/** Exercise real aborts in tests without changing the production deadline. */
export function setRunTemplatesWriteTimeoutForTests(ms: number): () => void {
  const previous = writeTimeoutMs;
  writeTimeoutMs = ms;
  return () => { writeTimeoutMs = previous; };
}

export type RunTemplateScope = "live" | "sandbox";
let activeScope: RunTemplateScope = "live";

let activeUser: string | null = null;
const flushes = new Map<number, Promise<RunTemplate[]>>();

export function setRunTemplatesIdentity(userId: string | null, scope: RunTemplateScope = "live"): void {
  if (activeUser === userId && activeScope === scope) return;
  activeUser = userId; activeScope = scope; generation++;
  memoryRecords = []; status = "loading";
  // Rebuild only unsent work owned by this exact authenticated identity.
  for (const op of outbox()) {
    if (op.type === "save") memoryRecords.push(op.record);
  }
  emit();
}

/** Drain optimistic work in every scope without initiating or replaying writes. */
export async function settleRunTemplatesFlushesForTests(): Promise<void> {
  // A successful flush may enqueue a subsequent round in its finally handler.
  while (flushes.size) await Promise.all([...flushes.values()]);
}

export function setRunTemplatesScope(scope: RunTemplateScope): void {
  if (scope === activeScope) return;
  setRunTemplatesIdentity(activeUser, scope);
}

export function getRunTemplatesScope(): RunTemplateScope {
  return activeScope;
}

function scopedKey(key: string): string {
  return `${key}:${activeScope}:${encodeURIComponent(activeUser ?? "unauthenticated")}`;
}
function outboxKey(): string { return scopedKey(OUTBOX_KEY); }
function readJson<T>(key: string, fallback: T): T {
  return browserRecordStore.record(key, () => fallback, {
    decode: (value) => Array.isArray(fallback)
      ? (Array.isArray(value) ? value as T : null)
      : value as T,
  }).read();
}
function writeJson(key: string, value: unknown): void {
  if (!browserRecordStore.record(key, () => value, { decode: (item) => item }).write(value)) {
    throw new Error("Template recovery could not be saved on this device. Free storage and retry.");
  }
}
function validRecord(value: unknown): value is RunTemplateRecord {
  return !!value && typeof value === "object" && typeof (value as RunTemplate).id === "string";
}
function records(): RunTemplateRecord[] {
  return memoryRecords;
}
function putRecords(next: RunTemplateRecord[]): void { memoryRecords = next; emit(); }
function outbox(): OutboxOp[] {
  if (!activeUser) return [];
  return readJson<unknown[]>(outboxKey(), []).filter((op): op is OutboxOp =>
    !!op && typeof op === "object" &&
    ((op as OutboxOp).type === "save" || (op as OutboxOp).type === "delete") &&
    typeof (op as OutboxOp).id === "string" && Number.isFinite((op as OutboxOp).revision)
    && ((op as OutboxOp).type === "delete" || validRecord((op as Extract<OutboxOp, { type: "save" }>).record)),
  );
}
function putOutbox(next: OutboxOp[]): void { writeJson(outboxKey(), next); }

function operationAcknowledged(op: OutboxOp, record: RunTemplateRecord): boolean {
  return record.revision > op.revision || (record.revision === op.revision
    && (op.type === "delete" ? record.deleted : stableRecordJson(record) === stableRecordJson(op.record)));
}
function enqueue(op: OutboxOp): void {
  // Last intent for an id wins. This is both smaller during an offline edit
  // burst and prevents an old in-flight intent being retried after a delete.
  putOutbox([...outbox().filter((old) => old.id !== op.id), op]);
}
function visible(list: RunTemplateRecord[]): RunTemplate[] {
  return list.filter((record) => !record.deleted).map(({ revision: _revision, deleted: _deleted, ...template }) => template);
}
function newestRevision(): number {
  return Math.max(0, ...records().map((record) => record.revision), ...outbox().map((op) => op.revision));
}
function nextRevision(): number { return Math.max(Date.now(), newestRevision() + 1); }

/** Turns the old array-only cache into records and queues it exactly once. */
export function migrateLegacyRunTemplates(): void {
  // Scope-only/unscoped snapshots and queues do not establish account ownership.
  // Keep original bytes for review. No automatic claim or upload is permitted.
}

export function localRunTemplates(): RunTemplate[] {
  migrateLegacyRunTemplates();
  return visible(records());
}

export function saveRunTemplate(template: RunTemplate): RunTemplate[] {
  if (!activeUser) throw new Error("Sign in before saving a shared template");
  migrateLegacyRunTemplates();
  const revision = nextRevision();
  const record: RunTemplateRecord = { ...template, revision, deleted: false };
  enqueue({ type: "save", id: record.id, revision, record });
  putRecords([...records().filter((item) => item.id !== record.id), record]);
  void flushRunTemplates();
  return localRunTemplates();
}

export function deleteRunTemplate(id: string): RunTemplate[] {
  if (!activeUser) throw new Error("Sign in before deleting a shared template");
  migrateLegacyRunTemplates();
  const revision = nextRevision();
  const prior = records().find((item) => item.id === id);
  const tombstone: RunTemplateRecord = {
    ...(prior ?? { id, name: "", values: {}, createdAt: new Date().toISOString() } as RunTemplate),
    revision,
    deleted: true,
  };
  enqueue({ type: "delete", id, revision });
  putRecords([...records().filter((item) => item.id !== id), tombstone]);
  void flushRunTemplates();
  return localRunTemplates();
}

/**
 * Compatibility bridge for storage maintenance routines that rewrite the full
 * visible template list (for example after a recipe merge). Changed records and
 * omissions are real template edits/deletes, so they must use the same durable
 * revisioned outbox as direct UI actions.
 */
export function replaceRunTemplates(templates: RunTemplate[]): RunTemplate[] {
  migrateLegacyRunTemplates();
  const before = new Map(localRunTemplates().map((template) => [template.id, template]));
  const nextIds = new Set(templates.map((template) => template.id));
  for (const template of templates) {
    const previous = before.get(template.id);
    if (!previous || JSON.stringify(previous) !== JSON.stringify(template)) {
      saveRunTemplate(template);
    }
  }
  for (const id of before.keys()) {
    if (!nextIds.has(id)) deleteRunTemplate(id);
  }
  return localRunTemplates();
}

async function getServer(): Promise<RunTemplateRecord[]> {
  const res = await fetchWithTimeout("/api/run-templates", { cache: "no-store" }, 10_000);
  if (!res.ok) throw new Error(`fetchRunTemplates failed (${res.status})`);
  const body = await res.json() as { templates?: unknown[] };
  if (!Array.isArray(body?.templates) || body.templates.some((record) =>
    !validRecord(record) || !Number.isFinite(record.revision) || typeof record.deleted !== "boolean"
    || typeof record.name !== "string" || typeof record.createdAt !== "string"
    || !record.values || typeof record.values !== "object" || Array.isArray(record.values)
  )) throw new Error("Invalid template directory response");
  return body.templates.filter(validRecord).map((record) => ({
    ...record, revision: typeof record.revision === "number" ? record.revision : 0, deleted: record.deleted === true,
  }));
}

/** Merge a server response without allowing a delayed device to resurrect a tombstone. */
export function reconcileRunTemplates(server?: RunTemplateRecord[]): Promise<RunTemplate[]> {
  return (async () => {
    const epoch = generation;
    const versionAtRead = version;
    if (!activeUser) return [];
    migrateLegacyRunTemplates();
    let remote: RunTemplateRecord[];
    try { remote = server ?? await getServer(); }
    catch (error) {
      if (epoch === generation) { status = "unavailable"; emit(); }
      throw error;
    }
    // Never let a response started under another authenticated scope mutate
    // the cache selected after an account/scope switch.
    if (generation !== epoch) return localRunTemplates();
    // A read begun before a local edit/ack cannot roll it back after its
    // outbox entry has drained. The next canonical read will reconcile it.
    if (server === undefined && version !== versionAtRead) return localRunTemplates();
    const pending = outbox();
    const result = new Map(remote.map((record) => [record.id, record]));
    for (const op of pending) {
      const serverRecord = result.get(op.id);
      if (serverRecord && operationAcknowledged(op, serverRecord)) {
        // A newer server operation wins; an equal revision is our idempotent
        // retry already acknowledged. In both cases the queued op is complete.
        putOutbox(outbox().filter((entry) => !(entry.id === op.id && entry.revision === op.revision)));
        continue;
      }
      if (op.type === "save") {
        result.set(op.id, op.record);
      } else {
        result.set(op.id, { ...(serverRecord ?? { id: op.id, name: "", values: {}, createdAt: new Date().toISOString() } as RunTemplate), revision: op.revision, deleted: true });
      }
    }
    putRecords([...result.values()]);
    // Scope-only legacy snapshots are never uploaded. Retire only entries
    // proved equal to the canonical factory directory (or a newer tombstone).
    for (const key of ["run-calc-templates", `run-calc-templates:${activeScope}`]) {
      retireMatchingLegacyArray(key, (value) => {
        if (!validRecord(value)) return false;
        const canonical = remote.find((record) => record.id === value.id);
        if (!canonical) return false;
        if (canonical.deleted) return canonical.revision >= (value.revision ?? 0);
        const { revision: _r, deleted: _d, ...legacyTemplate } = value;
        const { revision: _cr, deleted: _cd, ...canonicalTemplate } = canonical;
        return stableRecordJson(legacyTemplate) === stableRecordJson(canonicalTemplate);
      });
    }
    status = "ready"; emit();
    return visible([...result.values()]);
  })();
}

export async function flushRunTemplates(): Promise<RunTemplate[]> {
  if (!activeUser) return [];
  const epoch = generation;
  const existingFlush = flushes.get(epoch);
  if (existingFlush) return existingFlush;
  let delivered = false;
  const flushing = (async () => {
    migrateLegacyRunTemplates();
    const sent = outbox();
    if (!sent.length) return localRunTemplates();
    try {
      const saves = sent.filter((op): op is Extract<OutboxOp, { type: "save" }> => op.type === "save").map((op) => op.record);
      const deletes = sent.filter((op): op is Extract<OutboxOp, { type: "delete" }> => op.type === "delete").map((op) => ({ id: op.id, revision: op.revision }));
      let response: RunTemplateRecord[] | undefined;
      if (saves.length) {
        const res = await fetchWithTimeout(
          "/api/run-templates",
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templates: saves }) },
          writeTimeoutMs,
        );
        if (!res.ok) throw new Error(`saveRunTemplate failed (${res.status})`);
        response = ((await res.json()) as { templates?: RunTemplateRecord[] }).templates;
        if (generation !== epoch) return localRunTemplates();
        if (!Array.isArray(response)) throw new Error("Template save was not acknowledged");
      }
      if (deletes.length) {
        if (generation !== epoch) return localRunTemplates();
        const res = await fetchWithTimeout(
          "/api/run-templates",
          { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: deletes }) },
          writeTimeoutMs,
        );
        if (!res.ok) throw new Error(`deleteRunTemplates failed (${res.status})`);
        response = ((await res.json()) as { templates?: RunTemplateRecord[] }).templates;
        if (generation !== epoch) return localRunTemplates();
        if (!Array.isArray(response)) throw new Error("Template deletion was not acknowledged");
      }
      if (!response || sent.some((op) => !response!.some((record) =>
        record.id === op.id && operationAcknowledged(op, record)
      ))) throw new Error("Template response did not acknowledge submitted operations");
      delivered = true;
      return await reconcileRunTemplates(response);
    } catch {
      // The snapshot and durable outbox intentionally survive failed networks.
      return localRunTemplates();
    }
  })().finally(() => {
    flushes.delete(epoch);
    // An edit can replace an operation while its predecessor is on the wire.
    // Start one *subsequent* round only after a successful response; failures
    // stay durable and wait for the next reconnect/start/focus kick.
    if (delivered && generation === epoch && outbox().length) void flushRunTemplates();
  });
  flushes.set(epoch, flushing);
  return flushing;
}

export function startRunTemplatesRepository(onChange?: () => void): () => void {
  migrateLegacyRunTemplates();
  const epoch = generation;
  const kick = () => {
    if (generation !== epoch) return;
    void reconcileRunTemplates()
      .then(() => {
        if (generation !== epoch) return;
        void flushRunTemplates();
        onChange?.();
      })
      .catch(() => {});
  };
  window.addEventListener("online", kick);
  window.addEventListener("focus", kick);
  const poll = window.setInterval(kick, 30_000);
  kick();
  return () => {
    window.removeEventListener("online", kick);
    window.removeEventListener("focus", kick);
    window.clearInterval(poll);
  };
}

let version = 0;

export const runTemplatesVersion = () => version;

export const runTemplatesGeneration = () => generation;

export const pendingRunTemplateCount = () => outbox().length;

const emit = () => { version++; for (const listener of listeners) listener(); };

export function subscribeRunTemplates(listener: () => void): () => void {
  listeners.add(listener); return () => { listeners.delete(listener); };
}

export const runTemplatesStatus = () => status;

let status: "loading" | "ready" | "unavailable" = "loading";

let memoryRecords: RunTemplateRecord[] = [];

const listeners = new Set<() => void>();

let generation = 0;
