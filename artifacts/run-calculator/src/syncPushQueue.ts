import { SynchronizationStateMachine } from "./synchronizationStateMachine";

// One browser tab may have exactly one sync PUT/retry chain in flight. Local
// edits arriving during that chain replace the queued request, so the next
// write always uses the newest snapshot.
export class SingleFlightSyncQueue<T> {
  private readonly machine: SynchronizationStateMachine<T>;

  constructor(machine?: SynchronizationStateMachine<T>) {
    this.machine = machine ?? new SynchronizationStateMachine<T>();
    // Standalone queues predate connection-baseline coordination. Production
    // Home supplies its shared machine and therefore remains baseline-gated.
    if (!machine) this.machine.completeInitialSnapshot();
  }

  begin(item: T, internalRetry = false): boolean {
    return this.machine.beginPush(item, internalRetry);
  }

  // A successful write and a stale-date drop may continue with the newest
  // queued request. Terminal outcomes deliberately discard it: a later fresh
  // local edit starts its own request and cannot be followed by an older body.
  finish({ drainQueued }: { drainQueued: boolean }): T | null {
    return this.machine.finishPush(drainQueued ? "acknowledged" : "terminal");
  }

  // Retries remain part of the active chain. They may take the newest queued
  // body without releasing the in-flight lock while the retry timer is pending.
  takeQueued(): T | null {
    return this.machine.takeQueued();
  }

  reset(): void {
    this.machine.invalidate();
  }

  get isInFlight(): boolean {
    return this.machine.isInFlight;
  }
}