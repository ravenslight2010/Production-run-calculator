// One browser tab may have exactly one sync PUT/retry chain in flight. Local
// edits arriving during that chain replace the queued request, so the next
// write always uses the newest snapshot.
export class SingleFlightSyncQueue<T> {
  private inFlight = false;
  private queued: T | null = null;

  begin(item: T, internalRetry = false): boolean {
    if (this.inFlight && !internalRetry) {
      this.queued = item;
      return false;
    }
    this.inFlight = true;
    return true;
  }

  // A successful write and a stale-date drop may continue with the newest
  // queued request. Terminal outcomes deliberately discard it: a later fresh
  // local edit starts its own request and cannot be followed by an older body.
  finish({ drainQueued }: { drainQueued: boolean }): T | null {
    this.inFlight = false;
    const queued = this.queued;
    this.queued = null;
    return drainQueued ? queued : null;
  }

  // Retries remain part of the active chain. They may take the newest queued
  // body without releasing the in-flight lock while the retry timer is pending.
  takeQueued(): T | null {
    const queued = this.queued;
    this.queued = null;
    return queued;
  }

  reset(): void {
    this.inFlight = false;
    this.queued = null;
  }

  get isInFlight(): boolean {
    return this.inFlight;
  }
}