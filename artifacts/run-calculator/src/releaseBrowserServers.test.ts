import { afterEach, describe, expect, it } from "vitest";
import {
  RELEASE_BROWSER_BASE_URL,
  releaseBrowserBaseUrl,
  releaseBrowserWebServers,
} from "../playwright.release-servers";

const originalReleaseMode = process.env.RELEASE_BROWSER_LOCAL_SERVERS;

afterEach(() => {
  if (originalReleaseMode === undefined) {
    delete process.env.RELEASE_BROWSER_LOCAL_SERVERS;
  } else {
    process.env.RELEASE_BROWSER_LOCAL_SERVERS = originalReleaseMode;
  }
});

describe("release browser server isolation", () => {
  it("keeps the caller target and managed servers disabled outside release mode", () => {
    delete process.env.RELEASE_BROWSER_LOCAL_SERVERS;

    expect(releaseBrowserBaseUrl("https://preview.example.test")).toBe(
      "https://preview.example.test",
    );
    expect(releaseBrowserWebServers()).toBeUndefined();
  });

  it("forces the local target and starts an isolated API/web pair in release mode", () => {
    process.env.RELEASE_BROWSER_LOCAL_SERVERS = "1";

    expect(releaseBrowserBaseUrl("https://preview.example.test")).toBe(
      RELEASE_BROWSER_BASE_URL,
    );
    expect(releaseBrowserWebServers()).toEqual([
      expect.objectContaining({
        url: "http://127.0.0.1:18083/api/readyz",
        reuseExistingServer: false,
      }),
      expect.objectContaining({
        url: RELEASE_BROWSER_BASE_URL,
        reuseExistingServer: false,
      }),
    ]);
  });
});