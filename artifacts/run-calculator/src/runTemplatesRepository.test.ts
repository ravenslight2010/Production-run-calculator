// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunTemplate } from "./types";
import {
  deleteRunTemplate,
  localRunTemplates,
  migrateLegacyRunTemplates,
  reconcileRunTemplates,
  replaceRunTemplates,
  saveRunTemplate,
  setRunTemplatesScope,
} from "./runTemplatesRepository";

const template = (name = "Template"): RunTemplate =>
  ({ id: "one", name, values: {}, createdAt: "2026-01-01T00:00:00.000Z" } as RunTemplate);
const response = (templates: unknown[]) => ({ ok: true, json: async () => ({ templates }) }) as Response;

beforeEach(() => {
  localStorage.clear();
  setRunTemplatesScope("live");
  vi.restoreAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});

describe("run template repository", () => {
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
    await new Promise((resolve) => setTimeout(resolve, 10));
    // The newer edit is sent in a subsequent round, never in parallel with
    // the first request.
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/run-templates")).toHaveLength(2);
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
});