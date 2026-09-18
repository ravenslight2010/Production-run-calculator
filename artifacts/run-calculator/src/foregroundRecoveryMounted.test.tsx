import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  StrictMode,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ForegroundRecoveryStatus,
  type ForegroundRecoveryNotice,
} from "./components/ForegroundRecoveryStatus";
import {
  releaseCancelledForegroundRecovery,
  releaseForegroundRecovery,
  useHomeSyncCoordination,
} from "./hooks/useHomeSyncCoordination";

type RecoveryTask = {
  runOnForeground?: boolean;
  cadenceMs?: number;
  run: () => Promise<boolean>;
};

type RecoveryScheduler = {
  register: (task: RecoveryTask) => () => void;
};

type MountedRecoveryHarnessProps = {
  pull: () => Promise<boolean>;
  scheduler: RecoveryScheduler;
  queueWriteOnStart?: boolean;
  onReplay: () => void;
  children?: ReactNode;
};

afterEach(() => {
  cleanup();
});

/**
 * This is deliberately mounted rather than testing the release helpers in
 * isolation. It uses the same coordination hook and status component as Home,
 * while keeping the test independent of Home's unrelated auth, form, and
 * master-data providers.
 */
function MountedHomeRecoveryHarness({
  pull,
  scheduler,
  queueWriteOnStart = false,
  onReplay,
  children,
}: MountedRecoveryHarnessProps) {
  const {
    foregroundPushPendingRef,
    foregroundRecoveryRetryRef,
    foregroundSyncBarrierRef,
    registerForegroundRecovery,
    setAutoTrackBlocked,
    autoTrackBlocked,
    foregroundSyncAcknowledgement,
  } = useHomeSyncCoordination();
  const [notice, setNotice] = useState<ForegroundRecoveryNotice | null>(null);

  const stableScheduler = useMemo(() => scheduler, [scheduler]);

  useEffect(() => {
    let cancelled = false;
    const recover = async (): Promise<boolean> => {
      foregroundSyncBarrierRef.current = true;
      foregroundPushPendingRef.current = queueWriteOnStart;
      setAutoTrackBlocked(true);
      setNotice({
        kind: "recovering",
        message: "Still recovering: checking the current production state…",
      });

      let succeeded = false;
      try {
        succeeded = await pull();
        if (!succeeded) {
          setNotice({
            kind: "failed",
            message:
              "Couldn't confirm the current production state. Your local work is retained and tracking is paused. Retry recovery when connected.",
          });
          return false;
        }

        if (cancelled) {
          releaseCancelledForegroundRecovery({
            discardQueuedWrite: () => {
              foregroundPushPendingRef.current = false;
            },
            releaseFence: () => {
              foregroundSyncBarrierRef.current = false;
              setAutoTrackBlocked(false);
            },
          });
        } else {
          releaseForegroundRecovery({
            releaseFence: () => {
              foregroundSyncBarrierRef.current = false;
              setAutoTrackBlocked(false);
            },
            acknowledgeRelease: () => undefined,
            takeQueuedWrite: () => {
              const queued = foregroundPushPendingRef.current;
              foregroundPushPendingRef.current = false;
              return queued;
            },
            replayQueuedWrite: onReplay,
          });
          setNotice({
            kind: "outcome",
            message: "Production state synchronized.",
          });
        }
        return true;
      } catch {
        setNotice({
          kind: "failed",
          message:
            "Couldn't confirm the current production state. Your local work is retained and tracking is paused. Retry recovery when connected.",
        });
        return false;
      }
    };

    const registration = registerForegroundRecovery(stableScheduler, recover);
    foregroundRecoveryRetryRef.current = registration.reconcile;
    return () => {
      cancelled = true;
      registration.dispose();
    };
  }, [
    foregroundPushPendingRef,
    foregroundRecoveryRetryRef,
    foregroundSyncBarrierRef,
    onReplay,
    pull,
    queueWriteOnStart,
    registerForegroundRecovery,
    setAutoTrackBlocked,
    stableScheduler,
  ]);

  return (
    <>
      <div data-testid="mounted-tracking-state">
        {autoTrackBlocked ? "Tracking paused" : "Tracking active"}
      </div>
      <div
        data-testid="mounted-recovery-fence"
        data-blocked={String(autoTrackBlocked)}
        data-fenced={String(foregroundSyncBarrierRef.current)}
        data-queued={String(foregroundPushPendingRef.current)}
      />
      {notice && (
        <ForegroundRecoveryStatus
          notice={notice}
          acknowledgement={foregroundSyncAcknowledgement}
          onRetry={() => {
            void foregroundRecoveryRetryRef.current?.();
          }}
          onDismiss={() => setNotice(null)}
        />
      )}
      {children}
    </>
  );
}

describe("mounted foreground recovery lifecycle", () => {
  it("clears the cancelled Strict Mode fence and drops its queued pre-wake write", async () => {
    let resolvePull!: (succeeded: boolean) => void;
    const pull = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolvePull = resolve;
        }),
    );
    const replay = vi.fn();
    let registrations = 0;
    const scheduler: RecoveryScheduler = {
      register: (task) => {
        registrations += 1;
        // React Strict Mode runs the first effect setup, cleans it up, then
        // runs the live setup. Complete only that cancelled first recovery.
        if (registrations === 1 && task.runOnForeground) queueMicrotask(() => void task.run());
        return () => undefined;
      },
    };

    render(
      <StrictMode>
        <MountedHomeRecoveryHarness
          pull={pull}
          scheduler={scheduler}
          queueWriteOnStart
          onReplay={replay}
        />
      </StrictMode>,
    );

    await waitFor(() => expect(pull).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("mounted-recovery-fence").getAttribute("data-fenced")).toBe("true");
    expect(screen.getByTestId("mounted-recovery-fence").getAttribute("data-queued")).toBe("true");

    resolvePull(true);
    await waitFor(() => {
      expect(screen.getByTestId("mounted-recovery-fence").getAttribute("data-fenced")).toBe("false");
    });

    const fence = screen.getByTestId("mounted-recovery-fence");
    expect(fence.getAttribute("data-blocked")).toBe("false");
    expect(fence.getAttribute("data-queued")).toBe("false");
    expect(screen.getByTestId("mounted-tracking-state").textContent).toBe("Tracking active");
    expect(replay).not.toHaveBeenCalled();
  });

  it("keeps a mounted failed recovery paused until the visible retry succeeds", async () => {
    const pull = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const replay = vi.fn();
    let liveRun: (() => Promise<boolean>) | undefined;
    const scheduler: RecoveryScheduler = {
      register: (task) => {
        if (task.runOnForeground) liveRun = task.run;
        return () => undefined;
      },
    };

    render(
      <StrictMode>
        <MountedHomeRecoveryHarness
          pull={pull}
          scheduler={scheduler}
          onReplay={replay}
        />
      </StrictMode>,
    );

    await waitFor(() => expect(liveRun).toBeDefined());
    await liveRun!();
    await waitFor(() => {
      expect(screen.getByTestId("foreground-recovery-status").getAttribute(
        "data-foreground-recovery-state",
      )).toBe("failed");
    });
    expect(screen.getByRole("button", { name: "Retry recovery" })).toBeTruthy();
    expect(screen.getByTestId("mounted-tracking-state").textContent).toBe("Tracking paused");
    expect(screen.getByTestId("mounted-recovery-fence").getAttribute("data-fenced")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Retry recovery" }));
    await waitFor(() => {
      expect(screen.getByTestId("foreground-recovery-status").getAttribute(
        "data-foreground-recovery-state",
      )).toBe("outcome");
    });
    expect(screen.getByTestId("mounted-tracking-state").textContent).toBe("Tracking active");
    expect(screen.getByTestId("mounted-recovery-fence").getAttribute("data-fenced")).toBe("false");
    expect(pull).toHaveBeenCalledTimes(2);
    expect(replay).not.toHaveBeenCalled();
  });
});