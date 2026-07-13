import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  canonicalProfileKey,
  markProfileEdited,
  markProfileDeleted,
  flushProfileQueue,
  migrateLocalProfilesToServerIfNeeded,
  reconcileProfilesFromServer,
  getProfileStamp,
  resetProfileSyncMemoryFallbackForTests,
} from "./profileServerSync";

// Focused unit coverage for the profile server-pool sync glue: the persisted
// op queue (edits made offline retry until they land), the reconcile pass
// (server-newer adopted, local-newer re-pushed, remote deletions dropped only
// when previously synced), and the migration key filter (bookkeeping markers
// sharing the blob prefix must never be uploaded as junk profiles).

const DOUGH_PREFIX = "run-calc-profile-";
const CRUST_PREFIX = "run-calc-crust-profile-";
const STAMPS_KEY = "run-calc-profilesync-stamps-v1";
const SYNCED_KEY = "run-calc-profilesync-synced-v1";
const QUEUE_KEY = "run-calc-profilesync-queue-v1";
const MIGRATED_KEY = "run-calc-profiles-server-migrated-v1";

const KEY = canonicalProfileKey("Acme", "Pepperoni"); // "acme__pepperoni"

type ServerItem = {
  key: string;
  brand: string;
  flavor: string;
  values: Record<string, unknown>;
  crustValues: Record<string, unknown>;
  updatedAt: number;
};

type FetchCall = { method: string; body?: unknown };

let calls: FetchCall[] = [];
let listItems: ServerItem[] = [];
let networkDown = false;

function postCalls(): FetchCall[] {
  return calls.filter((c) => c.method === "POST");
}
function deleteCalls(): FetchCall[] {
  return calls.filter((c) => c.method === "DELETE");
}

function readQueue(): Array<{ t: string; key: string }> {
  const raw = localStorage.getItem(QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}

function writeMap(storageKey: string, map: Record<string, number>): void {
  localStorage.setItem(storageKey, JSON.stringify(map));
}
function readMap(storageKey: string): Record<string, number> {
  const raw = localStorage.getItem(storageKey);
  return raw ? JSON.parse(raw) : {};
}

function setLocalBlobs(key: string, dough: Record<string, unknown>): void {
  localStorage.setItem(`${DOUGH_PREFIX}${key}`, JSON.stringify(dough));
  localStorage.setItem(`${CRUST_PREFIX}${key}`, JSON.stringify({}));
}

function serverItem(key: string, updatedAt: number, values: Record<string, unknown>): ServerItem {
  const idx = key.indexOf("__");
  return {
    key,
    brand: key.slice(0, idx),
    flavor: key.slice(idx + 2),
    values,
    crustValues: {},
    updatedAt,
  };
}

// Flushes kicked with `void` (markProfileEdited, reconcile) settle in the
// background; drain the microtask + timer queue until they finish.
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
}

beforeEach(() => {
  localStorage.clear();
  resetProfileSyncMemoryFallbackForTests();
  calls = [];
  listItems = [];
  networkDown = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({
        method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (networkDown) throw new Error("network down");
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: listItems }),
      };
    }),
  );
});

afterEach(async () => {
  // Let any straggling background flush finish against the stub before it is
  // torn down, so it can't bleed into the next test.
  await settle();
  vi.unstubAllGlobals();
});

describe("persisted push queue", () => {
  it("a queued edit survives a failed flush and lands on the next retry", async () => {
    setLocalBlobs(KEY, { doughRecipeName: "V1" });

    networkDown = true;
    markProfileEdited(KEY);
    await flushProfileQueue();
    await settle();

    // Nothing landed, but the op is still persisted for the next kick.
    expect(readQueue()).toEqual([{ t: "up", key: KEY }]);
    expect(readMap(SYNCED_KEY)[KEY]).toBeUndefined();

    calls = []; // failed attempts also hit fetch — count only the retry
    networkDown = false;
    await flushProfileQueue();
    await settle();

    expect(postCalls()).toHaveLength(1);
    const body = postCalls()[0].body as { items: ServerItem[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].key).toBe(KEY);
    expect(body.items[0].brand).toBe("acme");
    expect(body.items[0].flavor).toBe("pepperoni");
    expect(body.items[0].values).toEqual({ doughRecipeName: "V1" });
    expect(body.items[0].updatedAt).toBe(getProfileStamp(KEY));

    // Queue drained; synced map records the pushed stamp.
    expect(readQueue()).toEqual([]);
    expect(readMap(SYNCED_KEY)[KEY]).toBe(getProfileStamp(KEY));
  });

  it("a queued delete survives a failed flush and retries", async () => {
    writeMap(SYNCED_KEY, { [KEY]: 5 });

    networkDown = true;
    markProfileDeleted(KEY);
    await flushProfileQueue();
    await settle();
    expect(readQueue()).toEqual([{ t: "del", key: KEY }]);

    calls = []; // failed attempts also hit fetch — count only the retry
    networkDown = false;
    await flushProfileQueue();
    await settle();

    expect(deleteCalls()).toHaveLength(1);
    expect(deleteCalls()[0].body).toEqual({ keys: [KEY] });
    expect(readQueue()).toEqual([]);
    expect(readMap(SYNCED_KEY)[KEY]).toBeUndefined();
  });

  it("chunks a large flush into 500-item batches so no tail is silently dropped", async () => {
    const keys: string[] = [];
    for (let i = 0; i < 501; i++) {
      const key = `brand${i}__flavor`;
      keys.push(key);
      setLocalBlobs(key, { i });
    }
    localStorage.setItem(
      QUEUE_KEY,
      JSON.stringify(keys.map((key) => ({ t: "up", key }))),
    );

    await flushProfileQueue();
    await settle();

    expect(postCalls()).toHaveLength(2);
    const first = postCalls()[0].body as { items: ServerItem[] };
    const second = postCalls()[1].body as { items: ServerItem[] };
    expect(first.items).toHaveLength(500);
    expect(second.items).toHaveLength(1);
    const sentKeys = new Set([...first.items, ...second.items].map((it) => it.key));
    expect(sentKeys.size).toBe(501);
    expect(readQueue()).toEqual([]);
  });

  it("an upsert whose blobs vanished (deleted meanwhile) is dropped without a POST", async () => {
    // Queue an upsert for a key with no local blobs at flush time.
    localStorage.setItem(QUEUE_KEY, JSON.stringify([{ t: "up", key: KEY }]));

    await flushProfileQueue();
    await settle();

    expect(postCalls()).toHaveLength(0);
    expect(readQueue()).toEqual([]);
  });
});

describe("reconcileProfilesFromServer", () => {
  beforeEach(() => {
    // Migration already ran — these tests exercise reconcile in isolation.
    localStorage.setItem(MIGRATED_KEY, "1");
  });

  it("adopts a server-newer profile into the local cache and its stamp maps", async () => {
    setLocalBlobs(KEY, { doughRecipeName: "old" });
    writeMap(STAMPS_KEY, { [KEY]: 100 });
    writeMap(SYNCED_KEY, { [KEY]: 100 });
    listItems = [serverItem(KEY, 200, { doughRecipeName: "newer" })];

    const changed = await reconcileProfilesFromServer();
    await settle();

    expect(changed).toBe(true);
    expect(JSON.parse(localStorage.getItem(`${DOUGH_PREFIX}${KEY}`)!)).toEqual({
      doughRecipeName: "newer",
    });
    expect(getProfileStamp(KEY)).toBe(200);
    expect(readMap(SYNCED_KEY)[KEY]).toBe(200);
    // Adoption must not push anything back up.
    expect(postCalls()).toHaveLength(0);
  });

  it("re-enqueues a local-newer profile so a lost queue self-heals", async () => {
    setLocalBlobs(KEY, { doughRecipeName: "local-newer" });
    writeMap(STAMPS_KEY, { [KEY]: 300 });
    writeMap(SYNCED_KEY, { [KEY]: 200 });
    // Queue is EMPTY (lost) — reconcile must notice local > server and re-push.
    listItems = [serverItem(KEY, 200, { doughRecipeName: "stale" })];

    const changed = await reconcileProfilesFromServer();
    await settle();

    expect(changed).toBe(false);
    // Local blob untouched…
    expect(JSON.parse(localStorage.getItem(`${DOUGH_PREFIX}${KEY}`)!)).toEqual({
      doughRecipeName: "local-newer",
    });
    // …and the local copy was pushed up with the local stamp.
    expect(postCalls()).toHaveLength(1);
    const body = postCalls()[0].body as { items: ServerItem[] };
    expect(body.items[0].key).toBe(KEY);
    expect(body.items[0].values).toEqual({ doughRecipeName: "local-newer" });
    expect(body.items[0].updatedAt).toBe(300);
  });

  it("does not double-enqueue a local-newer profile whose op is already queued", async () => {
    setLocalBlobs(KEY, { doughRecipeName: "local-newer" });
    writeMap(STAMPS_KEY, { [KEY]: 300 });
    localStorage.setItem(QUEUE_KEY, JSON.stringify([{ t: "up", key: KEY }]));
    listItems = [serverItem(KEY, 200, { doughRecipeName: "stale" })];

    await reconcileProfilesFromServer();
    await settle();

    // Exactly one POST for the already-queued op — not two.
    expect(postCalls()).toHaveLength(1);
  });

  it("drops a previously-synced local profile that vanished from the server", async () => {
    setLocalBlobs(KEY, { doughRecipeName: "was-shared" });
    writeMap(STAMPS_KEY, { [KEY]: 100 });
    writeMap(SYNCED_KEY, { [KEY]: 100 }); // was on the server before
    listItems = []; // deleted remotely

    const changed = await reconcileProfilesFromServer();
    await settle();

    expect(changed).toBe(true);
    expect(localStorage.getItem(`${DOUGH_PREFIX}${KEY}`)).toBeNull();
    expect(localStorage.getItem(`${CRUST_PREFIX}${KEY}`)).toBeNull();
    expect(getProfileStamp(KEY)).toBe(0);
    expect(readMap(SYNCED_KEY)[KEY]).toBeUndefined();
    // A remote deletion must not be re-uploaded.
    expect(postCalls()).toHaveLength(0);
  });

  it("keeps a never-synced local profile absent from the server and pushes it up", async () => {
    setLocalBlobs(KEY, { doughRecipeName: "offline-created" });
    writeMap(STAMPS_KEY, { [KEY]: 100 });
    // NOT in the synced map — the server has never seen it.
    listItems = [];

    await reconcileProfilesFromServer();
    await settle();

    // Local copy preserved and uploaded, never destroyed.
    expect(JSON.parse(localStorage.getItem(`${DOUGH_PREFIX}${KEY}`)!)).toEqual({
      doughRecipeName: "offline-created",
    });
    expect(postCalls()).toHaveLength(1);
    const body = postCalls()[0].body as { items: ServerItem[] };
    expect(body.items[0].key).toBe(KEY);
    expect(body.items[0].values).toEqual({ doughRecipeName: "offline-created" });
  });

  it("skips the remote-deletion drop while an op for that key is still queued", async () => {
    setLocalBlobs(KEY, { doughRecipeName: "just-edited" });
    writeMap(STAMPS_KEY, { [KEY]: 400 });
    writeMap(SYNCED_KEY, { [KEY]: 100 });
    localStorage.setItem(QUEUE_KEY, JSON.stringify([{ t: "up", key: KEY }]));
    listItems = []; // our own push simply hasn't landed yet

    // Keep the flush from landing so the pending state is what's under test.
    networkDown = true;
    await reconcileProfilesFromServer().catch(() => {});
    await settle();

    // reconcile bails when the list fails; run again with list OK, POST failing
    // is not distinguishable here — instead verify with the list succeeding:
    networkDown = false;
    let firstCall = true;
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (_url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        calls.push({ method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (method === "GET" && firstCall) {
          firstCall = false;
          return { ok: true, status: 200, json: async () => ({ items: [] }) };
        }
        throw new Error("push still failing"); // the queued op stays pending
      },
    );

    await reconcileProfilesFromServer();
    await settle();

    // Blobs survive: the pending op means "our push hasn't landed", not
    // "deleted remotely".
    expect(localStorage.getItem(`${DOUGH_PREFIX}${KEY}`)).not.toBeNull();
    expect(getProfileStamp(KEY)).toBe(400);
  });

  it("still retries queued pushes when the server list fails (offline reconcile)", async () => {
    setLocalBlobs(KEY, { doughRecipeName: "V1" });
    writeMap(STAMPS_KEY, { [KEY]: 100 });
    localStorage.setItem(QUEUE_KEY, JSON.stringify([{ t: "up", key: KEY }]));

    // GET fails (offline) but the flush kick must still be attempted.
    let getFails = true;
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (_url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        calls.push({ method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (method === "GET" && getFails) throw new Error("offline");
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      },
    );

    const changed = await reconcileProfilesFromServer();
    await settle();

    expect(changed).toBe(false);
    expect(postCalls()).toHaveLength(1); // queued push retried anyway
    expect(readQueue()).toEqual([]);
  });
});

describe("localStorage full (quota exceeded)", () => {
  let quotaFull = false;
  let setItemSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    quotaFull = false;
    const original = Storage.prototype.setItem;
    setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (this: Storage, k: string, v: string) {
        if (quotaFull) throw new DOMException("quota exceeded", "QuotaExceededError");
        original.call(this, k, v);
      });
  });

  afterEach(() => {
    setItemSpy.mockRestore();
  });

  it("an edit made while storage is full still reaches the server via the memory fallback", async () => {
    // Blobs were written earlier while storage still had room.
    setLocalBlobs(KEY, { doughRecipeName: "edited-while-full" });

    quotaFull = true;
    markProfileEdited(KEY); // enqueue + stamp persist both throw
    await settle();

    // Nothing could be persisted…
    expect(localStorage.getItem(QUEUE_KEY)).toBeNull();
    expect(localStorage.getItem(STAMPS_KEY)).toBeNull();

    // …but the edit was NOT silently dropped: the immediate flush pushed it
    // from the in-memory fallback, carrying the real (memory-held) stamp.
    expect(postCalls()).toHaveLength(1);
    const body = postCalls()[0].body as { items: ServerItem[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].key).toBe(KEY);
    expect(body.items[0].values).toEqual({ doughRecipeName: "edited-while-full" });
    expect(body.items[0].updatedAt).toBeGreaterThan(1);
    expect(body.items[0].updatedAt).toBe(getProfileStamp(KEY));
  });

  it("an edit made while storage is full AND offline is retained and lands on retry", async () => {
    setLocalBlobs(KEY, { doughRecipeName: "full-and-offline" });

    quotaFull = true;
    networkDown = true;
    markProfileEdited(KEY);
    await settle();
    // The flush attempt failed (fetch threw) — nothing was marked synced.
    expect(readMap(SYNCED_KEY)[KEY]).toBeUndefined();

    calls = [];
    networkDown = false; // storage STILL full — the memory queue must retry
    await flushProfileQueue();
    await settle();

    expect(postCalls()).toHaveLength(1);
    const body = postCalls()[0].body as { items: ServerItem[] };
    expect(body.items[0].key).toBe(KEY);
    expect(body.items[0].values).toEqual({ doughRecipeName: "full-and-offline" });
  });

  it("does not re-send drained ops after storage recovers", async () => {
    setLocalBlobs(KEY, { doughRecipeName: "v" });

    quotaFull = true;
    markProfileEdited(KEY);
    await settle();
    expect(postCalls()).toHaveLength(1); // pushed from memory

    calls = [];
    quotaFull = false; // storage recovered
    await flushProfileQueue();
    await settle();

    // The memory queue was drained by the successful push — nothing re-sent.
    expect(postCalls()).toHaveLength(0);

    // And a fresh edit persists normally again (memory fallback cleared).
    markProfileEdited(KEY);
    await settle();
    expect(postCalls()).toHaveLength(1);
    expect(localStorage.getItem(STAMPS_KEY)).not.toBeNull();
  });
});

describe("one-time migration key filter", () => {
  it("never enqueues bookkeeping/marker keys without the __ separator", async () => {
    // A real profile…
    setLocalBlobs(KEY, { doughRecipeName: "real" });
    // …and marker/junk keys that share the dough prefix but are NOT profiles.
    localStorage.setItem(`${DOUGH_PREFIX}cleanup-v1`, "1");
    localStorage.setItem(`${DOUGH_PREFIX}some-marker`, JSON.stringify({ done: true }));
    // The degenerate empty key must be skipped too.
    localStorage.setItem(`${DOUGH_PREFIX}__`, JSON.stringify({}));

    networkDown = true; // keep ops visible in the queue
    migrateLocalProfilesToServerIfNeeded();
    await settle();

    const queued = readQueue().map((op) => op.key);
    expect(queued).toEqual([KEY]);
    expect(localStorage.getItem(MIGRATED_KEY)).toBe("1");

    // Marker set — a second call must not re-enqueue anything.
    localStorage.setItem(QUEUE_KEY, JSON.stringify([]));
    migrateLocalProfilesToServerIfNeeded();
    await settle();
    expect(readQueue()).toEqual([]);
  });

  it("markProfileEdited/markProfileDeleted ignore empty and degenerate keys", async () => {
    networkDown = true;
    markProfileEdited("");
    markProfileEdited("__");
    markProfileDeleted("");
    markProfileDeleted("__");
    await settle();
    expect(readQueue()).toEqual([]);
    expect(readMap(STAMPS_KEY)).toEqual({});
  });
});
