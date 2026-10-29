// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunTemplate } from "./types";
import {
  deleteRunTemplate,
  flushRunTemplates,
  localRunTemplates,
  migrateLegacyRunTemplates,
  reconcileRunTemplates,
  replaceRunTemplates,
  saveRunTemplate,
  setRunTemplatesScope,
  setRunTemplatesWriteTimeoutForTests,
  settleRunTemplatesFlushesForTests,
  setRunTemplatesIdentity, runTemplatesStatus,
} from "./runTemplatesRepository";

const template = (name = "Template"): RunTemplate =>
  ({ id: "one", name, values: {}, createdAt: "2026-01-01T00:00:00.000Z" } as RunTemplate);
const record = (name = "Template", revision = 1, deleted = false) => ({ ...template(name), revision, deleted });
const response = (templates: unknown[]) => ({ ok: true, json: async () => ({ templates }) }) as Response;
const originalFetch = globalThis.fetch;
let restoreTimeout: () => void;
const queueKey = (scope = "live", user = "owner") => `run-calc-templates-outbox-v1:${scope}:${user}`;
const queue = (scope = "live", user = "owner") => JSON.parse(localStorage.getItem(queueKey(scope, user)) ?? "[]");
const settle = async () => { await new Promise((resolve) => setTimeout(resolve, 5)); };

beforeEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setRunTemplatesIdentity(null);
  localStorage.clear();
  restoreTimeout = setRunTemplatesWriteTimeoutForTests(50);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  setRunTemplatesIdentity("owner", "live");
});

async function cleanupRepository(): Promise<void> {
  try {
    // Do not reset storage, scope or fetch while optimistic work still owns it.
    // This also waits for follow-up rounds and work started in another scope.
    await settleRunTemplatesFlushesForTests();
  } finally {
    restoreTimeout();
    setRunTemplatesIdentity(null);
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
}

afterEach(cleanupRepository);

describe("run template repository", () => {
  it("restores nested timeout overrides and the 30-second production default", async () => {
    restoreTimeout();
    const timer = vi.spyOn(globalThis, "setTimeout");
    const fetchMock = vi.fn(async () => response([]));
    vi.stubGlobal("fetch", fetchMock);
    const restoreOuter = setRunTemplatesWriteTimeoutForTests(75);
    const restoreInner = setRunTemplatesWriteTimeoutForTests(25);
    try {
      saveRunTemplate(template());
      await settleRunTemplatesFlushesForTests();
      expect(timer.mock.calls.at(-1)?.[1]).toBe(25);
      restoreInner();
      deleteRunTemplate("one");
      await settleRunTemplatesFlushesForTests();
      expect(timer.mock.calls.at(-1)?.[1]).toBe(75);
      restoreOuter();
      saveRunTemplate(template());
      await settleRunTemplatesFlushesForTests();
      expect(timer.mock.calls.at(-1)?.[1]).toBe(30_000);
    } finally {
      restoreInner();
      restoreOuter();
    }
  });

  it("settles both scopes and restores globals even when the test body fails", async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        signals.push(init!.signal!);
        init!.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      }),
    ));
    await expect((async () => {
      try {
        saveRunTemplate(template("live"));
        setRunTemplatesScope("sandbox");
        saveRunTemplate(template("sandbox"));
        throw new Error("simulated assertion failure");
      } finally {
        await cleanupRepository();
      }
    })()).rejects.toThrow("simulated assertion failure");
    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(globalThis.fetch).toBe(originalFetch);
    expect(vi.isFakeTimers()).toBe(false);
    expect(localStorage.length).toBe(0);
  });

  describe.each(["live", "sandbox"] as const)("%s successive cases", (scope) => {
    it("leaves an optimistic request for teardown to settle", () => {
      setRunTemplatesScope(scope);
      const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
      vi.stubGlobal("fetch", fetchMock);
      saveRunTemplate(template("previous case"));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      // Intentionally do not await: afterEach must drain the module registry.
    });

    it("starts its own write rather than joining the preceding case", async () => {
      setRunTemplatesScope(scope);
      const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
        response((JSON.parse(String(init?.body)) as { templates: unknown[] }).templates),
      );
      vi.stubGlobal("fetch", fetchMock);
      saveRunTemplate(template("next case"));
      await flushRunTemplates();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
      expect(queue(scope)).toEqual([]);
    });
  });

  it("does not bootstrap malformed or unowned snapshots/outboxes", () => {
    localStorage.setItem("run-calc-templates:live", '{"bad":true}');
    localStorage.setItem("run-calc-templates-outbox-v1:live", '"bad"');
    expect(localRunTemplates()).toEqual([]);
    expect(() => saveRunTemplate(template())).not.toThrow();
    expect(localStorage.getItem("run-calc-templates:live")).toBe('{"bad":true}');
  });
  it("creates, edits, and deletes offline with only the latest intent durable", () => {
    expect(saveRunTemplate(template())).toHaveLength(1);
    expect(saveRunTemplate(template("Edited"))[0].name).toBe("Edited");
    expect(deleteRunTemplate("one")).toEqual([]);
    expect(queue()).toEqual([expect.objectContaining({ id: "one", type: "delete" })]);
    expect(localStorage.getItem("run-calc-templates:live")).toBeNull();
  });
  it("recovers a self-contained owned pending payload after reload, not server reads", async () => {
    await reconcileRunTemplates([record("Acknowledged")]);
    setRunTemplatesIdentity(null);
    setRunTemplatesIdentity("owner");
    expect(localRunTemplates()).toEqual([]);
    saveRunTemplate(template("Unsent"));
    await flushRunTemplates();
    setRunTemplatesIdentity(null);
    setRunTemplatesIdentity("other");
    expect(localRunTemplates()).toEqual([]);
    setRunTemplatesIdentity("owner");
    expect(localRunTemplates()).toEqual([template("Unsent")]);
  });
  it("serializes newer in-flight edits into a subsequent round", async () => {
    const releases: Array<() => void> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      await new Promise<void>((resolve) => releases.push(resolve));
      return response(JSON.parse(init.body).templates);
    }));
    saveRunTemplate(template());
    saveRunTemplate(template("Newer"));
    expect(fetch).toHaveBeenCalledTimes(1);
    releases.shift()?.();
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(queue()[0].record.name).toBe("Newer");
    releases.shift()?.();
    await settle();
    expect(queue()).toEqual([]);
    expect(localRunTemplates()).toEqual([template("Newer")]);
  });

  it.each([
    ["live", "save"], ["live", "delete"], ["sandbox", "save"], ["sandbox", "delete"],
  ] as const)(
    "bounds a hung %s %s write and keeps its outbox entry without retrying it",
    async (scope, operation) => {
      setRunTemplatesScope(scope);
      let signal: AbortSignal | null | undefined;
      const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          signal = init?.signal;
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Client stopped waiting", "AbortError"));
          }, { once: true });
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      if (operation === "save") {
        saveRunTemplate(template());
      } else {
        await reconcileRunTemplates([record()]);
        deleteRunTemplate("one");
      }

      const flushing = flushRunTemplates();
      await flushing;
      await settleRunTemplatesFlushesForTests();

      expect(vi.isFakeTimers()).toBe(false);
      expect(signal?.aborted).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]?.[1]?.method).toBe(operation === "save" ? "POST" : "DELETE");
      expect(queue(scope)).toHaveLength(1);
    },
  );

  it("recovers a save committed after client timeout with a read, not a write retry", async () => {
    let serverTemplates: unknown[] = [];
    const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        const submitted = (JSON.parse(String(init.body)) as { templates: unknown[] }).templates;
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            // The server may finish its transaction after the browser aborts.
            serverTemplates = submitted;
            reject(new DOMException("Client stopped waiting", "AbortError"));
          }, { once: true });
        });
      }
      return Promise.resolve(response(serverTemplates));
    });
    vi.stubGlobal("fetch", fetchMock);

    saveRunTemplate(template("committed"));
    const flushing = flushRunTemplates();
    await flushing;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(queue()).toHaveLength(1);
    await reconcileRunTemplates();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(queue()).toEqual([]);
    expect(localRunTemplates()).toEqual([template("committed")]);
  });

  it("keeps an uncommitted timed-out save queued after canonical recovery without replay", async () => {
    const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("Client stopped waiting", "AbortError"));
          }, { once: true });
        });
      }
      return Promise.resolve(response([]));
    });
    vi.stubGlobal("fetch", fetchMock);

    saveRunTemplate(template("not committed"));
    const flushing = flushRunTemplates();
    await flushing;
    expect(queue()).toHaveLength(1);
    await reconcileRunTemplates();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(queue()).toHaveLength(1);
    expect(localRunTemplates()).toEqual([template("not committed")]);
  });
  it("keeps an uncommitted timed-out save pending after canonical recovery", async () => {
    saveRunTemplate(template());
    await flushRunTemplates();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response([])));
    await reconcileRunTemplates();
    expect(queue()).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([true, false])("keeps a newer server tombstone/edit over a stale pending edit (%s)", async (deleted) => {
    localStorage.setItem(queueKey(), JSON.stringify([{ type: "save", id: "one", revision: 4, record: record("Local", 4) }]));
    await reconcileRunTemplates([record("Server", 9, deleted)]);
    expect(localRunTemplates()).toEqual(deleted ? [] : [template("Server")]);
    expect(queue()).toEqual([]);
  });
  it("does not acknowledge equal-revision differing payloads", async () => {
    localStorage.setItem(queueKey(), JSON.stringify([{ type: "save", id: "one", revision: 4, record: record("Local", 4) }]));
    await reconcileRunTemplates([record("Different", 4)]);
    expect(queue()).toHaveLength(1);
    expect(localRunTemplates()).toEqual([template("Local")]);
  });
  it("does not let a legacy revision-zero snapshot override canonical state", async () => {
    const bytes = JSON.stringify([template("legacy")]);
    localStorage.setItem("run-calc-templates", bytes);
    migrateLegacyRunTemplates();
    await reconcileRunTemplates([record("canonical", 0)]);
    expect(localRunTemplates()).toEqual([template("canonical")]);
    expect(queue()).toEqual([]);
    expect(localStorage.getItem("run-calc-templates")).toBe(bytes);
  });
  it("retires only matching legacy reads and resumes a partially resolved migration", async () => {
    localStorage.setItem("run-calc-templates", JSON.stringify([template(), { ...template("Unknown"), id: "two" }]));
    await reconcileRunTemplates([record()]);
    expect(JSON.parse(localStorage.getItem("run-calc-templates")!)).toEqual([{ ...template("Unknown"), id: "two" }]);
    await reconcileRunTemplates([record(), { ...record("Unknown"), id: "two" }]);
    expect(localStorage.getItem("run-calc-templates")).toBeNull();
    expect(queue()).toEqual([]);
  });
  it("never claims a scope-only legacy queue for a different account", async () => {
    const bytes = JSON.stringify([{ type: "save", id: "one", revision: 4, record: record("Unknown", 4) }]);
    localStorage.setItem("run-calc-templates-outbox-v1:live", bytes);
    await flushRunTemplates();
    setRunTemplatesIdentity("other");
    await flushRunTemplates();
    expect(fetch).not.toHaveBeenCalled();
    expect(localStorage.getItem("run-calc-templates-outbox-v1:live")).toBe(bytes);
  });
  it("queues compatibility rewrites/removals through the owned outbox", async () => {
    await reconcileRunTemplates([record("old", 2), { ...record("remove", 3), id: "two" }]);
    replaceRunTemplates([template("rewritten")]);
    expect(localRunTemplates()).toEqual([template("rewritten")]);
    expect(queue().map((op: { id: string; type: string }) => [op.id, op.type]).sort())
      .toEqual([["one", "save"], ["two", "delete"]]);
  });
  it("isolates live/sandbox owned queues, never persisting a directory", async () => {
    saveRunTemplate(template("live"));
    await flushRunTemplates();
    setRunTemplatesScope("sandbox");
    expect(localRunTemplates()).toEqual([]);
    saveRunTemplate({ ...template("sandbox"), id: "sandbox-one" });
    await flushRunTemplates();
    setRunTemplatesScope("live");
    expect(localRunTemplates()).toEqual([template("live")]);
    expect(queue("sandbox")[0].id).toBe("sandbox-one");
    expect(localStorage.getItem("run-calc-templates:live")).toBeNull();
  });
  it("fences delayed responses and remaining sends across same-scope account changes", async () => {
    let release!: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { release = resolve; })));
    saveRunTemplate(template("A"));
    const flight = flushRunTemplates();
    setRunTemplatesIdentity("other");
    release(response([record("A", Date.now() + 1)]));
    await flight;
    expect(localRunTemplates()).toEqual([]);
    expect(queue("live", "owner")).toHaveLength(1);
    expect(queue("live", "other")).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed/non-OK reads without replacing a loaded directory", async () => {
    await reconcileRunTemplates([record("valid")]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ templates: {} }) }));
    await expect(reconcileRunTemplates()).rejects.toThrow("Invalid");
    expect(localRunTemplates()).toEqual([template("valid")]);
    expect(runTemplatesStatus()).toBe("unavailable");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));
    await expect(reconcileRunTemplates()).rejects.toThrow("503");
    expect(localRunTemplates()).toEqual([template("valid")]);
  });

  it("does not adopt a delayed live response into sandbox or coalesce their writes", async () => {
    let finishLive!: (value: Response) => void;
    const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      const submitted = (JSON.parse(String(init?.body)) as { templates: unknown[] }).templates;
      return submitted.some((item) => (item as RunTemplate).name === "live")
        ? new Promise<Response>((resolve) => { finishLive = resolve; })
        : Promise.resolve(response(submitted));
    });
    vi.stubGlobal("fetch", fetchMock);
    saveRunTemplate(template("live"));
    setRunTemplatesScope("sandbox");
    saveRunTemplate(template("sandbox"));
    await flushRunTemplates();
    finishLive(response([{ ...template("live"), revision: Number.MAX_SAFE_INTEGER, deleted: false }]));
    await settleRunTemplatesFlushesForTests();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(localRunTemplates()).toEqual([template("sandbox")]);
    expect(queue("sandbox")).toEqual([]);
    expect(queue("live")).toHaveLength(1);
  });

  it("keeps rejected writes queued without automatic replay", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 403 }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    saveRunTemplate(template());
    await settleRunTemplatesFlushesForTests();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(localRunTemplates()).toEqual([template()]);
    expect(queue()).toHaveLength(1);
  });
  it("does not drop a save after an HTTP 200 with a malformed acknowledgement", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    saveRunTemplate(template());
    await flushRunTemplates();
    expect(queue()).toHaveLength(1);
  });
});
