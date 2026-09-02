import { expect, type Locator, type Page, type Response } from "@playwright/test";

const ONBOARDING_RESPONSE_TIMEOUT = 15_000;

type CompleteOnboardingOptions = {
  button?: Locator;
  clickOptions?: Parameters<Locator["click"]>[0];
  actionLabel?: string;
};

export async function completeOnboarding(
  page: Page,
  welcome: Locator,
  options: CompleteOnboardingOptions = {},
): Promise<void> {
  const completionButton = options.button ?? welcome.getByRole("button", {
    name: "Get started",
    exact: true,
  });
  const actionLabel = options.actionLabel ?? "Get started";

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
      completionButton.click(options.clickOptions),
    ]);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Timed out waiting up to ${ONBOARDING_RESPONSE_TIMEOUT}ms for POST /api/me/onboarding-seen after clicking ${actionLabel}: ${reason}`,
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