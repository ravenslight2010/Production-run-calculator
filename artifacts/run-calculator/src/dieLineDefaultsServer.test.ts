import { afterEach, describe, expect, it, vi } from "vitest";
import { saveDieLineDefaults, type DieLineDefaultsEntry } from "./dieLineDefaultsServer";

const storedEntry: DieLineDefaultsEntry = {
  name: '7" Dies',
  updatedAt: "2026-09-14T12:00:00.000Z",
  crustsPerCycle: 4,
  cycleSpeed: 9,
  speedAdjustment: 0.92,
  freezerTime: 30,
  casesPerLayer: 8,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saveDieLineDefaults freshness contract", () => {
  it("sends the loaded revision and adopts the newer server revision", async () => {
    const updated = {
      ...storedEntry,
      freezerTime: 25,
      updatedAt: "2026-09-14T12:01:00.000Z",
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ entries: [updated] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      saveDieLineDefaults([{ ...storedEntry, freezerTime: 25 }]),
    ).resolves.toEqual([updated]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      entries: [{ ...storedEntry, freezerTime: 25 }],
    });
  });

  it("rejects a stale-revision conflict instead of treating it as success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "STALE_DIE_LINE_DEFAULTS_SNAPSHOT",
            rejectedIds: ['7" dies'],
            entries: [storedEntry],
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(
      saveDieLineDefaults([{ ...storedEntry, freezerTime: 99 }]),
    ).rejects.toThrow("Save die line defaults failed (409)");
  });
});