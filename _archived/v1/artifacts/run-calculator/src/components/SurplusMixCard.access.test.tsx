// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
  it("renders a loaded enabled mix with positive freezer stock", async () => {
    fetchMixes.mockResolvedValue([surplusMix]);

    render(<SurplusMixCard />);

    expect(await waitFor(() => screen.getByTestId("surplus-mix-card"))).to.exist;
    expect(screen.getByTestId("surplus-mix-mix-1").textContent).to.contain(
      "Garden mix",
    );
    expect(screen.getByTestId("surplus-mix-mix-1").textContent).to.contain(
      "4 lbs on hand",
    );
  });

  it("lists multiple mixes from largest freezer stock to smallest", async () => {
    fetchMixes.mockResolvedValue([
      { ...surplusMix, id: "mix-2", name: "Small mix", amountAlreadyMade: 3 },
      { ...surplusMix, id: "mix-3", name: "Large mix", amountAlreadyMade: 12 },
      { ...surplusMix, id: "mix-4", name: "Middle mix", amountAlreadyMade: 7 },
    ]);

    render(<SurplusMixCard />);

    const card = await waitFor(() => screen.getByTestId("surplus-mix-card"));
    const rows = within(card).getAllByTestId(/^surplus-mix-mix-/);

    expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual([
      "surplus-mix-mix-3",
      "surplus-mix-mix-4",
      "surplus-mix-mix-2",
    ]);
  });

  it("hides the card when loading mixes fails", async () => {
    fetchMixes.mockRejectedValue(new Error("mix request failed"));

    render(<SurplusMixCard />);

    await waitFor(() => expect(fetchMixes).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByTestId("surplus-mix-card")).to.equal(null),
    );
  });

  it("uses the approved high-contrast treatment for brand and flavor metadata", async () => {
    fetchMixes.mockResolvedValue([surplusMix]);

    render(<SurplusMixCard />);

    const metadata = await waitFor(() =>
      screen.getByText("Northstar — Pepperoni"),
    );

    expect(metadata.className.split(/\s+/)).toContain("text-sky-300");
    expect(metadata.className).not.toContain("/70");
  });

  it("hides the card when enabled mixes have no positive surplus", async () => {
    fetchMixes.mockResolvedValue([
      { ...surplusMix, amountAlreadyMade: 0 },
      { ...surplusMix, id: "mix-2", amountAlreadyMade: -1 },
    ]);

    render(<SurplusMixCard />);

    await waitFor(() => expect(fetchMixes).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByTestId("surplus-mix-card")).to.equal(null),
    );
  });

  it("hides disabled mixes even when they have positive surplus", async () => {
    fetchMixes.mockResolvedValue([
      { ...surplusMix, enabled: false, amountAlreadyMade: 8 },
    ]);

    render(<SurplusMixCard />);

    await waitFor(() => expect(fetchMixes).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByTestId("surplus-mix-card")).to.equal(null),
    );
  });
});