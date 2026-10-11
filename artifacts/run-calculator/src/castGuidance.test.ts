import { describe, expect, it } from "vitest";
import { detectCastGuidancePlatform, getCastGuidance } from "./castGuidance";

describe("Cast to Screens platform guidance", () => {
  it("detects iPadOS devices that identify as desktop Macs", () => {
    expect(detectCastGuidancePlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X)", 5)).toBe("ipad");
    expect(detectCastGuidancePlatform("Mozilla/5.0 (iPad; CPU OS)", 1)).toBe("ipad");
  });

  it("keeps the browser picker guidance for Android when Presentation API exists", () => {
    expect(detectCastGuidancePlatform("Mozilla/5.0 (Linux; Android 14)", 5)).toBe("android");
    expect(getCastGuidance("android", true)).toMatch(/device picker/);
    expect(getCastGuidance("android", true)).toMatch(/QR code or URL/);
  });

  it("explains full-screen Control Center mirroring on iPad without claiming page control", () => {
    const guidance = getCastGuidance("ipad", false);
    expect(guidance).toMatch(/Control Center/);
    expect(guidance).toMatch(/Screen Mirroring/);
    expect(guidance).toMatch(/cannot open that system picker/);
    expect(guidance).toMatch(/QR codes and URLs/);
  });

  it("retains QR and URL fallbacks when the Presentation API is unavailable", () => {
    const guidance = getCastGuidance("android", false);
    expect(guidance).toMatch(/does not provide the in-page Cast picker/);
    expect(guidance).toMatch(/QR code or URL/);
  });
});
