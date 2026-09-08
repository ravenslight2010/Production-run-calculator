import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("run lifecycle manager ownership", () => {
  it("keeps executable lifecycle command implementations out of Home", () => {
    const home = readFileSync(resolve(process.cwd(), "src/pages/home.tsx"), "utf8");
    const manager = readFileSync(resolve(process.cwd(), "src/hooks/useRunLifecycleManager.ts"), "utf8");

    expect(home).toContain("useRunLifecycleManager({");
    for (const command of [
      "switchToRun", "startRun", "pauseRun", "setPauseTunnelPolicy", "resumeRun", "endRun",
    ]) {
      expect(home).not.toMatch(new RegExp(`function\\s+${command}\\s*\\(`));
      expect(manager).toMatch(new RegExp(`const\\s+${command}\\s*=\\s*useEvent\\(`));
    }
  });
});