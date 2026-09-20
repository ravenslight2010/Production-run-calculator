import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Home sync manager boundary", () => {
  it("keeps transport primitives out of Home", () => {
    const home = readFileSync(resolve(import.meta.dirname, "pages/home.tsx"), "utf8");

    // These are manager-owned coordination concerns. Home only supplies the
    // canonical state/form callbacks that preserve the existing merge policy.
    expect(home).not.toContain("Event" + "Source");
    expect(home).not.toContain("SingleFlight" + "SyncQueue");
    expect(home).not.toContain("createSync" + "BaselineGate");
    expect(home).not.toMatch(/fetch\(`\/api\/sync\/today[^`]*`,\s*\{\s*method:\s*"PUT"/);
  });

  it("keeps every terminal local-write diagnostic classified for the manager alert", () => {
    const home = readFileSync(resolve(import.meta.dirname, "pages/home.tsx"), "utf8");
    const terminalWriteSections = [
      home.slice(
        home.indexOf("if (res.status === 401 || res.status === 403)"),
        home.indexOf("// Any other non-success response must follow the retry path below."),
      ),
      home.slice(
        home.indexOf("if (stale) {"),
        home.indexOf("const latencyMs ="),
      ),
      home.slice(
        home.indexOf('recordSyncEvent(\n        "ack"'),
        home.indexOf("// Record the synced signature ONLY after a successful PUT"),
      ),
      home.slice(
        home.indexOf("// All retries exhausted"),
        home.indexOf("syncPushQueueRef.current.finish({ drainQueued: false });", home.indexOf("// All retries exhausted")),
      ),
    ];

    expect(terminalWriteSections.every((section) => section.includes("syncWriteFieldCheck"))).toBe(true);
    expect(home.match(/syncWriteFieldCheck/g)).toHaveLength(5);
  });
});
