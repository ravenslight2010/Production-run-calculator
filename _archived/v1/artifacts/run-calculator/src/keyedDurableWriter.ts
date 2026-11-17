export type PendingDurableWrite = () => void;

type PendingEntry = {
  write: PendingDurableWrite;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Coalesces high-frequency synchronous browser persistence by identity key.
 * The callback captures its own run/user/scope identity; the writer never
 * consults mutable application state when a delayed write finally runs.
 */
export class KeyedDurableWriter {
  private readonly pending = new Map<string, PendingEntry>();

  constructor(private readonly delayMs: number) {}

  schedule(key: string, write: PendingDurableWrite): void {
    if (!key) return;
    const existing = this.pending.get(key);
    if (existing) {
      // Replace only the payload. Keeping the original timer makes the delay
      // bounded even when input events arrive continuously.
      existing.write = write;
      return;
    }
    const timer = setTimeout(() => this.flush(key), this.delayMs);
    this.pending.set(key, { write, timer });
  }

  flush(key: string): void {
    const entry = this.pending.get(key);
    if (!entry) return;
    this.pending.delete(key);
    clearTimeout(entry.timer);
    try {
      entry.write();
    } catch {
      // A transient persistence failure must not discard the newest value.
      this.schedule(key, entry.write);
    }
  }

  flushAll(): void {
    for (const key of [...this.pending.keys()]) this.flush(key);
  }

  cancel(key: string): void {
    const entry = this.pending.get(key);
    if (entry) clearTimeout(entry.timer);
    this.pending.delete(key);
  }

  hasPending(key?: string): boolean {
    return key === undefined ? this.pending.size > 0 : this.pending.has(key);
  }
}