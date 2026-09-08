import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  initialResetRequiresReload,
  useHomeSyncCoordination,
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

  it("opens the baseline only after Home acknowledges canonical adoption", () => {
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

    act(() => source.emit({ initial: true, reset: true, resetEpoch: 2, data: { stale: true } }));
    expect(onInitialBaseline).not.toHaveBeenCalled();
    expect(result.current.requestBaselinePush()).toBe(false);

    act(() => source.emit({ initial: true, data: { adopted: true } }));
    expect(onInitialBaseline).toHaveBeenCalledTimes(1);
    expect(onInitialBaseline).toHaveBeenCalledWith(true);

    act(() => disconnect());
    expect(source.close).toHaveBeenCalledTimes(1);
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