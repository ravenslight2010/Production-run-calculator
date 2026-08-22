import { describe, expect, it } from "vitest";
import { SingleFlightSyncQueue } from "./syncPushQueue";

describe("SingleFlightSyncQueue", () => {
  it("releases a stale-dated push and starts the newer queued request", () => {
    const queue = new SingleFlightSyncQueue<string>();

    expect(queue.begin("yesterday")).toBe(true);
    expect(queue.begin("today")).toBe(false);

    // The first request is dropped at midnight before it reaches fetch.
    expect(queue.finish({ drainQueued: true })).toBe("today");
    expect(queue.isInFlight).toBe(false);
    expect(queue.begin("today")).toBe(true);
  });

  it("drops queued work after a terminal failure so it cannot publish later", () => {
    const queue = new SingleFlightSyncQueue<string>();

    expect(queue.begin("older")).toBe(true);
    expect(queue.begin("newer")).toBe(false);

    expect(queue.finish({ drainQueued: false })).toBeNull();
    expect(queue.isInFlight).toBe(false);
    // A later edit starts cleanly; the discarded "newer" snapshot is never
    // returned for a delayed follow-up write.
    expect(queue.begin("freshest")).toBe(true);
    expect(queue.finish({ drainQueued: true })).toBeNull();
  });
});