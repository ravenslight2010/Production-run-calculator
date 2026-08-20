import { describe, expect, it, vi } from "vitest";
import { consumeSyncWriteResponse } from "./syncWriteResponse";

describe("consumeSyncWriteResponse", () => {
  it("immediately self-applies the server canonical payload on a successful write", async () => {
    const applyCanonical = vi.fn();
    const canonical = {
      runValues: {
        run1: { skidsCompleted: 1, casesOnCurrentSkid: 24 },
      },
      packagingProgress: {
        run1: {
          skidsCompleted: 1,
          casesOnCurrentSkid: 24,
          correctionGeneration: 2,
          updatedAt: 200,
          manualOverrideUntil: 60_200,
        },
      },
    };

    const result = await consumeSyncWriteResponse(
      new Response(JSON.stringify({ ok: true, data: canonical }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      { applyCanonical },
    );

    expect(result.stale).toBe(false);
    expect(applyCanonical).toHaveBeenCalledOnce();
    expect(applyCanonical).toHaveBeenCalledWith(canonical);
  });

  it("handles reset-stale responses without applying their data", async () => {
    const applyCanonical = vi.fn();
    const onStale = vi.fn();
    const result = await consumeSyncWriteResponse(
      new Response(JSON.stringify({ ok: true, stale: true, epoch: 7 }), {
        status: 200,
      }),
      { applyCanonical, onStale },
    );

    expect(result.stale).toBe(true);
    expect(onStale).toHaveBeenCalledWith(
      expect.objectContaining({ stale: true, epoch: 7 }),
    );
    expect(applyCanonical).not.toHaveBeenCalled();
  });

  it("does not apply data from an unsuccessful response", async () => {
    const applyCanonical = vi.fn();
    await consumeSyncWriteResponse(
      new Response(JSON.stringify({ data: { runValues: {} } }), { status: 500 }),
      { applyCanonical },
    );
    expect(applyCanonical).not.toHaveBeenCalled();
  });

  it("ignores a response invalidated while its body was being read", async () => {
    const applyCanonical = vi.fn();
    const onStale = vi.fn();
    const result = await consumeSyncWriteResponse(
      new Response(JSON.stringify({
        stale: true,
        data: { runValues: { run1: { casesOnCurrentSkid: 99 } } },
      }), { status: 200 }),
      {
        applyCanonical,
        onStale,
        shouldConsume: () => false,
      },
    );

    expect(result.stale).toBe(false);
    expect(applyCanonical).not.toHaveBeenCalled();
    expect(onStale).not.toHaveBeenCalled();
  });
});