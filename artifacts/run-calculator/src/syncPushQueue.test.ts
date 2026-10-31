// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  shouldSendDistinctQueuedSyncWork,
  SingleFlightSyncQueue,
} from "./syncPushQueue";

describe("SingleFlightSyncQueue", () => {
  it("suppresses a queued snapshot already covered by the successful acknowledgement", () => {
    expect(shouldSendDistinctQueuedSyncWork("same-snapshot", "same-snapshot")).toBe(false);
    expect(shouldSendDistinctQueuedSyncWork("newer-snapshot", "same-snapshot")).toBe(true);
  });

  it("keeps conservative sending when either signature is unavailable", () => {
    expect(shouldSendDistinctQueuedSyncWork(undefined, "same-snapshot")).toBe(true);
    expect(shouldSendDistinctQueuedSyncWork("same-snapshot", undefined)).toBe(true);
  });

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