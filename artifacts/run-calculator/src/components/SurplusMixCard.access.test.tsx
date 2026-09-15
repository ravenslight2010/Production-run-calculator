// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { Mix } from "@workspace/mixes";

const { fetchMixes } = vi.hoisted(() => ({
  fetchMixes: vi.fn(),
}));

vi.mock("../mixes", () => ({ fetchMixes }));

import SurplusMixCard from "./SurplusMixCard";

const surplusMix: Mix = {
  id: "mix-1",
  name: "Garden mix",
  brand: "Northstar",
  flavor: "Pepperoni",
  batchSize: 10,
  daysEarly: 0,
  amountAlreadyMade: 4,
  components: [],
  enabled: true,
};

afterEach(() => {
  cleanup();
  fetchMixes.mockReset();
});

describe("SurplusMixCard accessibility", () => {
  it("uses the approved high-contrast treatment for brand and flavor metadata", async () => {
    fetchMixes.mockResolvedValue([surplusMix]);

    render(<SurplusMixCard />);

    const metadata = await waitFor(() =>
      screen.getByText("Northstar — Pepperoni"),
    );

    expect(metadata.className.split(/\s+/)).toContain("text-sky-300");
    expect(metadata.className).not.toContain("/70");
  });
});