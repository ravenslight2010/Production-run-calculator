import { expect, test } from "@playwright/test";

test("reports physical iOS Safari/PWA runtime evidence", async ({ page }, testInfo) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const evidence = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    viewport: {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      visualViewportWidth: window.visualViewport?.width ?? null,
      visualViewportHeight: window.visualViewport?.height ?? null,
    },
    devicePixelRatio: window.devicePixelRatio,
    standalone:
      "standalone" in navigator
        ? Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
        : false,
    displayModeStandalone: window.matchMedia("(display-mode: standalone)").matches,
  }));

  await testInfo.attach("ios-safari-pwa-device-evidence.json", {
    body: JSON.stringify(evidence, null, 2),
    contentType: "application/json",
  });

  expect(
    evidence.userAgent,
    "the configured device service must connect to iOS Safari or an iOS PWA",
  ).toMatch(/iPhone|iPad|iPod/i);
  expect(
    evidence.maxTouchPoints,
    "the configured device service must expose physical touch input",
  ).toBeGreaterThan(0);
});