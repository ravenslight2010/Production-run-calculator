import { afterEach, describe, expect, it, vi } from "vitest";
import { createOutboxDatabaseObserver } from "./outboxDatabaseTelemetry";
import { startDatabasePhaseCheckout, summarizeDatabasePhaseRecords } from "./databasePhaseTelemetry";

afterEach(() => { vi.restoreAllMocks(); });

describe("sampled outbox read evidence", () => {
  it("bounds each fixed stage/category independently and preserves returned values and errors", async () => {
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const publish = vi.fn();
    const read = createOutboxDatabaseObserver(publish, () => false);
    const value = { rows: [{ private: "never logged" }] };
    const success = () => { startDatabasePhaseCheckout(900)(); return value; };
    for (let i = 0; i < 100; i++) {
      expect(await read("outbox_scope_list", success)).toBe(value);
    }
    expect(publish).toHaveBeenCalledTimes(1);
    const error = new Error("Connection terminated due to connection timeout");
    const failure = () => {
      const finishCheckout = startDatabasePhaseCheckout(900);
      clock += 1000;
      finishCheckout(error);
      throw error;
    };
    for (let i = 0; i < 10; i++) {
      await expect(read("outbox_scope_list", failure)).rejects.toBe(error);
    }
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls[1]![0]).toMatchObject({
      stage: "outbox_scope_list", phase: "acquisition", acquisitionMs: 1000,
      postCheckoutMs: null, timeoutOverrunMs: 100, outcome: "connection_timeout",
    });
    await read("outbox_cursor_read", success);
    expect(publish).toHaveBeenCalledTimes(3);
    clock = 70_000;
    await read("outbox_scope_list", success);
    expect(publish).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(publish.mock.calls)).not.toMatch(/never logged|Connection terminated/);
  });

  it("retains slow successes separately and the offline summary accepts outbox stages", async () => {
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const publish = vi.fn();
    const read = createOutboxDatabaseObserver(publish, () => false);
    await read("outbox_events_read", () => { startDatabasePhaseCheckout(900)(); });
    await read("outbox_events_read", () => {
      startDatabasePhaseCheckout(900)();
      clock += 1200;
    });
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls[1]![0]).toMatchObject({
      stage: "outbox_events_read", postCheckoutMs: 1200, outcome: "success",
    });
    expect(summarizeDatabasePhaseRecords(publish.mock.calls.map(([databasePhase]) =>
      ({ event: "background_database_phase", databasePhase })))).toMatchObject({
      records: 2, legacyOrInvalid: 0, phases: { post_checkout: 2 },
    });
  });

  it("does not let a broken sink change a query result and emits nothing after stop", async () => {
    let stopped = false;
    const publish = vi.fn(() => { throw new Error("sink failed"); });
    const read = createOutboxDatabaseObserver(publish, () => stopped);
    await expect(read("outbox_scope_list", () => 42)).resolves.toBe(42);
    let finish!: () => void;
    const pending = read("outbox_cursor_read", () => new Promise<void>((resolve) => { finish = resolve; }));
    stopped = true;
    finish();
    await pending;
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
