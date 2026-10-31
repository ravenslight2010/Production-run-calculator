import { expect, test } from "@playwright/test";

// Dedicated development-fixture suite, intentionally not a *.spec.ts file:
// production-mode full-browser lanes cannot serve source HTML fixtures.
for (const kind of ["spec", "premix", "cheese"]) {
  test(`${kind} records ready review timing and warns only over 2,000 ms`, async ({ page }) => {
    const warnings: string[] = [];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "warning") warnings.push(message.text());
    });
    await page.goto("/e2e/fixtures/import-review-timing.html");
    await page.evaluate(() => {
      const events: Array<{ name: string; durationMs: number }> = [];
      Object.assign(window, { reviewTimingEvents: events });
      window.addEventListener("calculator-performance", (event) => {
        events.push((event as CustomEvent).detail);
      });
    });
    const entries = () => page.evaluate((eventName) => {
      const events = (window as unknown as {
        reviewTimingEvents: Array<{ name: string; durationMs: number }>;
      }).reviewTimingEvents;
      return events.filter((entry) => entry.name === eventName);
    }, `import-${kind}-review-open`);
    await page.getByRole("button", { name: `Open ${kind}`, exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect.poll(async () => (await entries()).length).toBe(1);
    const normal = (await entries())[0];
    expect(normal.durationMs).toBeGreaterThan(0);
    expect(normal.durationMs).toBeLessThanOrEqual(2_000);
    expect(warnings.filter((warning) => warning.includes(`import-${kind}-review-open`))).toHaveLength(0);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: `Delay ${kind}`, exact: true }).click();
    await expect.poll(async () => (await entries()).length).toBe(2);
    await expect(page.getByRole("dialog")).toBeVisible();
    expect((await entries())[1].durationMs).toBeGreaterThan(2_000);
    expect(warnings.filter((warning) => warning.includes(`import-${kind}-review-open`))).toHaveLength(1);
    expect(errors).toEqual([]);
  });
}
