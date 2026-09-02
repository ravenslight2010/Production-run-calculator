import { expect, type Locator, type Page, type Response } from "@playwright/test";

const ONBOARDING_RESPONSE_TIMEOUT = 15_000;
const SIGNUP_FORM_TIMEOUT = 20_000;
const APP_READY_TIMEOUT = 25_000;

export type CompleteOnboardingOptions = {
  button?: Locator;
  clickOptions?: Parameters<Locator["click"]>[0];
  actionLabel?: string;
};

export type DismissOnboardingOptions = Omit<CompleteOnboardingOptions, "button"> & {
  dialog?: (page: Page) => Locator;
  button?: Locator | ((dialog: Locator) => Locator);
  visibilityTimeout?: number;
  afterComplete?: (page: Page, dialog: Locator) => Promise<void>;
};

export type BrowserSignUpOptions = {
  signupCode?: string;
  waitForApp?: (page: Page) => Promise<void>;
  onboarding?: DismissOnboardingOptions | false;
  afterSignUp?: (page: Page) => Promise<void>;
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

/**
 * Complete the first-login onboarding dialog when it appears.
 *
 * The dialog is optional for returning users and fixtures that pre-mark
 * onboarding as seen. Once it is visible, completion always goes through
 * completeOnboarding so a failed POST cannot be hidden by a successful click.
 */
export async function dismissOnboardingIfPresent(
  page: Page,
  options: DismissOnboardingOptions = {},
): Promise<boolean> {
  const dialog =
    options.dialog?.(page) ??
    page.getByRole("dialog");
  const visible = await dialog
    .waitFor({
      state: "visible",
      timeout: options.visibilityTimeout ?? 8_000,
    })
    .then(() => true)
    .catch(() => false);
  if (!visible) return false;

  const completionButton =
    (typeof options.button === "function"
      ? options.button(dialog)
      : options.button) ??
    dialog.getByRole("button", {
      name: "Get started",
      exact: true,
    });
  await completeOnboarding(page, dialog, {
    button: completionButton,
    clickOptions: options.clickOptions,
    actionLabel: options.actionLabel,
  });
  await options.afterComplete?.(page, dialog);
  return true;
}

/**
 * Create a fresh browser account and make its authenticated shell usable.
 *
 * Suites may still supply app-ready waits and post-onboarding cleanup, but
 * account creation and the optional onboarding decision stay in one place.
 */
export async function signUpAndHandleOnboarding(
  page: Page,
  username: string,
  password: string,
  options: BrowserSignUpOptions = {},
): Promise<boolean> {
  await page.goto("/sign-up", { waitUntil: "domcontentloaded" });
  await page.locator("#username").waitFor({
    state: "visible",
    timeout: SIGNUP_FORM_TIMEOUT,
  });
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.locator("#confirm").fill(password);
  await page.locator("#accessCode").fill(
    options.signupCode ?? process.env.STAFF_SIGNUP_CODE ?? "",
  );

  const signupResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/auth/sign-up") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: /create.?account|sign.?up/i }).click();
  const response = await signupResponse;
  const body = (await response.text().catch(() => "<unavailable>")).trim();
  const bodyContext = body ? body.slice(0, 1_000) : "<empty>";
  expect(
    response.status(),
    `POST /api/auth/sign-up returned status ${response.status()} with body: ${bodyContext}`,
  ).toBeGreaterThanOrEqual(200);
  expect(
    response.status(),
    `POST /api/auth/sign-up returned status ${response.status()} with body: ${bodyContext}`,
  ).toBeLessThan(300);

  if (options.waitForApp) {
    await options.waitForApp(page);
  } else {
    await page.getByTestId("tab-run").waitFor({
      state: "attached",
      timeout: APP_READY_TIMEOUT,
    });
  }

  const onboardingDismissed =
    options.onboarding !== false
      ? await dismissOnboardingIfPresent(page, options.onboarding)
      : false;
  await options.afterSignUp?.(page);
  return onboardingDismissed;
}