import { useRef, useState } from "react";
import { createSyncBaselineGate } from "../domain/runSyncPolicy";
import type { ForegroundStopIntent } from "../foregroundLifecycleIntent";

/**
 * The refs which coordinate Home's receive, reset and foreground-wake paths.
 * This is deliberately ref/state-only: Home retains protocol construction and
 * canonical day/form ownership, so extracting this boundary cannot alter the
 * sync transport or timing formulas.
 */
export function useHomeSyncCoordination() {
  const syncBaselineGateRef = useRef(createSyncBaselineGate());
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
  const [autoTrackBlocked, setAutoTrackBlocked] = useState(false);
  const [autoTrackRebaseAfterBlock, setAutoTrackRebaseAfterBlock] = useState(false);
  const [pendingForegroundStopRunId, setPendingForegroundStopRunId] = useState<string | null>(null);
  const [foregroundSyncAcknowledgement, setForegroundSyncAcknowledgement] = useState(0);
  const [foregroundRecoveryNotice, setForegroundRecoveryNotice] = useState<{
    kind: "recovering" | "failed" | "outcome";
    message: string;
  } | null>(null);

  return {
    syncBaselineGateRef,
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
  };
}