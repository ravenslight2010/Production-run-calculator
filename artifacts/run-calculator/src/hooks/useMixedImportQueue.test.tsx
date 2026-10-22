import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { useMixedImportQueue, type ImporterReviewState } from "./useMixedImportQueue";
import { MIXED_IMPORT_TYPES, type MixedImportType, type WorkbookFileSelection } from "../mixedImportQueue";
import { readPendingImportOperations } from "../importOperations";

vi.mock("../importOperations", () => ({ readPendingImportOperations: vi.fn() }));
const pending = vi.mocked(readPendingImportOperations);
const file = (name = "Review.xlsx") => new File(["synthetic"], name);
function setup(identity = "manager:live") {
  let opened: MixedImportType | undefined;
  const handlers = Object.fromEntries(MIXED_IMPORT_TYPES.map((type) => [type, vi.fn(async (_event: WorkbookFileSelection) => {
    opened = type;
  })])) as Record<MixedImportType, ReturnType<typeof vi.fn<(event: WorkbookFileSelection) => Promise<void>>>>;
  const rendered = renderHook(({ who }) => {
    const [states, setStates] = useState(Object.fromEntries(MIXED_IMPORT_TYPES.map((type) => [type, { open: false }])) as Record<MixedImportType, ImporterReviewState>);
    const queue = useMixedImportQueue({
      identity: who, enabled: new Set(MIXED_IMPORT_TYPES), states,
      start: Object.fromEntries(MIXED_IMPORT_TYPES.map((type) => [type, async (event: WorkbookFileSelection) => {
        await handlers[type](event);
        setStates((previous) => ({ ...previous, [type]: { open: true } }));
      }])) as Record<MixedImportType, (event: WorkbookFileSelection) => Promise<void>>,
    });
    return { queue, setStates };
  }, { initialProps: { who: identity } });
  return { ...rendered, handlers, opened: () => opened };
}
beforeEach(() => { pending.mockReturnValue({ available: true, operations: [] }); });

describe("mixed workbook session queue", () => {
  it.each(MIXED_IMPORT_TYPES)("routes %s through its original handler without applying", async (type) => {
    const h = setup();
    const source = file(type === "sauce" ? "客户 — 31.12.2026.DOCX" : "客户 — 31.12.2026.XLSX");
    act(() => h.result.current.queue.add([source], type));
    expect(h.opened()).toBeUndefined();
    await act(() => h.result.current.queue.review(h.result.current.queue.items[0].id));
    expect(h.handlers[type]).toHaveBeenCalledWith({ target: { files: [source], value: "" } });
    expect(h.result.current.queue.items[0].status).toBe("reviewing");
    expect(h.result.current.queue.blocked).toBe(true);
  });

  it("bounds workbooks, rejects unsupported files, and preserves duplicate filenames as separate items", () => {
    const h = setup();
    act(() => h.result.current.queue.add([file("a.exe"), ...Array.from({ length: 21 }, () => file("same.xlsx"))], "spec"));
    expect(h.result.current.queue.items).toHaveLength(20);
    expect(new Set(h.result.current.queue.items.map((item) => item.id)).size).toBe(20);
    expect(h.result.current.queue.message).toContain("Some files were not added");
    expect(h.handlers.spec).not.toHaveBeenCalled();
  });

  it("allows explicit type correction and mixed types without guessing names", () => {
    const h = setup();
    act(() => h.result.current.queue.add([file("cheese.xlsx")], "spec"));
    const id = h.result.current.queue.items[0].id;
    act(() => h.result.current.queue.setType(id, "schedule"));
    act(() => h.result.current.queue.add([file("配送.csv")], "shipping"));
    expect(h.result.current.queue.items.map((item) => item.type)).toEqual(["schedule", "shipping"]);
  });

  it("keeps sauce documents in their document importer and rejects incompatible type changes", async () => {
    const h = setup();
    act(() => h.result.current.queue.add([file("Sauce.docx"), file("Sauce.doc"), file("Sauce.txt"), file("Wrong.xlsx")], "sauce"));
    expect(h.result.current.queue.items.map((item) => item.file.name)).toEqual(["Sauce.docx", "Sauce.doc", "Sauce.txt"]);
    const id = h.result.current.queue.items[0].id;
    act(() => h.result.current.queue.setType(id, "spec"));
    await act(() => h.result.current.queue.review(id));
    expect(h.handlers.spec).not.toHaveBeenCalled();
    expect(h.result.current.queue.message).toContain("does not support this file format");
  });

  it("reports original importer progress/errors and cancellation without success", async () => {
    const h = setup();
    act(() => h.result.current.queue.add([file()], "premix"));
    await act(() => h.result.current.queue.review(h.result.current.queue.items[0].id));
    act(() => h.result.current.setStates((s) => ({ ...s, premix: { open: true, loading: true, progress: { done: 1, total: 3 } } })));
    expect(h.result.current.queue.items[0]).toMatchObject({ status: "preparing", detail: "1 / 3" });
    act(() => h.result.current.setStates((s) => ({ ...s, premix: { open: true, error: "Invalid workbook" } })));
    expect(h.result.current.queue.items[0]).toMatchObject({ status: "failed", detail: "Invalid workbook" });
    act(() => h.result.current.setStates((s) => ({ ...s, premix: { open: false } })));
    expect(h.result.current.queue.items[0].status).toBe("failed");
    expect(h.result.current.queue.blocked).toBe(false);
  });

  it("does not mistake a cancelled safety confirmation for an ambiguous save", async () => {
    const h = setup();
    act(() => h.result.current.queue.add([file()], "cheese"));
    await act(() => h.result.current.queue.review(h.result.current.queue.items[0].id));
    await act(() => h.result.current.queue.confirm("cheese", async () => {}));
    expect(h.result.current.queue.items[0].status).toBe("reviewing");
    expect(h.result.current.queue.canCloseReview()).toBe(true);
    act(() => h.result.current.setStates((s) => ({ ...s, cheese: { open: false } })));
    expect(h.result.current.queue.items[0].status).toBe("cancelled");
  });

  it("holds ambiguous saves in their original review and allows exact-ID recovery", async () => {
    const h = setup();
    act(() => h.result.current.queue.add([file(), file("next.xlsx")], "premix"));
    const originalId = h.result.current.queue.items[0].id;
    await act(() => h.result.current.queue.review(originalId));
    const operation = { operationId: "original-operation", payload: { reviewed: "unchanged" } };
    await act(() => h.result.current.queue.confirm("premix", async () => {
      pending.mockReturnValue({ available: true, operations: [operation] });
    }));
    expect(h.result.current.queue.items[0].status).toBe("uncertain");
    act(() => { expect(h.result.current.queue.canCloseReview()).toBe(false); });
    await act(() => h.result.current.queue.review(h.result.current.queue.items[1].id));
    expect(h.handlers.premix).toHaveBeenCalledTimes(1);
    await act(() => h.result.current.queue.confirm("premix", async () => {
      expect(readPendingImportOperations().operations[0]).toBe(operation);
      pending.mockReturnValue({ available: true, operations: [] });
      h.result.current.queue.outcome("premix", "applied", "Confirmed original ID");
      h.result.current.setStates((s) => ({ ...s, premix: { open: false } }));
    }));
    expect(h.result.current.queue.items[0]).toMatchObject({ id: originalId, status: "applied" });
    expect(h.result.current.queue.blocked).toBe(false);
  });

  it("preserves applied and partial outcomes when cancelling the rest", async () => {
    const h = setup();
    act(() => h.result.current.queue.add([file(), file("next.xlsx"), file("last.xlsx")], "schedule"));
    await act(() => h.result.current.queue.review(h.result.current.queue.items[0].id));
    await act(() => h.result.current.queue.confirm("schedule", async () => {
      h.result.current.queue.outcome("schedule", "partial", "1 day confirmed; 1 not sent");
      h.result.current.setStates((s) => ({ ...s, schedule: { open: false } }));
    }));
    act(() => h.result.current.queue.cancelRemaining());
    expect(h.result.current.queue.items.map((item) => item.status)).toEqual(["partial", "cancelled", "cancelled"]);
    expect(h.result.current.queue.items[0].detail).toBe("1 day confirmed; 1 not sent");
  });

  it("fails closed when pending recovery is unavailable and never starts a parser", async () => {
    const h = setup();
    act(() => h.result.current.queue.add([file()], "spec"));
    pending.mockReturnValue({ available: false, operations: [] });
    await act(() => h.result.current.queue.review(h.result.current.queue.items[0].id));
    expect(h.handlers.spec).not.toHaveBeenCalled();
    expect(h.result.current.queue.message).toContain("original review");
  });

  it("does not overwrite an explicit preparation failure with a reviewing status", async () => {
    const h = setup();
    act(() => h.result.current.queue.add([file()], "schedule"));
    h.handlers.schedule.mockImplementation(async () => {
      h.result.current.queue.outcome("schedule", "failed", "No requests sent");
    });
    await act(() => h.result.current.queue.review(h.result.current.queue.items[0].id));
    expect(h.result.current.queue.items[0]).toMatchObject({ status: "failed", detail: "No requests sent" });
  });

  it("blocks closing and duplicate confirmation while the original save is in flight", async () => {
    const h = setup();
    act(() => h.result.current.queue.add([file()], "spec"));
    await act(() => h.result.current.queue.review(h.result.current.queue.items[0].id));
    let finish!: () => void;
    const work = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    let confirmation!: Promise<void>;
    act(() => { confirmation = h.result.current.queue.confirm("spec", work); });
    act(() => { expect(h.result.current.queue.canCloseReview()).toBe(false); });
    await act(() => h.result.current.queue.confirm("spec", work));
    expect(work).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); await confirmation; });
    expect(h.result.current.queue.canCloseReview()).toBe(true);
  });

  it("drops files on identity/scope changes and cannot adopt a late preparation", async () => {
    const h = setup();
    act(() => h.result.current.queue.add([file()], "spec"));
    h.rerender({ who: "manager:sandbox" });
    await waitFor(() => expect(h.result.current.queue.items).toEqual([]));
    expect(h.result.current.queue.activeId).toBeNull();
  });
});
