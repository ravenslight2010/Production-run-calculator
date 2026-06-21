import { describe, it, expect } from "vitest";
import { buildForecastPrompt, type ForecastInput } from "./aiForecast";

function input(overrides: Partial<ForecastInput> = {}): ForecastInput {
  return {
    nowMs: Date.now(),
    targetDate: "2026-06-23",
    history: [
      {
        date: "2026-06-16",
        runs: [{ brand: "Tony's", flavor: "Pepperoni", dieType: "12in", cases: 300, netRunMin: 120 }],
      },
      {
        date: "2026-06-09",
        runs: [{ brand: "Tony's", flavor: "Pepperoni", dieType: "12in", cases: 280, netRunMin: 110 }],
      },
    ],
    ...overrides,
  } as ForecastInput;
}

describe("buildForecastPrompt accuracy grounding", () => {
  it("embeds the accuracy grounding section when provided", () => {
    const grounding =
      "RECENT FORECAST ACCURACY (calibrate):\n- Consistently OVER-predicted — scale these DOWN: \"Tony's Pepperoni\" (over on 2 of 2 day(s)).";
    const { system, user } = buildForecastPrompt(input(), grounding);
    expect(user).toContain("RECENT FORECAST ACCURACY");
    expect(user).toContain('"Tony\'s Pepperoni" (over on 2 of 2 day(s))');
    // The accuracy block sits before the JSON return instruction.
    expect(user.indexOf("RECENT FORECAST ACCURACY")).toBeLessThan(user.indexOf("Return ONLY JSON"));
    // The system prompt instructs the model to lean on the accuracy feedback.
    expect(system).toContain("RECENT FORECAST ACCURACY");
  });

  it("omits the accuracy section when no grounding is given", () => {
    const { user } = buildForecastPrompt(input());
    expect(user).not.toContain("RECENT FORECAST ACCURACY");
  });

  it("omits the accuracy section for an empty grounding string", () => {
    const { user } = buildForecastPrompt(input(), "   ");
    expect(user).not.toContain("RECENT FORECAST ACCURACY");
  });
});
