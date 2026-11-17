// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  fetchQualityChecks: vi.fn(),
}));

vi.mock("../useRole", () => ({
  useMe: () => ({ hasCapability: () => true }),
}));

vi.mock("../inventoryShared", async (importOriginal) => {
  const original = await importOriginal<typeof import("../inventoryShared")>();
  return { ...original, fetchQualityChecks: mocks.fetchQualityChecks };
});

import QualityHistoryTab from "./QualityHistoryTab";

afterEach(() => {
  cleanup();
  mocks.fetchQualityChecks.mockReset();
});

describe("Quality History generated-text retention label", () => {
  it("marks retained historical summaries and issues as unverified generated text", async () => {
    mocks.fetchQualityChecks.mockResolvedValue([{
      id: 1,
      productType: "pizza",
      status: "warn",
      confidence: 0.72,
      summary: "Possible edge browning.",
      issues: [{ type: "color", severity: "minor", detail: "Dark edge" }],
      notes: "Manager-confirmed context",
      thumbnail: null,
      reviewerName: "Manager",
      createdAt: "2026-08-01T12:00:00.000Z",
    }]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <QualityHistoryTab />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Unverified generated assessment")).toBeTruthy();
    fireEvent.click(screen.getByText("Possible edge browning.").closest("button")!);
    expect(screen.getByText(/Unverified generated text — retain for audit only/i)).toBeTruthy();
    expect(screen.getByText(/Manager-confirmed context/)).toBeTruthy();
  });
});