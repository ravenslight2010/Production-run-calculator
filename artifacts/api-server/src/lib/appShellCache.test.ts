import { describe, expect, it, vi } from "vitest";
import { setAppShellCacheHeaders } from "./appShellCache";

describe("mutable application shell headers", () => {
  it.each(["index.html", "service-worker.js", "app-build.json", "manifest.webmanifest"])(
    "does not cache %s", (name) => {
      const response = { setHeader: vi.fn() };
      setAppShellCacheHeaders(response, `/public/${name}`);
      expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    },
  );
  it("leaves content-addressed assets and unrelated data alone", () => {
    const response = { setHeader: vi.fn() };
    setAppShellCacheHeaders(response, "/public/assets/home-ab12cd.js");
    setAppShellCacheHeaders(response, "/public/logo.svg");
    expect(response.setHeader).not.toHaveBeenCalled();
  });
});
