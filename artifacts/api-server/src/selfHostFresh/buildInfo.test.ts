import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const file = vi.hoisted(() => ({
  read: vi.fn(),
  stat: vi.fn(() => ({
    isFile: () => true,
    isSymbolicLink: () => false,
    size: 1024,
  })),
}));
vi.mock("node:fs", async (original) => ({
  ...(await original<typeof import("node:fs")>()),
  readFileSync: file.read,
  lstatSync: file.stat,
}));
const stamp = {
  schemaVersion: 1,
  kind: "app-build-info",
  appBuildId: "app-build:00000000-0000-0000-0000-000000000000",
  sourcePolicy: "self-host-fresh-source-v1",
  sourceFingerprintSha256: "a".repeat(64),
  gitRevision: null,
  gitBinding: "unavailable",
  completedAt: "2026-10-31T01:00:00.000Z",
  buildMode: "self-host-fresh",
  platformDeploymentId: null,
  platformBuildId: null,
  platformIdentitySource: "unavailable",
};
beforeEach(() => {
  vi.resetModules();
  file.read.mockReset().mockReturnValue(Buffer.from(JSON.stringify(stamp)));
});
afterEach(() => vi.unstubAllEnvs());
describe("fresh sealed runtime identity", () => {
  it("loads once and ignores ambient mode/Replit labels", async () => {
    vi.stubEnv("BUILD_IDENTITY_MODE", "publish");
    vi.stubEnv("REPLIT_DEPLOYMENT_ID", "synthetic-deployment");
    const { getBuildInfo } = await import("./buildInfo");
    expect(getBuildInfo()).toEqual(stamp);
    expect(Object.isFrozen(getBuildInfo())).toBe(true);
    file.read.mockReturnValue(Buffer.from("{}"));
    expect(getBuildInfo()).toEqual(stamp);
    expect(file.read).toHaveBeenCalledTimes(1);
  });
  it("rejects production, mismatched, malformed and forged platform identities", async () => {
    for (const patch of [
      { sourcePolicy: "production-source-v4", buildMode: "release" },
      { buildMode: "release" },
      {
        platformDeploymentId: "synthetic",
        platformIdentitySource: "runtime-reported",
      },
      { secret: "synthetic" },
      { sourceFingerprintSha256: "wrong" },
    ]) {
      vi.resetModules();
      file.read.mockReturnValue(
        Buffer.from(JSON.stringify({ ...stamp, ...patch })),
      );
      expect((await import("./buildInfo")).getBuildInfo()).toBeNull();
    }
  });
});
