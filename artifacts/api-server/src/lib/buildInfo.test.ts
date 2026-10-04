import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const file = vi.hoisted(() => ({
  read: vi.fn(),
  stat: vi.fn(() => ({ isFile: () => true, isSymbolicLink: () => false, size: 1024 })),
}));
vi.mock("node:fs", async (original) => ({
  ...await original<typeof import("node:fs")>(),
  readFileSync: file.read, lstatSync: file.stat,
}));

const stamp = {
  schemaVersion: 1, kind: "app-build-info",
  appBuildId: "app-build:00000000-0000-0000-0000-000000000000",
  sourcePolicy: "production-source-v1", sourceFingerprintSha256: "a".repeat(64),
  gitRevision: "b".repeat(40), gitBinding: "verified",
  completedAt: "2026-10-03T23:00:00.000Z", buildMode: "release",
  platformDeploymentId: null, platformBuildId: null, platformIdentitySource: "unavailable",
};

beforeEach(() => {
  vi.resetModules();
  file.read.mockReset().mockReturnValue(Buffer.from(JSON.stringify(stamp)));
  vi.stubEnv("REPLIT_DEPLOYMENT_ID", "");
  vi.stubEnv("REPLIT_BUILD_ID", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("sealed artifact version", () => {
  it("loads once and ignores later filesystem, HEAD and environment-version edits", async () => {
    const { getBuildInfo } = await import("./buildInfo");
    const first = getBuildInfo();
    file.read.mockReturnValue(Buffer.from("{}"));
    vi.stubEnv("GIT_COMMIT", "f".repeat(40));
    vi.stubEnv("RELEASE_REVISION", "f".repeat(40));
    expect(getBuildInfo()).toEqual(stamp);
    expect(getBuildInfo()).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(file.read).toHaveBeenCalledTimes(1);
  });

  it("a fresh process/module reads the same artifact identity", async () => {
    const first = (await import("./buildInfo")).getBuildInfo();
    vi.resetModules();
    expect((await import("./buildInfo")).getBuildInfo()).toEqual(first);
  });

  it("reports platform IDs separately without treating them as a verified handoff", async () => {
    vi.stubEnv("REPLIT_DEPLOYMENT_ID", "fixture-deployment");
    const info = (await import("./buildInfo")).getBuildInfo();
    expect(info?.platformIdentitySource).toBe("runtime-reported");
    expect(info?.platformDeploymentId).toBe("fixture-deployment");
    expect(info?.appBuildId).toBe(stamp.appBuildId);
  });

  it("rejects missing, malformed or sensitive-extra-field records instead of inventing a version", async () => {
    for (const value of ["{}", "invalid", JSON.stringify({ ...stamp, password: "synthetic" })]) {
      vi.resetModules();
      file.read.mockReturnValue(Buffer.from(value));
      expect((await import("./buildInfo")).getBuildInfo()).toBeNull();
    }
    vi.resetModules();
    file.read.mockImplementation(() => { throw new Error("fixture missing record"); });
    expect((await import("./buildInfo")).getBuildInfo()).toBeNull();
  });
});