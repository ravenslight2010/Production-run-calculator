import { expect, it } from "vitest";
import { VisibleTabScheduler } from "./visibleTabScheduler";
import { mkdir, writeFile } from "node:fs/promises";

// Real elapsed time, not fake-clock latency proof. Only the scheduling stage
// is measured here; authenticated browser and two-process tests own convergence.
it("measures the original serialized lane versus priority recovery under a stalled refresh", async () => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  const measure = async (priority: boolean) => {
    const scheduler = new VisibleTabScheduler();
    let started!: () => void;
    let adopted!: () => void;
    let release!: () => void;
    const backgroundStarted = new Promise<void>((resolve) => { started = resolve; });
    const recoveryAdopted = new Promise<void>((resolve) => { adopted = resolve; });
    const background = new Promise<void>((resolve) => { release = resolve; });
    scheduler.register({
      id: "master-data", cadenceMs: 60_000, runOnStart: true, order: 10,
      run: () => { started(); return background; },
    });
    scheduler.register({
      id: "canonical", runOnForeground: true, foregroundPriority: priority, order: 0,
      run: () => { adopted(); },
    });
    scheduler.start();
    await backgroundStarted;
    const began = performance.now();
    const timer = setTimeout(release, 5200);
    window.dispatchEvent(new Event("focus"));
    try {
      await recoveryAdopted;
      return Math.round(performance.now() - began);
    } finally {
      clearTimeout(timer);
      release();
      await Promise.resolve();
      scheduler.stop();
    }
  };
  const before: number[] = [];
  const after: number[] = [];
  for (let sample = 0; sample < 3; sample++) {
    before.push(await measure(false)); // same serialized policy as the baseline
    after.push(await measure(true));
  }
  console.info(`sync-scheduling-latency ${JSON.stringify({ stage: "wake-dispatch-only", condition: "5200ms-stalled-independent-refresh", before, after })}`);
  await mkdir("generated-artifacts/sync-latency", { recursive: true });
  await writeFile("generated-artifacts/sync-latency/scheduling.json", JSON.stringify({
    capturedAt: new Date().toISOString(), stage: "wake-dispatch-only",
    condition: "5200ms-stalled-independent-refresh", before, after,
  }, null, 2));
  expect(Math.min(...before)).toBeGreaterThanOrEqual(5000);
  expect(Math.max(...after)).toBeLessThan(1000);
}, 25_000);
