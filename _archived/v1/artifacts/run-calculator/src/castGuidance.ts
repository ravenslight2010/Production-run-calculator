export type CastGuidancePlatform = "ipad" | "android" | "other";

export function detectCastGuidancePlatform(
  userAgent: string,
  maxTouchPoints: number,
): CastGuidancePlatform {
  if (/iPad/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1)) {
    return "ipad";
  }
  if (/Android/i.test(userAgent)) return "android";
  return "other";
}

export function getCastGuidance(
  platform: CastGuidancePlatform,
  presentationAvailable: boolean,
): string {
  if (platform === "ipad") {
    return "On iPad, swipe down from the upper-right to open Control Center, tap Screen Mirroring, then choose your TV for full-screen AirPlay mirroring. A web page cannot open that system picker. QR codes and URLs below can also open a station page in the TV's browser.";
  }
  if (presentationAvailable) {
    return "Tap Cast beside a screen to open this browser's device picker. If it is unavailable, use that screen's QR code or URL in the TV's browser.";
  }
  if (platform === "android") {
    return "This Android browser does not provide the in-page Cast picker here. Use a screen's QR code or URL in the TV's browser.";
  }
  return "This browser does not provide the in-page Cast picker. Use a screen's QR code or URL in the TV's browser, or start system screen mirroring from your device.";
}
