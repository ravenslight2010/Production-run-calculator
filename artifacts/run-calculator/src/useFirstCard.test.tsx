// @vitest-environment jsdom
//
// UI coverage for the "Use First" (FEFO) warehouse card. The card self-fetches
// inventory + storage locations + the expiry settings, then lists the stock lots
// expiring within the configured window (plus already-expired ones), ordered
// first-expired-first-out. These tests assert the card renders the required
// per-entry fields — crucially the EXPLICIT expiration date (not just the
// relative "Xd left" text) — and that it hides entirely when nothing is at risk.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

import { AuthProvider } from "./AuthContext";
import UseFirstCard from "./components/UseFirstCard";
import type { InventoryItem, InventoryLocation } from "./inventoryShared";

// Build an ISO date string `offset` whole days from today (local calendar).
function dayOffset(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// "Mon D" label the card renders for a YYYY-MM-DD lot date.
function expiryLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map((n) => parseInt(n, 10));
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

type ServerState = {
  me: {
    userId: string;
    role: "manager" | "operator";
    email: null;
    name: null;
    onboardingSeen: boolean;
    tourCompleted: boolean;
  };
  inventory: InventoryItem[];
  locations: InventoryLocation[];
  settings: { expirySoonDays: number };
};

let server: ServerState;

function lot(over: {
  id: number;
  itemId: number;
  qtyRemaining: number;
  expirationDate: string | null;
  locationId?: number | null;
}) {
  return {
    id: over.id,
    itemId: over.itemId,
    locationId: over.locationId ?? null,
    lotNumber: `L${over.id}`,
    qtyReceived: over.qtyRemaining,
    qtyRemaining: over.qtyRemaining,
    receivedDate: null,
    expirationDate: over.expirationDate,
    createdAt: "2026-06-21T00:00:00.000Z",
  };
}

function item(over: {
  id: number;
  name: string;
  lots: ReturnType<typeof lot>[];
}): InventoryItem {
  return {
    id: over.id,
    key: `ingredient:${over.name.toLowerCase().replace(/\s+/g, "-")}:lbs`,
    category: "ingredient",
    name: over.name,
    unit: "lbs",
    reorderThreshold: 0,
    createdAt: "2026-06-21T00:00:00.000Z",
    updatedAt: "2026-06-21T00:00:00.000Z",
    onHand: over.lots.reduce((s, l) => s + l.qtyRemaining, 0),
    lots: over.lots,
    byLocation: [],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const url = typeof input === "string" ? input : input.toString();
  if (url.startsWith("/api/me")) return jsonResponse(server.me);
  if (url.startsWith("/api/inventory/settings")) return jsonResponse(server.settings);
  if (url.startsWith("/api/inventory/locations")) return jsonResponse(server.locations);
  if (url.startsWith("/api/inventory/ledger")) return jsonResponse([]);
  if (url.startsWith("/api/inventory")) return jsonResponse(server.inventory);
  throw new Error(`Unexpected fetch in test: ${url}`);
});

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  readyState = 1;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  close(): void {
    this.readyState = 2;
  }
}

function newQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = React.useMemo(newQueryClient, []);
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  server = {
    me: {
      userId: "u1",
      role: "operator",
      email: null,
      name: null,
      onboardingSeen: true,
      tourCompleted: true,
    },
    inventory: [],
    locations: [
      { id: 1, name: "Onsite (Line)", isOnsite: true, createdAt: "2026-06-21T00:00:00.000Z" },
      { id: 2, name: "Cold Storage", isOnsite: false, createdAt: "2026-06-21T00:00:00.000Z" },
    ],
    settings: { expirySoonDays: 7 },
  };
  FakeEventSource.instances = [];
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("UseFirstCard — expiry FEFO warehouse card", () => {
  it("renders the explicit expiration date for an at-risk lot, plus name/qty/location", async () => {
    const exp = dayOffset(3);
    server.inventory = [
      item({ id: 1, name: "Whole Milk Mozzarella", lots: [lot({ id: 10, itemId: 1, qtyRemaining: 12, expirationDate: exp, locationId: 2 })] }),
    ];

    render(
      <Wrapper>
        <UseFirstCard />
      </Wrapper>,
    );

    const row = await screen.findByTestId("use-first-ingredient:whole-milk-mozzarella:lbs");
    // Required fields all present on the entry.
    expect(row.textContent).toContain("Whole Milk Mozzarella");
    expect(row.textContent).toContain("12");
    expect(row.textContent).toContain("Cold Storage");
    // The explicit calendar date — the code-review blocking requirement.
    expect(row.textContent).toContain(expiryLabel(exp));
    // The relative days-until text accompanies it.
    expect(row.textContent).toContain("3d left");
  });

  it("shows an expired lot's date and 'expired Nd ago'", async () => {
    const exp = dayOffset(-2);
    server.inventory = [
      item({ id: 2, name: "Pepperoni", lots: [lot({ id: 20, itemId: 2, qtyRemaining: 5, expirationDate: exp })] }),
    ];

    render(
      <Wrapper>
        <UseFirstCard />
      </Wrapper>,
    );

    const row = await screen.findByTestId("use-first-ingredient:pepperoni:lbs");
    expect(row.textContent).toContain(expiryLabel(exp));
    expect(row.textContent).toContain("expired 2d ago");
  });

  it("hides the whole card when nothing is at risk", async () => {
    server.inventory = [
      item({ id: 3, name: "Fresh Flour", lots: [lot({ id: 30, itemId: 3, qtyRemaining: 50, expirationDate: dayOffset(60) })] }),
    ];

    render(
      <Wrapper>
        <UseFirstCard />
      </Wrapper>,
    );

    // Give the async fetch a chance to resolve, then assert the card stays absent.
    await screen.findByText("Fresh Flour").catch(() => null);
    expect(screen.queryByTestId("use-first-card")).toBeNull();
  });
});
