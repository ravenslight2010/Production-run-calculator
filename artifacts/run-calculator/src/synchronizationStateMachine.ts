export type SynchronizationPhase =
  | "connecting"
  | "ready"
  | "pushing"
  | "waking"
  | "resetting";

export type SyncCompletion = "acknowledged" | "stale" | "terminal";

/**
 * Pure ordering state machine for one browser sync owner.
 *
 * Persistence, HTTP and domain merge callbacks stay outside. This class owns
 * only transition ordering: baseline-before-push, single-flight coalescing,
 * generation invalidation, wake-before-publish and reset cancellation.
 */
export class SynchronizationStateMachine<T> {
  private phaseValue: SynchronizationPhase = "connecting";
  private baselineReady = false;
  private deferredPush = false;
  private inFlight = false;
  private queued: T | null = null;
  private generationValue = 0;
  private pushGeneration = 0;
  private resetEpochValue = 0;

  beginConnection(): void {
    this.generationValue += 1;
    this.baselineReady = false;
    this.deferredPush = false;
    this.inFlight = false;
    this.queued = null;
    this.phaseValue = "connecting";
  }

  requestBaselinePush(): boolean {
    if (this.baselineReady && this.phaseValue !== "waking" && this.phaseValue !== "resetting") return true;
    this.deferredPush = true;
    return false;
  }

  completeInitialSnapshot(): boolean {
    this.baselineReady = true;
    this.phaseValue = "ready";
    const pending = this.deferredPush;
    this.deferredPush = false;
    return pending;
  }

  beginPush(item: T, internalRetry = false): boolean {
    if (!this.baselineReady || this.phaseValue === "waking" || this.phaseValue === "resetting") {
      this.deferredPush = true;
      return false;
    }
    if (this.inFlight && !internalRetry) {
      this.queued = item;
      return false;
    }
    this.inFlight = true;
    this.pushGeneration = this.generationValue;
    this.phaseValue = "pushing";
    return true;
  }

  finishPush(completion: SyncCompletion): T | null {
    if (this.pushGeneration !== this.generationValue) return null;
    this.inFlight = false;
    this.phaseValue = this.baselineReady ? "ready" : "connecting";
    const queued = this.queued;
    this.queued = null;
    return completion === "acknowledged" || completion === "stale" ? queued : null;
  }

  takeQueued(): T | null {
    const queued = this.queued;
    this.queued = null;
    return queued;
  }

  beginWake(): number {
    this.generationValue += 1;
    this.inFlight = false;
    this.queued = null;
    this.phaseValue = "waking";
    return this.generationValue;
  }

  completeWake(generation: number, adopted: boolean): boolean {
    if (generation !== this.generationValue || this.phaseValue !== "waking") return false;
    if (!adopted) return false;
    this.baselineReady = true;
    this.phaseValue = "ready";
    return true;
  }

  beginReset(epoch: number): number {
    this.generationValue += 1;
    this.resetEpochValue = Math.max(this.resetEpochValue, epoch);
    this.phaseValue = "resetting";
    this.inFlight = false;
    this.queued = null;
    this.deferredPush = false;
    return this.generationValue;
  }

  completeReset(generation: number): boolean {
    if (generation !== this.generationValue || this.phaseValue !== "resetting") return false;
    this.baselineReady = false;
    this.phaseValue = "connecting";
    return true;
  }

  invalidate(): number {
    this.generationValue += 1;
    this.inFlight = false;
    this.queued = null;
    this.deferredPush = false;
    this.phaseValue = this.baselineReady ? "ready" : "connecting";
    return this.generationValue;
  }

  get phase(): SynchronizationPhase { return this.phaseValue; }
  get generation(): number { return this.generationValue; }
  get resetEpoch(): number { return this.resetEpochValue; }
  get isReady(): boolean { return this.baselineReady; }
  get isInFlight(): boolean { return this.inFlight; }
}