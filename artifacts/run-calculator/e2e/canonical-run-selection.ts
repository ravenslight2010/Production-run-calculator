import { expect, type Page } from "@playwright/test";
import { DAY_KEY } from "../src/types";

/** Select through the real UI after hydration; selection is device-local. */
export async function selectCanonicalFixtureRun(page: Page, runId?: string): Promise<void> {
  await page.getByTestId("tab-run").click();
  if (!runId) {
    const response = await page.request.get("/api/sync/today");
    expect(response.ok(), "canonical initial fixture selection must be readable").toBe(true);
    const { dayState } = await response.json();
    runId = dayState?.currentRunId
      ?? dayState?.runs?.[dayState.currentIndex ?? 0]?.id;
  }
  if (!runId) throw new Error("Canonical fixture has no initial run to select.");
  const readPosition = () => page.evaluate(({ key, id }) => {
    const day = JSON.parse(localStorage.getItem(key) ?? "{}");
    const runs = Array.isArray(day.runs) ? day.runs : [];
    return {
      index: runs.findIndex((run: { id?: string }) => run.id === id),
      count: runs.length,
    };
  }, { key: DAY_KEY, id: runId });
  await expect.poll(async () => (await readPosition()).index, {
    message: "the canonical fixture run must be adopted before selecting it",
  }).toBeGreaterThanOrEqual(0);
  if (await page.getByTestId("run-identity").getAttribute("data-run-id") !== runId) {
    const position = await readPosition();
    if (position.count > 1) {
      await page.getByRole("button", {
        name: `Select run ${position.index + 1}`, exact: true,
      }).click();
    }
  }
  await expect(page.getByTestId("run-identity")).toHaveAttribute("data-run-id", runId);
}
