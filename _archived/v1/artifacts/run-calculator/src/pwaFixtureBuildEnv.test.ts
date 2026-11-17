// @vitest-environment node
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pwaFixtureBuildEnv } from "../e2e/pwaFixtureBuildEnv";

describe("isolated PWA fixture build environment", () => {
  it.each([undefined, "development", "test", "production"])(
    "requires production flags even when the parent NODE_ENV is %s",
    (NODE_ENV) => {
      expect(pwaFixtureBuildEnv({ NODE_ENV }, "old").NODE_ENV).toBe("production");
    },
  );

  it.each(["old", "new"] as const)("retains distinct %s identity and existing fixture timing", (version) => {
    const result = pwaFixtureBuildEnv({}, version);
    expect(result.PWA_HANDOFF_BUILD_ID).toBe(`pwa-${version}-build`);
    expect(result.VITE_UPDATE_RELOAD_IDLE_MS).toBe("1000");
  });

  it("preserves unrelated flags without mutating the development parent", () => {
    const parent = Object.freeze({
      NODE_ENV: "development",
      CUSTOM_FIXTURE_FLAG: "retained",
    });
    const result = pwaFixtureBuildEnv(parent, "new");
    expect(result.CUSTOM_FIXTURE_FLAG).toBe("retained");
    expect(parent.NODE_ENV).toBe("development");
    expect(result).not.toBe(parent);
  });

  it("resolves real Vite build flags as production despite a development parent", () => {
    const output = execFileSync(process.execPath, [
      "--input-type=module",
      "--eval",
      `
        import { resolveConfig } from "vite";
        const config = await resolveConfig({
          configFile: false,
          envFile: false,
          logLevel: "silent",
        }, "build", "production");
        console.log(JSON.stringify({
          development: config.env.DEV,
          production: config.env.PROD,
          isProduction: config.isProduction,
        }));
      `,
    ], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      env: pwaFixtureBuildEnv({ ...process.env, NODE_ENV: "development" }, "old"),
      encoding: "utf8",
      timeout: 4_000,
    });
    expect(JSON.parse(output)).toEqual({
      development: false,
      production: true,
      isProduction: true,
    });
  });
});
