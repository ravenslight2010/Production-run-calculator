import { expect, test } from "@playwright/test";

test.describe("shared calendar wrapper", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/e2e/calendar-fixture.html");
    await page.getByRole("button", { name: "Open calendar" }).click();
    await expect(
      page.getByRole("region", { name: "Calendar date picker" }),
    ).toBeVisible();
  });

  test("supports navigation, pointer and keyboard selection, disabled dates, and responsive layout", async ({
    page,
  }) => {
    const calendar = page.getByRole("region", {
      name: "Calendar date picker",
    });

    await expect(
      calendar.getByRole("grid", { name: "January 2025" }),
    ).toBeVisible();
    await expect(
      calendar.getByRole("button", { name: "Go to the Previous Month" }),
    ).toBeVisible();
    await expect(
      calendar.getByRole("button", { name: "Go to the Next Month" }),
    ).toBeVisible();

    await calendar
      .getByRole("button", { name: "Go to the Next Month" })
      .click();
    await expect(
      calendar.getByRole("grid", { name: "February 2025" }),
    ).toBeVisible();
    await calendar
      .getByRole("button", { name: "Go to the Previous Month" })
      .click();
    await expect(
      calendar.getByRole("grid", { name: "January 2025" }),
    ).toBeVisible();

    const outsideDay = calendar.getByRole("button", {
      name: /Sunday, December 29th, 2024/i,
    });
    await expect(outsideDay).toBeVisible();
    await outsideDay.click();
    const selectionStatus = page.locator("output");
    await expect(selectionStatus).toHaveText("Selected 12/29/2024");

    const keyboardStart = calendar.getByRole("button", {
      name: /Thursday, January 9th, 2025/i,
    });
    await keyboardStart.focus();
    await page.keyboard.press("ArrowRight");
    const keyboardTarget = calendar.getByRole("button", {
      name: /Friday, January 10th, 2025/i,
    });
    await expect(keyboardTarget).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(keyboardTarget).toHaveAttribute("data-selected-single", "true");
    await expect(selectionStatus).toHaveText("Selected 1/10/2025");

    const disabledDay = calendar.getByRole("button", {
      name: /Wednesday, January 15th, 2025/i,
    });
    await expect(disabledDay).toBeDisabled();
    await disabledDay.click({ force: true });
    await expect(selectionStatus).toHaveText("Selected 1/10/2025");

    const overflow = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth - window.innerWidth,
      body: document.body.scrollWidth - window.innerWidth,
    }));
    expect(overflow.document).toBeLessThanOrEqual(0);
    expect(overflow.body).toBeLessThanOrEqual(0);
  });
});