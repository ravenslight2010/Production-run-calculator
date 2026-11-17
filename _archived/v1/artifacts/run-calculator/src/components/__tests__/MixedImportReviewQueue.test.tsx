import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MixedImportReviewQueue from "../MixedImportReviewQueue";
import type { useMixedImportQueue } from "../../hooks/useMixedImportQueue";
import { MIXED_IMPORT_TYPES, type MixedImportStatus } from "../../mixedImportQueue";

afterEach(cleanup);
function queue(status: MixedImportStatus = "queued"): ReturnType<typeof useMixedImportQueue> {
  return {
    items: [{ id: "fixture", file: new File(["synthetic"], "Customer-free.xlsx"), type: "shipping", status }],
    message: null, blocked: false, activeId: null,
    add: vi.fn(), review: vi.fn(), confirm: vi.fn(), outcome: vi.fn(),
    setType: vi.fn(), cancelRemaining: vi.fn(), clear: vi.fn(), canCloseReview: vi.fn(() => true),
  };
}
describe("mixed import review controls", () => {
  it("only offers authorized types and requires explicit type selection before adding", () => {
    const q = queue();
    render(<MixedImportReviewQueue queue={q} enabledImporters={new Set(["shipping", "schedule"])} />);
    const selector = screen.getByTestId("select-mixed-import-add-type");
    expect(selector.querySelectorAll("option")).toHaveLength(3);
    expect(screen.queryByRole("option", { name: "Premix" })).toBeNull();
    const input = screen.getByTestId("input-mixed-import-files");
    fireEvent.change(input, { target: { files: [new File([], "synthetic.csv")] } });
    expect(screen.getByTestId("button-mixed-import-add").hasAttribute("disabled")).toBe(true);
    fireEvent.change(selector, { target: { value: "schedule" } });
    fireEvent.click(screen.getByTestId("button-mixed-import-add"));
    expect(q.add).toHaveBeenCalledWith(expect.any(Array), "schedule");
    expect(q.review).not.toHaveBeenCalled();
    expect(q.confirm).not.toHaveBeenCalled();
  });
  it("opens reviews by queue identity, never by inferred filename", () => {
    const q = queue();
    render(<MixedImportReviewQueue queue={q} enabledImporters={new Set(MIXED_IMPORT_TYPES)} />);
    fireEvent.click(screen.getByTestId("button-mixed-import-review-fixture"));
    expect(q.review).toHaveBeenCalledWith("fixture");
    expect(q.confirm).not.toHaveBeenCalled();
    expect(screen.getByText(/no shared transaction/)).toBeTruthy();
  });
  it.each(["applied", "partial", "uncertain"] as const)("does not reprepare a %s operation", (status) => {
    const q = queue(status);
    render(<MixedImportReviewQueue queue={q} enabledImporters={new Set(MIXED_IMPORT_TYPES)} />);
    expect(screen.getByTestId("button-mixed-import-review-fixture").hasAttribute("disabled")).toBe(true);
    expect(screen.queryByTestId("select-mixed-import-type-fixture")).toBeNull();
  });
});
