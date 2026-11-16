import { expect, test } from "@playwright/test";
import {
  AuthorizedBrowserFixtures,
  requireIsolatedTestDatabase,
  uniqueTestId,
} from "./isolation";
import { requireLocalFixtureApiOrigin } from "./isolatedApiOrigin";

const API_BASE = requireLocalFixtureApiOrigin("app update menu fixtures");
const PASSWORD = "AppUpdateMenu123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";

test("opens app updates from More and restores keyboard focus", async ({
  page,
  browser,
  playwright,
}, testInfo) => {
  test.setTimeout(120_000);
  requireIsolatedTestDatabase("app update menu browser verification");
  const fixtures = await AuthorizedBrowserFixtures.create(
    playwright,
    API_BASE,
    SIGNUP_CODE,
  );

  try {
    const account = await fixtures.createAccount({
      username: uniqueTestId(`app_update_${testInfo.project.name}`),
      password: PASSWORD,
      capabilities: [],
      onboardingSeen: true,
    });
    await page.context().addCookies([
      { name: "rc_auth", value: account.token, url: API_BASE },
    ]);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 60_000 });
    await expect(page.getByTestId("app-update-fallback")).toHaveCount(0);

    const moreButton = page.getByRole("button", { name: "More", exact: true });
    await expect(moreButton).toHaveAttribute("aria-label", "More");
    await moreButton.focus();
    await page.keyboard.press("Enter");
    const updateEntry = page.getByRole("menuitem", { name: /^App updates/ });
    await expect(updateEntry).toBeVisible();
    await expect(updateEntry).toContainText(
      /Not checked|Checking|Current|Update ready|Waiting for work to save|Update paused|Updating|Blocked by work|Offline|Update failed|Update complete/,
    );
    const updateEntryBounds = await updateEntry.boundingBox();
    expect(updateEntryBounds?.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", { name: "App updates" });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await dialog.evaluate(async (element) => {
      await Promise.all(
        element
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished.catch(() => undefined)),
      );
    });
    await expect(dialog.getByText("Running version")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Check for updates" })).toBeVisible();
    const bounds = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect(bounds).toBeTruthy();
    expect(viewport).toBeTruthy();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport!.width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport!.height);
    const checkButton = await dialog.getByRole("button", { name: "Check for updates" }).boundingBox();
    expect(checkButton?.height).toBeGreaterThanOrEqual(44);
    const closeButton = await dialog.getByRole("button", { name: "Close" }).boundingBox();
    expect(closeButton?.height).toBeGreaterThanOrEqual(44);
    expect(closeButton?.width).toBeGreaterThanOrEqual(44);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(moreButton).toBeFocused();

    const anonymousPage = await browser.newPage();
    try {
      await anonymousPage.goto("/sign-in", { waitUntil: "domcontentloaded" });
      const fallback = anonymousPage.getByTestId("app-update-fallback");
      await expect(fallback).toBeVisible();
      const fallbackBounds = await fallback.boundingBox();
      const fallbackViewport = anonymousPage.viewportSize();
      expect(fallbackBounds).toBeTruthy();
      expect(fallbackViewport).toBeTruthy();
      expect(fallbackBounds!.x).toBeGreaterThanOrEqual(0);
      expect(fallbackBounds!.y).toBeGreaterThanOrEqual(0);
      expect(fallbackBounds!.x + fallbackBounds!.width).toBeLessThanOrEqual(
        fallbackViewport!.width,
      );
      expect(fallbackBounds!.y + fallbackBounds!.height).toBeLessThanOrEqual(
        fallbackViewport!.height,
      );
      const fallbackButton = anonymousPage.getByRole("button", { name: /^App updates/ });
      await fallbackButton.click();
      await expect(anonymousPage.getByRole("dialog", { name: "App updates" })).toBeVisible();
      await anonymousPage.keyboard.press("Escape");
      await expect(anonymousPage.getByRole("dialog")).toHaveCount(0);
      await expect(fallbackButton).toBeFocused();
    } finally {
      await anonymousPage.close();
    }
  } finally {
    await fixtures.cleanup();
  }
});
