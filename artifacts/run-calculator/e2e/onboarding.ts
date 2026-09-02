import { expect, type Locator, type Page, type Response } from "@playwright/test";

const ONBOARDING_RESPONSE_TIMEOUT = 15_000;

export async function completeOnboarding(page: Page, welcome: Locator): Promise<void> {
  // Register the waiter before clicking so a fast response cannot be missed.
  const seenPromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/me/onboarding-seen") &&
      response.request().method() === "POST",
    { timeout: ONBOARDING_RESPONSE_TIMEOUT },
  );

  let response: Response;
  try {
    [response] = await Promise.all([
      seenPromise,
      welcome.getByRole("button", { name: "Get started", exact: true }).click(),
    ]);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Timed out waiting up to ${ONBOARDING_RESPONSE_TIMEOUT}ms for POST /api/me/onboarding-seen after clicking Get started: ${reason}`,
    );
  }

  const body = (await response.text().catch(() => "<unavailable>")).trim();
  const bodyContext = body ? body.slice(0, 1_000) : "<empty>";
  expect(
    response.status(),
    `POST /api/me/onboarding-seen returned status ${response.status()} with body: ${bodyContext}`,
  ).toBe(200);
  await expect(welcome).toBeHidden({ timeout: 10_000 });
}