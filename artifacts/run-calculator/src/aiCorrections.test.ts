import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

vi.mock("./hooks/use-toast", () => ({ toast: toastMock }));
vi.mock("./inventoryShared", () => ({ inventoryClientId: () => "test-client" }));

import { saveAiCorrections } from "./aiCorrections";

const correction = {
  domain: "brand",
  fromText: "Private workbook label",
  toText: "Canonical brand label",
};

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  warnSpy.mockRestore();
});

describe("saveAiCorrections", () => {
  it("warns on a non-2xx response without blocking or exposing correction text", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({ ok: false, status: 403 } as Response);

    await expect(saveAiCorrections([correction])).resolves.toBeUndefined();

    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.any(String),
        description: expect.any(String),
        variant: "destructive",
      }),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "Confirmed correction memory write failed",
      {
        store: "shared-corrections",
        failure: "http",
        correctionCount: 1,
        status: 403,
      },
    );
    const noticeAndDiagnostic = JSON.stringify({
      toast: toastMock.mock.calls,
      warning: warnSpy.mock.calls,
    });
    expect(noticeAndDiagnostic).not.toContain(correction.fromText);
    expect(noticeAndDiagnostic).not.toContain(correction.toText);
  });

  it("warns on a network rejection without logging the thrown error", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(
      new Error("Private workbook label / Canonical brand label"),
    );

    await expect(saveAiCorrections([correction])).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      "Confirmed correction memory write failed",
      {
        store: "shared-corrections",
        failure: "network",
        correctionCount: 1,
      },
    );
    const noticeAndDiagnostic = JSON.stringify({
      toast: toastMock.mock.calls,
      warning: warnSpy.mock.calls,
    });
    expect(noticeAndDiagnostic).not.toContain(correction.fromText);
    expect(noticeAndDiagnostic).not.toContain(correction.toText);
  });

  it("does not request or report an empty batch", async () => {
    await saveAiCorrections([]);

    expect(fetch).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});