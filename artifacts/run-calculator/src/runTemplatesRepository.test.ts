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
} from "./runTemplatesRepository";

const template = (name = "Template"): RunTemplate =>
  ({ id: "one", name, values: {}, createdAt: "2026-01-01T00:00:00.000Z" } as RunTemplate);
const response = (templates: unknown[]) => ({ ok: true, json: async () => ({ templates }) }) as Response;
const originalFetch = globalThis.fetch;
let restoreTimeout: () => void;

beforeEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  setRunTemplatesScope("live");
  restoreTimeout = setRunTemplatesWriteTimeoutForTests(50);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});

async function cleanupRepository(): Promise<void> {
  try {
    // Do not reset storage, scope or fetch while optimistic work still owns it.
    // This also waits for follow-up rounds and work started in another scope.
    await settleRunTemplatesFlushesForTests();
  } finally {
    restoreTimeout();
    localStorage.clear();
    setRunTemplatesScope("live");
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
      expect(JSON.parse(localStorage.getItem(`run-calc-templates-outbox-v1:${scope}`)!)).toEqual([]);
    });
  });

  it("falls back safely when snapshot or outbox JSON has the wrong schema", () => {
    localStorage.setItem("run-calc-templates:live", JSON.stringify({ bad: true }));
    localStorage.setItem("run-calc-templates-outbox-v1:live", JSON.stringify("bad"));
    expect(localRunTemplates()).toEqual([]);
    expect(() => saveRunTemplate(template())).not.toThrow();
  });
  it("creates, edits, and deletes immediately while offline", () => {
    expect(saveRunTemplate(template())).toHaveLength(1);
    expect(saveRunTemplate(template("Edited"))[0].name).toBe("Edited");
    expect(deleteRunTemplate("one")).toEqual([]);
    const stored = JSON.parse(localStorage.getItem("run-calc-templates:live")!);
    expect(stored[0]).toMatchObject({ id: "one", deleted: true });
    expect(JSON.parse(localStorage.getItem("run-calc-templates-outbox-v1:live")!)).toHaveLength(1);
  });

  it("reloads the durable snapshot and pending outbox", () => {
    saveRunTemplate(template());
    expect(localRunTemplates()).toEqual([template()]);
    expect(JSON.parse(localStorage.getItem("run-calc-templates-outbox-v1:live")!)[0].type).toBe("save");
  });

  it("coalesces retry work into one in-flight request", async () => {
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) =>
      setTimeout(() => resolve(response([{ ...template(), revision: 2, deleted: false }])), 0),
    ));
    vi.stubGlobal("fetch", fetchMock);
    saveRunTemplate(template());
    // The optimistic kick plus this second edit becomes one latest outbox op;
    // no parallel flush is allowed.
    saveRunTemplate(template("newer"));
    await settleRunTemplatesFlushesForTests();
    // The newer edit is sent in a subsequent round, never in parallel with
    // the first request.
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/run-templates")).toHaveLength(2);
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
        localStorage.setItem(`run-calc-templates:${scope}`, JSON.stringify([
          { ...template(), revision: 1, deleted: false },
        ]));
        deleteRunTemplate("one");
      }

      const flushing = flushRunTemplates();
      await flushing;
      await settleRunTemplatesFlushesForTests();

      expect(vi.isFakeTimers()).toBe(false);
      expect(signal?.aborted).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]?.[1]?.method).toBe(operation === "save" ? "POST" : "DELETE");
      expect(JSON.parse(localStorage.getItem(`run-calc-templates-outbox-v1:${scope}`)!)).toHaveLength(1);
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

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem("run-calc-templates-outbox-v1:live")!)).toHaveLength(1);

    await reconcileRunTemplates();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([, init]) => init?.method ?? "GET")).toEqual(["POST", "GET"]);
    expect(localRunTemplates()).toEqual([template("committed")]);
    expect(JSON.parse(localStorage.getItem("run-calc-templates-outbox-v1:live")!)).toEqual([]);
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
    await reconcileRunTemplates();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([, init]) => init?.method ?? "GET")).toEqual(["POST", "GET"]);
    expect(JSON.parse(localStorage.getItem("run-calc-templates-outbox-v1:live")!)).toHaveLength(1);
  });

  it("keeps a server tombstone over a stale pending local save", async () => {
    localStorage.setItem("run-calc-templates:live", JSON.stringify([{ ...template(), revision: 4, deleted: false }]));
    localStorage.setItem("run-calc-templates-outbox-v1:live", JSON.stringify([
      { type: "save", id: "one", revision: 4, record: { ...template(), revision: 4, deleted: false } },
    ]));
    await reconcileRunTemplates([{ ...template(), revision: 9, deleted: true }]);
    expect(localRunTemplates()).toEqual([]);
    expect(JSON.parse(localStorage.getItem("run-calc-templates-outbox-v1:live")!)).toEqual([]);
  });

  it("keeps a newer server edit over a stale pending local edit", async () => {
    localStorage.setItem("run-calc-templates:live", JSON.stringify([{ ...template("local"), revision: 4, deleted: false }]));
    localStorage.setItem("run-calc-templates-outbox-v1:live", JSON.stringify([
      { type: "save", id: "one", revision: 4, record: { ...template("local"), revision: 4, deleted: false } },
    ]));
    await reconcileRunTemplates([{ ...template("server"), revision: 9, deleted: false }]);
    expect(localRunTemplates()[0].name).toBe("server");
    expect(JSON.parse(localStorage.getItem("run-calc-templates-outbox-v1:live")!)).toEqual([]);
  });

  it("does not let a legacy revision-zero snapshot overwrite an existing server row", async () => {
    localStorage.setItem("run-calc-templates", JSON.stringify([template("legacy local")]));
    migrateLegacyRunTemplates();
    await reconcileRunTemplates([{ ...template("existing server"), revision: 0, deleted: false }]);
    expect(localRunTemplates()[0].name).toBe("existing server");
    expect(JSON.parse(localStorage.getItem("run-calc-templates-outbox-v1:live")!)).toEqual([]);
  });

  it("migrates legacy array snapshots once into revisioned queued records", () => {
    localStorage.setItem("run-calc-templates", JSON.stringify([template()]));
    migrateLegacyRunTemplates();
    const record = JSON.parse(localStorage.getItem("run-calc-templates:live")!)[0];
    expect(record.revision).toBe(0);
    expect(record.deleted).toBe(false);
    const queue = JSON.parse(localStorage.getItem("run-calc-templates-outbox-v1:live")!);
    expect(queue).toHaveLength(1);
    migrateLegacyRunTemplates();
    expect(JSON.parse(localStorage.getItem("run-calc-templates-outbox-v1:live")!)).toHaveLength(1);
  });

  it("queues compatibility rewrites and removals instead of losing them on hydration", () => {
    localStorage.setItem("run-calc-templates:live", JSON.stringify([
      { ...template("old"), revision: 2, deleted: false },
      { ...template("remove"), id: "two", revision: 3, deleted: false },
    ]));
    replaceRunTemplates([template("rewritten")]);
    expect(localRunTemplates().map(({ id, name }) => ({ id, name }))).toEqual([
      { id: "one", name: "rewritten" },
    ]);
    const queue = JSON.parse(localStorage.getItem("run-calc-templates-outbox-v1:live")!);
    expect(queue.map((op: { id: string; type: string }) => [op.id, op.type]).sort()).toEqual([
      ["one", "save"],
      ["two", "delete"],
    ]);
  });

  it("keeps live and sandbox caches and outboxes isolated", () => {
    saveRunTemplate(template("live"));
    setRunTemplatesScope("sandbox");
    expect(localRunTemplates()).toEqual([]);
    saveRunTemplate({ ...template("sandbox"), id: "sandbox-one" });
    setRunTemplatesScope("live");
    expect(localRunTemplates().map((item) => item.name)).toEqual(["live"]);
    expect(localStorage.getItem("run-calc-templates-outbox-v1:sandbox")).toContain("sandbox-one");
    expect(localStorage.getItem("run-calc-templates-outbox-v1:live")).not.toContain("sandbox-one");
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
    expect(JSON.parse(localStorage.getItem("run-calc-templates-outbox-v1:sandbox")!)).toEqual([]);
    expect(JSON.parse(localStorage.getItem("run-calc-templates-outbox-v1:live")!)).toHaveLength(1);
  });

  it("keeps rejected writes queued without automatic replay", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 403 }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    saveRunTemplate(template());
    await settleRunTemplatesFlushesForTests();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(localRunTemplates()).toEqual([template()]);
    expect(JSON.parse(localStorage.getItem("run-calc-templates-outbox-v1:live")!)).toHaveLength(1);
  });
});