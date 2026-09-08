export type VisibleTabJob = {
  id: string;
  cadenceMs?: number;
  runOnStart?: boolean;
  runOnForeground?: boolean;
  order: number;
  run: () => unknown | Promise<unknown>;
};

type RegisteredJob = VisibleTabJob & { nextDueAt: number };

/**
 * One visibility-aware scheduler for Home's non-essential periodic work.
 * Jobs are always serialized so a slow reconciliation cannot overlap another
 * pass, and hidden tabs retain their due work without running it.
 */
export class VisibleTabScheduler {
  private jobs = new Map<string, RegisteredJob>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private running: Promise<void> | null = null;
  private foregroundQueued = false;
  private lastForegroundAt = 0;

  register(job: VisibleTabJob): () => void {
    const now = Date.now();
    this.jobs.set(job.id, {
      ...job,
      nextDueAt: job.runOnStart ? now : now + (job.cadenceMs ?? Number.POSITIVE_INFINITY),
    });
    this.schedule();
    return () => {
      this.jobs.delete(job.id);
      this.schedule();
    };
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("focus", this.onFocus);
    this.schedule();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.clearTimer();
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("focus", this.onFocus);
  }

  private onVisibility = (): void => {
    if (document.hidden) {
      this.clearTimer();
      return;
    }
    this.queueForeground();
  };

  private onFocus = (): void => {
    if (!document.hidden) this.queueForeground();
  };

  private queueForeground(): void {
    const now = Date.now();
    if (now - this.lastForegroundAt < 500) return;
    this.lastForegroundAt = now;
    this.foregroundQueued = true;
    void this.drain();
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    this.clearTimer();
    if (!this.started || document.hidden || this.running || this.jobs.size === 0) return;
    const nextDueAt = Math.min(...[...this.jobs.values()]
      .filter((job) => job.cadenceMs != null)
      .map((job) => job.nextDueAt));
    if (!Number.isFinite(nextDueAt)) return;
    this.timer = setTimeout(() => void this.drain(), Math.max(0, nextDueAt - Date.now()));
  }

  private drain(): Promise<void> {
    if (this.running) return this.running;
    if (!this.started || document.hidden) {
      this.schedule();
      return Promise.resolve();
    }
    const foreground = this.foregroundQueued;
    this.foregroundQueued = false;
    const now = Date.now();
    const due = [...this.jobs.values()]
      .filter((job) => (foreground && job.runOnForeground) || (job.cadenceMs != null && job.nextDueAt <= now))
      .sort((a, b) => a.order - b.order);
    this.running = (async () => {
      for (const job of due) {
        if (!this.started || document.hidden) break;
        if (job.cadenceMs != null) job.nextDueAt = now + job.cadenceMs;
        try {
          await job.run();
        } catch {
          // Every scheduled domain is best-effort; one failure must not starve
          // the remaining independent jobs.
        }
      }
    })().finally(() => {
      this.running = null;
      if (this.foregroundQueued) void this.drain();
      else this.schedule();
    });
    return this.running;
  }
}