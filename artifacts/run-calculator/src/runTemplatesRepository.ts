// Durable, offline-first client repository for the facility run-template pool.
// The legacy `run-calc-templates` key remains the snapshot so old callers can
// still read it, while this module owns the extra sync bookkeeping.
import type { RunTemplate } from "./types";
import { TEMPLATES_KEY } from "./types";

export type RunTemplateRecord = RunTemplate & { revision: number; deleted: boolean };
type OutboxOp =
  | { type: "save"; id: string; revision: number; record: RunTemplateRecord }
  | { type: "delete"; id: string; revision: number };

const OUTBOX_KEY = "run-calc-templates-outbox-v1";
const MIGRATION_KEY = "run-calc-templates-repository-migrated-v1";
const LEGACY_CLAIM_KEY = "run-calc-templates-legacy-scope-v1";
export type RunTemplateScope = "live" | "sandbox";
let activeScope: RunTemplateScope = "live";
const flushes = new Map<RunTemplateScope, Promise<RunTemplate[]>>();

export function setRunTemplatesScope(scope: RunTemplateScope): void {
  if (scope === activeScope) return;
  activeScope = scope;
}

export function getRunTemplatesScope(): RunTemplateScope {
  return activeScope;
}

function scopedKey(key: string): string {
  return `${key}:${activeScope}`;
}

function snapshotKey(): string { return scopedKey(TEMPLATES_KEY); }
function outboxKey(): string { return scopedKey(OUTBOX_KEY); }
function migrationKey(): string { return scopedKey(MIGRATION_KEY); }

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch { return fallback; }
}
function writeJson(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}
function validRecord(value: unknown): value is RunTemplateRecord {
  return !!value && typeof value === "object" && typeof (value as RunTemplate).id === "string";
}
function records(): RunTemplateRecord[] {
  const raw = readJson<unknown[]>(snapshotKey(), []);
  return raw.filter(validRecord).map((item) => ({
    ...item,
    revision: typeof item.revision === "number" ? item.revision : 0,
    deleted: item.deleted === true,
  }));
}
function putRecords(next: RunTemplateRecord[]): void { writeJson(snapshotKey(), next); }
function outbox(): OutboxOp[] {
  return readJson<unknown[]>(outboxKey(), []).filter((op): op is OutboxOp =>
    !!op && typeof op === "object" &&
    ((op as OutboxOp).type === "save" || (op as OutboxOp).type === "delete") &&
    typeof (op as OutboxOp).id === "string" && typeof (op as OutboxOp).revision === "number",
  );
}
function putOutbox(next: OutboxOp[]): void { writeJson(outboxKey(), next); }
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
  if (typeof localStorage === "undefined" || localStorage.getItem(migrationKey())) return;
  const claimedScope = localStorage.getItem(LEGACY_CLAIM_KEY);
  const scopedRaw = readJson<unknown[]>(snapshotKey(), []);
  const raw = scopedRaw.length > 0
    ? scopedRaw
    : claimedScope === null || claimedScope === activeScope
      ? readJson<unknown[]>(TEMPLATES_KEY, [])
      : [];
  const legacy = raw.filter(validRecord).filter((item) => typeof item.revision !== "number");
  if (legacy.length) {
    const next = raw.filter(validRecord).map((item) => {
      if (typeof item.revision === "number") return { ...item, deleted: item.deleted === true } as RunTemplateRecord;
      // Revision 0 is reserved for unstamped legacy data. It can insert a
      // missing row, but ties (and loses) against every pre-existing server row,
      // including rows backfilled with the database's revision-0 default.
      const record: RunTemplateRecord = { ...item, revision: 0, deleted: false };
      enqueue({ type: "save", id: record.id, revision: record.revision, record });
      return record;
    });
    putRecords(next);
  }
  // The outbox itself is durable, so marking after enqueue is safe and makes
  // reloads idempotent even while offline.
  try {
    if (claimedScope === null && raw.length > 0) {
      localStorage.setItem(LEGACY_CLAIM_KEY, activeScope);
      localStorage.removeItem(TEMPLATES_KEY);
    }
    localStorage.setItem(migrationKey(), "1");
  } catch {}
}

export function localRunTemplates(): RunTemplate[] {
  migrateLegacyRunTemplates();
  return visible(records());
}

export function saveRunTemplate(template: RunTemplate): RunTemplate[] {
  migrateLegacyRunTemplates();
  const revision = nextRevision();
  const record: RunTemplateRecord = { ...template, revision, deleted: false };
  putRecords([...records().filter((item) => item.id !== record.id), record]);
  enqueue({ type: "save", id: record.id, revision, record });
  void flushRunTemplates();
  return localRunTemplates();
}

export function deleteRunTemplate(id: string): RunTemplate[] {
  migrateLegacyRunTemplates();
  const revision = nextRevision();
  const prior = records().find((item) => item.id === id);
  const tombstone: RunTemplateRecord = {
    ...(prior ?? { id, name: "", values: {}, createdAt: new Date().toISOString() } as RunTemplate),
    revision,
    deleted: true,
  };
  putRecords([...records().filter((item) => item.id !== id), tombstone]);
  enqueue({ type: "delete", id, revision });
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
  const res = await fetch("/api/run-templates");
  if (!res.ok) throw new Error(`fetchRunTemplates failed (${res.status})`);
  const body = await res.json() as { templates?: unknown[] };
  return (body.templates ?? []).filter(validRecord).map((record) => ({
    ...record, revision: typeof record.revision === "number" ? record.revision : 0, deleted: record.deleted === true,
  }));
}

/** Merge a server response without allowing a delayed device to resurrect a tombstone. */
export function reconcileRunTemplates(server?: RunTemplateRecord[]): Promise<RunTemplate[]> {
  return (async () => {
    const scope = activeScope;
    migrateLegacyRunTemplates();
    const remote = server ?? await getServer();
    // Never let a response started under another authenticated scope mutate
    // the cache selected after an account/scope switch.
    if (activeScope !== scope) return localRunTemplates();
    const pending = outbox();
    const result = new Map(remote.map((record) => [record.id, record]));
    for (const op of pending) {
      const serverRecord = result.get(op.id);
      if (serverRecord && serverRecord.revision >= op.revision) {
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
    return visible([...result.values()]);
  })();
}

export async function flushRunTemplates(): Promise<RunTemplate[]> {
  const scope = activeScope;
  const existingFlush = flushes.get(scope);
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
        const res = await fetch("/api/run-templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templates: saves }) });
        if (!res.ok) throw new Error(`saveRunTemplate failed (${res.status})`);
        response = ((await res.json()) as { templates?: RunTemplateRecord[] }).templates;
        if (activeScope !== scope) return localRunTemplates();
      }
      if (deletes.length) {
        const res = await fetch("/api/run-templates", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: deletes }) });
        if (!res.ok) throw new Error(`deleteRunTemplates failed (${res.status})`);
        response = ((await res.json()) as { templates?: RunTemplateRecord[] }).templates;
        if (activeScope !== scope) return localRunTemplates();
      }
      const current = outbox();
      putOutbox(current.filter((op) => !sent.some((done) => done.id === op.id && done.revision === op.revision && done.type === op.type)));
      delivered = true;
      return reconcileRunTemplates(response);
    } catch {
      // The snapshot and durable outbox intentionally survive failed networks.
      return localRunTemplates();
    }
  })().finally(() => {
    flushes.delete(scope);
    // An edit can replace an operation while its predecessor is on the wire.
    // Start one *subsequent* round only after a successful response; failures
    // stay durable and wait for the next reconnect/start/focus kick.
    if (delivered && activeScope === scope && outbox().length) void flushRunTemplates();
  });
  flushes.set(scope, flushing);
  return flushing;
}

export function startRunTemplatesRepository(onChange?: () => void): () => void {
  migrateLegacyRunTemplates();
  const scope = activeScope;
  const kick = () => {
    if (activeScope !== scope) return;
    void reconcileRunTemplates()
      .then(() => {
        if (activeScope !== scope) return;
        void flushRunTemplates();
        onChange?.();
      })
      .catch(() => {});
  };
  window.addEventListener("online", kick);
  window.addEventListener("focus", kick);
  kick();
  return () => {
    window.removeEventListener("online", kick);
    window.removeEventListener("focus", kick);
  };
}