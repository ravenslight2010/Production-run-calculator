import { useCallback, useMemo, useRef, useState } from "react";
import { createSyncBaselineGate } from "../domain/runSyncPolicy";
import type { ForegroundStopIntent } from "../foregroundLifecycleIntent";
import { SingleFlightSyncQueue } from "../syncPushQueue";
import { SynchronizationStateMachine } from "../synchronizationStateMachine";
import { createForegroundSyncWakeGuard } from "../foregroundSyncWakeGuard";
import type { SyncPayload } from "../types";
import type { SyncMeasurementTrigger } from "../syncDiagnostics";
import { todayStr } from "../utils";

type SyncWork = {
  payload: SyncPayload;
  sig?: string;
  queuedAtPerf?: number;
  queuedAtEpoch?: number;
  trigger?: SyncMeasurementTrigger;
};

type SseConnection = {
  clientId: string;
  getSnapshot: () => string;
  onOpen: () => void;
  /**
   * Returns true only after an initial frame has established Home's canonical
   * baseline. Reset/rollover frames and failed handlers must return false.
   */
  onMessage: (event: MessageEvent) => boolean;
  onError: () => void;
  onInitialBaseline: (shouldPush: boolean) => void;
  onClose: () => void;
};

type TodayWrite = {
  payload: SyncPayload;
  clientId: string;
  snapshotId: string;
  epoch: number;
  signal?: AbortSignal;
  queuedAtEpoch?: number;
};

type ForegroundScheduler = {
  register: (task: {
    id: string;
    runOnForeground: boolean;
    order: number;
    run: () => Promise<boolean>;
  }) => () => void;
};

/** Only a reset marker newer than local durable state may interrupt baseline adoption. */
export function initialResetRequiresReload(messageEpoch: number, storedEpoch: number): boolean {
  return messageEpoch > storedEpoch;
}

/**
 * Owns Home's narrow sync transport coordination boundary. Home supplies
 * canonical state/form merge callbacks; this hook owns mutable coordination,
 * queue lifetime, and EventSource baseline/reconnect fencing. Keeping the
 * protocol callbacks injected makes the ownership boundary explicit without
 * changing any sync timing or merge policy.
 */
export function useHomeSyncCoordination() {
  const synchronizationStateMachineRef = useRef(new SynchronizationStateMachine<any>());
  const syncBaselineGateRef = useRef(createSyncBaselineGate(synchronizationStateMachineRef.current));
  const isSyncApplyingRef = useRef(false);
  const syncApplyPushPendingRef = useRef(false);
  const foregroundSyncBarrierRef = useRef(false);
  const foregroundPushPendingRef = useRef(false);
  const foregroundStopIntentRef = useRef<ForegroundStopIntent | null>(null);
  const foregroundRecoveryRetryRef = useRef<(() => Promise<boolean>) | null>(null);
  const foregroundRecoveryNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const foregroundRecoveryOwnerRef = useRef(0);
  const syncPushGenerationRef = useRef(0);
  const syncPushAbortControllersRef = useRef<Set<AbortController>>(new Set());
  const syncRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncPushQueueRef = useRef(
    new SingleFlightSyncQueue<SyncWork>(synchronizationStateMachineRef.current),
  );
  const [autoTrackBlocked, setAutoTrackBlocked] = useState(false);
  const [autoTrackRebaseAfterBlock, setAutoTrackRebaseAfterBlock] = useState(false);
  const [pendingForegroundStopRunId, setPendingForegroundStopRunId] = useState<string | null>(null);
  const [foregroundSyncAcknowledgement, setForegroundSyncAcknowledgement] = useState(0);
  const [foregroundRecoveryNotice, setForegroundRecoveryNotice] = useState<{
    kind: "recovering" | "failed" | "outcome";
    message: string;
  } | null>(null);

  const connectSse = useCallback((connection: SseConnection) => {
    syncBaselineGateRef.current.beginConnection();
    const snapshot = connection.getSnapshot();
    const url = snapshot
      ? `/api/sync/events?clientId=${connection.clientId}&today=${todayStr()}&snapshot=${snapshot}`
      : `/api/sync/events?clientId=${connection.clientId}&today=${todayStr()}`;
    const source = new EventSource(url);
    source.onopen = connection.onOpen;
    source.onmessage = (event) => {
      const baselineAccepted = connection.onMessage(event);
      try {
        if (
          baselineAccepted &&
          (JSON.parse(event.data as string) as { initial?: boolean }).initial
        ) {
          connection.onInitialBaseline(syncBaselineGateRef.current.completeInitialSnapshot());
        }
      } catch {
        // Home's callback preserves its existing malformed-frame tolerance.
      }
    };
    source.onerror = () => {
      syncBaselineGateRef.current.beginConnection();
      connection.onError();
    };
    return () => {
      source.close();
      connection.onClose();
    };
  }, []);

  // The write construction lives beside queue ownership so every Home caller
  // uses the same epoch, snapshot and optional queue-age envelope.
  const writeToday = useCallback(({ payload, clientId, snapshotId, epoch, signal, queuedAtEpoch }: TodayWrite) =>
    fetch(`/api/sync/today?today=${todayStr()}&epoch=${epoch}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        senderId: clientId,
        payload,
        snapshotId: snapshotId || undefined,
        ...(queuedAtEpoch ? { syncMeta: { queuedAt: queuedAtEpoch } } : {}),
      }),
      signal,
    }), []);

  const requestBaselinePush = useCallback(
    () => syncBaselineGateRef.current.requestPush(),
    [],
  );

  // The manager owns wake guard and online/listener lifetime. The injected
  // recovery callback deliberately leaves canonical day/form adoption in Home.
  const registerForegroundRecovery = useCallback((
    scheduler: ForegroundScheduler,
    recover: () => Promise<boolean>,
  ) => {
    const reconcile = createForegroundSyncWakeGuard(recover);
    const onOnline = () => {
      if (!document.hidden) void reconcile();
    };
    window.addEventListener("online", onOnline);
    const unregister = scheduler.register({
      id: "foreground-reconcile",
      runOnForeground: true,
      order: 0,
      run: reconcile,
    });
    return {
      reconcile,
      dispose: () => {
        window.removeEventListener("online", onOnline);
        unregister();
      },
    };
  }, []);

  return useMemo(() => ({
    syncBaselineGateRef,
    synchronizationStateMachineRef,
    isSyncApplyingRef,
    syncApplyPushPendingRef,
    foregroundSyncBarrierRef,
    foregroundPushPendingRef,
    foregroundStopIntentRef,
    foregroundRecoveryRetryRef,
    foregroundRecoveryNoticeTimerRef,
    foregroundRecoveryOwnerRef,
    syncPushGenerationRef,
    syncPushAbortControllersRef,
    syncRetryTimerRef,
    syncPushQueueRef,
    connectSse,
    writeToday,
    requestBaselinePush,
    registerForegroundRecovery,
    autoTrackBlocked,
    setAutoTrackBlocked,
    autoTrackRebaseAfterBlock,
    setAutoTrackRebaseAfterBlock,
    pendingForegroundStopRunId,
    setPendingForegroundStopRunId,
    foregroundSyncAcknowledgement,
    setForegroundSyncAcknowledgement,
    foregroundRecoveryNotice,
    setForegroundRecoveryNotice,
  }), [
    autoTrackBlocked,
    autoTrackRebaseAfterBlock,
    connectSse,
    foregroundRecoveryNotice,
    foregroundSyncAcknowledgement,
    pendingForegroundStopRunId,
    registerForegroundRecovery,
    requestBaselinePush,
    writeToday,
  ]);
}