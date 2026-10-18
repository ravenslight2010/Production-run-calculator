import { describe, expect, it } from "vitest";
import { batchProcess } from "@workspace/integrations-openai-ai-server/batch";

describe("AI integration batch concurrency", () => {
  it("keeps provider work within the configured concurrency limit", async () => {
    let active = 0;
    let peakActive = 0;

    const results = await batchProcess(
      [0, 1, 2, 3, 4],
      async (item) => {
        active += 1;
        peakActive = Math.max(peakActive, active);
        await new Promise((resolve) => setTimeout(resolve, 0));
        active -= 1;
        return item * 2;
      },
      { concurrency: 2, retries: 0 },
    );

    expect(peakActive).toBe(2);
    expect(results).toEqual([0, 2, 4, 6, 8]);
  });
});