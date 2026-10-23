import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  initialResetRequiresReload,
  useHomeSyncCoordination,
  type ForegroundRecoveryAttemptContext,
} from "./useHomeSyncCoordination";

class MockEventSource {
  static instances: MockEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();

  constructor(readonly url: string) {
    MockEventSource.instances.push(this);
  }

  emit(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

describe("useHomeSyncCoordination", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("interrupts a baseline only for a genuinely newer reset epoch", () => {
    expect(initialResetRequiresReload(8, 7)).toBe(true);
    expect(initialResetRequiresReload(7, 7)).toBe(false);
    expect(initialResetRequiresReload(6, 7)).toBe(false);
  });

  it("opens the baseline only after Home acknowledges canonical adoption", async () => {
    const { result } = renderHook(() => useHomeSyncCoordination());
    const onInitialBaseline = vi.fn();
    const onMessage = vi.fn<(event: MessageEvent) => boolean>()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    let disconnect!: () => void;
    act(() => {
      disconnect = result.current.connectSse({
        clientId: "client-a",
        getSnapshot: () => "snapshot-a",
        onOpen: vi.fn(),
        onMessage,
        onError: vi.fn(),
        onInitialBaseline,
        onClose: vi.fn(),
      });
    });

    const source = MockEventSource.instances[0]!;
    expect(source.url).toContain("clientId=client-a");
    expect(source.url).toContain("snapshot=snapshot-a");

    await act(async () => {
      source.emit({ initial: true, reset: true, resetEpoch: 2, data: { stale: true } });
      await Promise.resolve();
    });
    expect(onInitialBaseline).not.toHaveBeenCalled();
    expect(result.current.requestBaselinePush()).toBe(false);

    await act(async () => {
      source.emit({ initial: true, data: { adopted: true } });
      await Promise.resolve();
    });
    expect(onInitialBaseline).toHaveBeenCalledTimes(1);
    expect(onInitialBaseline).toHaveBeenCalledWith(true);

    act(() => disconnect());
    expect(source.close).toHaveBeenCalledTimes(1);
  });

  it("applies peer frames through the existing station sync callback without reopening the baseline", async () => {
    const { result } = renderHook(() => useHomeSyncCoordination());
    let displayedCases = 12;
    const onMessage = vi.fn<(event: MessageEvent) => boolean>((event) => {
      const frame = JSON.parse(event.data as string) as { cases?: number };
      if (typeof frame.cases === "number") displayedCases = frame.cases;
      return true;
    });
    const onInitialBaseline = vi.fn();

    let disconnect!: () => void;
    act(() => {
      disconnect = result.current.connectSse({
        clientId: "screen-display",
        getSnapshot: () => "snapshot-a",
        onOpen: vi.fn(),
        onMessage,
        onError: vi.fn(),
        onInitialBaseline,
        onClose: vi.fn(),
      });
    });
    const source = MockEventSource.instances[0]!;

    await act(async () => {
      source.emit({ initial: true, cases: 12 });
      await Promise.resolve();
    });
    await act(async () => {
      source.emit({ senderId: "production-device", cases: 18 });
      await Promise.resolve();
    });

    expect(displayedCases).toBe(18);
    expect(onInitialBaseline).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledTimes(2);
    act(() => disconnect());
  });

  it("reconnects with the new local date and ignores late frames from yesterday", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T23:59:59Z"));
    const { result, unmount } = renderHook(() => useHomeSyncCoordination());
    const onMessage = vi.fn<(event: MessageEvent, clientDate: string) => boolean>()
      .mockReturnValue(true);

    let disconnect!: () => void;
    act(() => {
      disconnect = result.current.connectSse({
        clientId: "client-a",
        getSnapshot: () => "",
        onOpen: vi.fn(),
        onMessage,
        onError: vi.fn(),
        onInitialBaseline: vi.fn(),
        onClose: vi.fn(),
      });
    });

    const yesterdaySource = MockEventSource.instances[0]!;
    expect(yesterdaySource.url).toContain("today=2026-09-14");

    vi.setSystemTime(new Date("2026-09-15T00:00:01Z"));
    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });

    const todaySource = MockEventSource.instances[1]!;
    expect(yesterdaySource.close).toHaveBeenCalledTimes(1);
    expect(todaySource.url).toContain("today=2026-09-15");

    await act(async () => {
      yesterdaySource.emit({ initial: true });
      await Promise.resolve();
    });
    expect(onMessage).not.toHaveBeenCalled();

    await act(async () => {
      todaySource.emit({ initial: true });
      await Promise.resolve();
    });
    expect(onMessage).toHaveBeenCalledWith(
      expect.anything(),
      "2026-09-15",
    );

    act(() => {
      disconnect();
      unmount();
    });
    vi.advanceTimersByTime(120_000);
    expect(MockEventSource.instances).toHaveLength(2);
    vi.useRealTimers();
  });

  it("routes an SSE drop through the foreground recovery owner", async () => {
    const { result } = renderHook(() => useHomeSyncCoordination());
    const recover = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const register = vi.fn((_task: {
      id: string;
      runOnForeground: boolean;
      order: number;
      run: () => Promise<boolean>;
    }) => vi.fn());
    let disconnect!: () => void;
    act(() => {
      disconnect = result.current.connectSse({
        clientId: "client-a",
        getSnapshot: () => "",
        onOpen: vi.fn(),
        onMessage: vi.fn(() => true),
        onError: vi.fn(),
        onInitialBaseline: vi.fn(),
        onClose: vi.fn(),
      });
    });
    let recovery!: { dispose: () => void };
    act(() => {
      recovery = result.current.registerForegroundRecovery(
        { register },
        recover,
      );
    });

    act(() => MockEventSource.instances[0]!.onerror?.());
    expect(recover).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      id: "foreground-reconcile",
      runOnForeground: true,
    }));

    act(() => {
      recovery.dispose();
      disconnect();
    });
  });

  it("does not lose an early SSE drop before recovery registration", () => {
    const { result } = renderHook(() => useHomeSyncCoordination());
    const recover = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const register = vi.fn(() => vi.fn());
    act(() => {
      result.current.connectSse({
        clientId: "client-a",
        getSnapshot: () => "",
        onOpen: vi.fn(),
        onMessage: vi.fn(() => true),
        onError: vi.fn(),
        onInitialBaseline: vi.fn(),
        onClose: vi.fn(),
      });
      MockEventSource.instances[0]!.onerror?.();
    });

    act(() => {
      result.current.registerForegroundRecovery({ register }, recover);
    });

    expect(recover).toHaveBeenCalledTimes(1);
  });

  it("keeps the imperative manager operations stable across state renders", () => {
    const { result } = renderHook(() => useHomeSyncCoordination());
    const operations = {
      connectSse: result.current.connectSse,
      writeToday: result.current.writeToday,
      requestBaselinePush: result.current.requestBaselinePush,
      registerForegroundRecovery: result.current.registerForegroundRecovery,
    };

    act(() => result.current.setAutoTrackBlocked(true));

    expect(result.current.connectSse).toBe(operations.connectSse);
    expect(result.current.writeToday).toBe(operations.writeToday);
    expect(result.current.requestBaselinePush).toBe(operations.requestBaselinePush);
    expect(result.current.registerForegroundRecovery).toBe(operations.registerForegroundRecovery);
  });

  it("retries failed recovery promptly without a periodic scheduler and stops after three retries", async () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useHomeSyncCoordination());
    const recover = vi.fn<() => Promise<boolean>>().mockResolvedValue(false);
    const register = vi.fn(() => vi.fn());
    const registration = result.current.registerForegroundRecovery({ register }, recover);
    await registration.reconcile();
    expect(recover).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1200);
    expect(recover).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(recover).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(recover).toHaveBeenCalledTimes(4);
    registration.dispose();
    unmount();
    vi.useRealTimers();
  });

  it("does not let an older successful pull settle a new offline/wake boundary", async () => {
    const { result, unmount } = renderHook(() => useHomeSyncCoordination());
    let finish!: (value: boolean) => void;
    let firstIsCurrent!: () => boolean;
    const recover = vi.fn()
      .mockImplementationOnce(({ isCurrent }) => {
        firstIsCurrent = isCurrent;
        return new Promise<boolean>((resolve) => { finish = resolve; });
      })
      .mockResolvedValue(true);
    const registration = result.current.registerForegroundRecovery({ register: () => () => {} }, recover);
    const first = registration.reconcile();
    expect(firstIsCurrent()).toBe(true);
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
    expect(firstIsCurrent()).toBe(false);
    finish(true);
    await first;
    expect(recover).toHaveBeenCalledTimes(2);
    registration.dispose();
    unmount();
  });

  it("coalesces duplicate wakes, clears retries on success and never retries permanent failures", async () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useHomeSyncCoordination());
    const register = vi.fn(() => vi.fn());
    const recover = vi.fn<() => Promise<boolean>>().mockResolvedValueOnce(false).mockResolvedValue(true);
    const registration = result.current.registerForegroundRecovery({ register }, recover);
    await Promise.all([registration.reconcile(), registration.reconcile(), registration.reconcile()]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(recover).toHaveBeenCalledTimes(2);
    registration.dispose();
    const permanent = vi.fn(async ({ classify }) => { classify("non-retryable-http"); return false; });
    const rejected = result.current.registerForegroundRecovery({ register }, permanent);
    await Promise.all([rejected.reconcile(), rejected.reconcile(), rejected.reconcile()]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(permanent).toHaveBeenCalledTimes(1);
    rejected.dispose();
    unmount();
    vi.useRealTimers();
  });

  it("cancels an obsolete in-flight read on offline and permits one fresh reconnect read", async () => {
    const { result, unmount } = renderHook(() => useHomeSyncCoordination());
    const attempts: ForegroundRecoveryAttemptContext[] = [];
    const recover = vi.fn(async (context: ForegroundRecoveryAttemptContext) => {
      attempts.push(context);
      if (attempts.length === 1) {
        await new Promise<void>((resolve) => context.signal.addEventListener("abort", () => resolve(), { once: true }));
        expect(context.isCurrent()).toBe(false);
        context.classify("cancelled");
        return false;
      }
      expect(context.signal.aborted).toBe(false);
      return true;
    });
    const registration = result.current.registerForegroundRecovery({ register: () => () => {} }, recover);
    const first = registration.reconcile();
    window.dispatchEvent(new Event("offline"));
    expect(attempts[0].signal.aborted).toBe(true);
    const reconnect = registration.reconcile("online");
    expect(await first).toBe(true);
    expect(await reconnect).toBe(true);
    expect(recover).toHaveBeenCalledTimes(2);
    registration.dispose();
    expect(attempts[1].signal.aborted).toBe(true);
    unmount();
  });

  it("serializes today writes with epoch, snapshot, and queue age", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useHomeSyncCoordination());
    const payload = { dayState: { date: "2026-09-08", runs: [], currentIndex: 0 } } as never;

    await result.current.writeToday({
      payload,
      clientId: "client-a",
      snapshotId: "snapshot-a",
      epoch: 7,
      queuedAtEpoch: 1234,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/api/sync/today?today=");
    expect(url).toContain("&epoch=7");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({
      senderId: "client-a",
      payload,
      snapshotId: "snapshot-a",
      syncMeta: { queuedAt: 1234 },
    });
  });
});