import { useRef } from "react";
import type { DayState, RunMeta } from "../types";

export interface HomeRunIdentity {
  currentRun: RunMeta | undefined;
  currentRunId: string;
  /**
   * Synchronous latest identity for effects and callbacks that intentionally
   * outlive a render (autosave, rollover, and packaging progress).
   */
  currentRunIdRef: React.MutableRefObject<string>;
}

/**
 * Derives the selected run once for Home's lifecycle coordinators.
 *
 * The ref is updated during render so event handlers and [] effects never read
 * an old run id after a peer sync or local selection change.
 */
export function useHomeRunIdentity(dayState: DayState): HomeRunIdentity {
  const currentRun = dayState.runs[dayState.currentIndex] ?? dayState.runs[0];
  const currentRunId = currentRun?.id ?? "";
  const currentRunIdRef = useRef(currentRunId);
  currentRunIdRef.current = currentRunId;
  return { currentRun, currentRunId, currentRunIdRef };
}