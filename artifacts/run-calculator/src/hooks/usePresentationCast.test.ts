// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePresentationCast, presentationCastSupported } from "./usePresentationCast";

const CAST_IDS_KEY = "cast-presentation-ids-v1";

afterEach(() => {
  localStorage.clear();
  delete (window as any).PresentationRequest;
});

describe("usePresentationCast", () => {
  it("reports unsupported when PresentationRequest is absent (Safari/Firefox)", () => {
    expect(presentationCastSupported()).toBe(false);
    const { result } = renderHook(() => usePresentationCast(true));
    expect(result.current.supported).toBe(false);
    expect(result.current.casts).toEqual({});
  });

  it("startCast fails soft with a friendly error when unsupported", async () => {
    const { result } = renderHook(() => usePresentationCast(true));
    let res: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      res = await result.current.startCast("dashboard", "https://x/?screen=dashboard");
    });
    expect(res?.ok).toBe(false);
    expect(res?.error).toMatch(/not supported/i);
  });

  it("stopCast on a never-started key is a no-op that does not throw", () => {
    const { result } = renderHook(() => usePresentationCast(true));
    act(() => result.current.stopCast("dough"));
    expect(result.current.casts).toEqual({});
  });

  it("detects support when PresentationRequest exists", () => {
    class FakeRequest {
      constructor(_urls: string[]) {}
      start() {
        return new Promise<never>(() => {});
      }
      reconnect() {
        return Promise.reject(new Error("gone"));
      }
    }
    (window as any).PresentationRequest = FakeRequest;
    expect(presentationCastSupported()).toBe(true);
    const { result } = renderHook(() => usePresentationCast(true));
    expect(result.current.supported).toBe(true);
  });

  it("reconnect attempt clears stale stored ids when reconnect fails", async () => {
    class FakeRequest {
      constructor(_urls: string[]) {}
      start() {
        return new Promise<never>(() => {});
      }
      reconnect(_id: string) {
        return Promise.reject(new DOMException("gone", "NotFoundError"));
      }
    }
    (window as any).PresentationRequest = FakeRequest;
    localStorage.setItem(
      CAST_IDS_KEY,
      JSON.stringify({ dashboard: { id: "old-id", url: "https://x/?screen=dashboard" } }),
    );
    renderHook(() => usePresentationCast(true));
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
    expect(JSON.parse(localStorage.getItem(CAST_IDS_KEY) || "{}")).toEqual({});
  });

  it("does not attempt reconnect when disabled (cast display itself)", async () => {
    let reconnectCalls = 0;
    class FakeRequest {
      constructor(_urls: string[]) {}
      start() {
        return new Promise<never>(() => {});
      }
      reconnect(_id: string) {
        reconnectCalls++;
        return Promise.reject(new Error("gone"));
      }
    }
    (window as any).PresentationRequest = FakeRequest;
    localStorage.setItem(
      CAST_IDS_KEY,
      JSON.stringify({ dashboard: { id: "old-id", url: "https://x/?screen=dashboard" } }),
    );
    renderHook(() => usePresentationCast(false));
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
    expect(reconnectCalls).toBe(0);
    // Stored id must be preserved so the controller device can still reconnect.
    expect(JSON.parse(localStorage.getItem(CAST_IDS_KEY) || "{}")).toHaveProperty("dashboard");
  });
});
