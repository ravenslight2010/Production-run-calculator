import { describe, expect, it, vi } from "vitest";
import { closeTopmostImportDialog } from "./useHomeImportDialogs";

describe("import dialog close priority", () => {
  it("closes only the first open deferred import dialog", () => {
    const excel = vi.fn();
    const spec = vi.fn();
    const cheese = vi.fn();
    expect(closeTopmostImportDialog([
      { open: true, close: excel }, { open: true, close: spec }, { open: true, close: cheese },
    ])).toBe(true);
    expect(excel).toHaveBeenCalledOnce();
    expect(spec).not.toHaveBeenCalled();
    expect(cheese).not.toHaveBeenCalled();
  });
  it("does nothing when all import dialogs are closed", () => {
    expect(closeTopmostImportDialog([{ open: false, close: vi.fn() }])).toBe(false);
  });
});