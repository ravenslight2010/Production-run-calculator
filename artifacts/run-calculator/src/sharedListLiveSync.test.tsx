// @vitest-environment jsdom
//
// Live-sync regression coverage: a shared, factory-wide list edited by ANOTHER
// user must show up on this client without a manual reload. The server already
// guarantees these GETs are never cached stale (no-store headers, see
// .agents/memory/no-store-cache-headers.md), but each CLIENT still relies on its
// own refetch mechanism (an SSE nudge, a React Query invalidation, or an
// on-demand fetch). A future client-side caching change — a React Query
// `staleTime`, an AsyncStorage snapshot, an in-module memo — could silently
// re-introduce a stale view even while the server headers stay correct. These
// tests exercise the real client refetch paths and assert the new data renders.
//
// Covered here: the inventory list (raw fetch + inventory SSE nudge), the
// production-rules shared list (React Query with a 30s staleTime), and a
// learned-memory pool (learned import aliases, on-demand raw fetch).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  renderHook,
  act,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

import { AuthProvider } from "./AuthContext";
import InventoryTab from "./components/InventoryTab";
import { useProductionRules } from "./hooks/useProductionRules";
import { fetchImportAliases, type ImportAlias } from "./importAliases";
import type { InventoryItem } from "./inventoryShared";

// ── Fake server the client fetches against ───────────────────────────────────
// A single mutable object stands in for the factory-wide server state. "Another
// user edits" === we mutate this object, then drive the client's own refetch.
type ServerState = {
  me: { userId: string; role: "manager" | "operator"; email: null; name: null; onboardingSeen: boolean; tourCompleted: boolean };
  inventory: InventoryItem[];
  settings: { expirySoonDays: number };
  productionRules: unknown[];
  importAliases: ImportAlias[];
};

let server: ServerState;

function item(id: number, name: string, onHand: number): InventoryItem {
  return {
    id,
    key: `ingredient:${name.toLowerCase().replace(/\s+/g, "-")}:lbs`,
    category: "ingredient",
    name,
    unit: "lbs",
    reorderThreshold: 0,
    createdAt: "2026-06-21T00:00:00.000Z",
    updatedAt: "2026-06-21T00:00:00.000Z",
    onHand,
    lots: [],
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

// Routes by path against the current `server` snapshot, so each fetch always
// reflects the latest server state — exactly what a no-store GET guarantees.
const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const url = typeof input === "string" ? input : input.toString();
  if (url.startsWith("/api/me")) return jsonResponse(server.me);
  if (url.startsWith("/api/inventory/settings")) return jsonResponse(server.settings);
  if (url.startsWith("/api/inventory/ledger")) return jsonResponse([]);
  if (url.startsWith("/api/inventory")) return jsonResponse(server.inventory);
  if (url.startsWith("/api/production-rules")) return jsonResponse({ rules: server.productionRules });
  if (url.startsWith("/api/import-aliases")) return jsonResponse({ aliases: server.importAliases });
  throw new Error(`Unexpected fetch in test: ${url}`);
});

// jsdom has no EventSource. Capture instances so a test can fire the inventory
// nudge the server broadcasts after another user's edit.
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
  // Simulate a server SSE frame arriving on this connection.
  emit(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

function newQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

// InventoryTab pulls in cards (ChangePasswordCard) that read AuthContext, so the
// inventory render must be wrapped in the real AuthProvider too.
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
    me: { userId: "u1", role: "operator", email: null, name: null, onboardingSeen: true, tourCompleted: true },
    inventory: [item(1, "Whole Milk Mozzarella", 40)],
    settings: { expirySoonDays: 7 },
    productionRules: [],
    importAliases: [],
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

describe("inventory list — another user's edit appears via the SSE nudge", () => {
  it("re-renders the new item after an external edit, with no manual reload", async () => {
    render(
      <Wrapper>
        <InventoryTab candidates={[]} />
      </Wrapper>,
    );

    // Initial server state is rendered.
    expect(await screen.findByText("Whole Milk Mozzarella")).toBeTruthy();
    expect(screen.queryByText("Pepperoni")).toBeNull();

    // Another user adds an item. The server now returns it; the only signal this
    // client gets is the inventory SSE nudge (NOT the new data itself).
    server.inventory = [
      item(1, "Whole Milk Mozzarella", 40),
      item(2, "Pepperoni", 25),
    ];

    const es = FakeEventSource.instances.find((e) => e.url.includes("/inventory/events"));
    expect(es, "InventoryTab should open an inventory SSE connection").toBeTruthy();

    // The nudge carries a foreign senderId (a different client), so this client
    // must refetch. (Its own edits echo back with its own id and are ignored.)
    await act(async () => {
      es!.emit({ senderId: "another-user" });
    });

    // The new item shows up with no manual reload.
    expect(await screen.findByText("Pepperoni")).toBeTruthy();
  });

  it("ignores its own echoed nudge (no refetch loop)", async () => {
    render(
      <Wrapper>
        <InventoryTab candidates={[]} />
      </Wrapper>,
    );
    await screen.findByText("Whole Milk Mozzarella");

    const invFetchCountBefore = fetchMock.mock.calls.filter(
      (c) => String(c[0]).startsWith("/api/inventory") && !String(c[0]).includes("/events"),
    ).length;

    const es = FakeEventSource.instances.find((e) => e.url.includes("/inventory/events"))!;
    // inventoryClientId() is embedded in the SSE url as ?clientId=<id>.
    const ownId = new URL(es.url, "http://x").searchParams.get("clientId");
    await act(async () => {
      es.emit({ senderId: ownId });
    });

    const invFetchCountAfter = fetchMock.mock.calls.filter(
      (c) => String(c[0]).startsWith("/api/inventory") && !String(c[0]).includes("/events"),
    ).length;
    expect(invFetchCountAfter).toBe(invFetchCountBefore);
  });
});

describe("production rules — React Query shared list survives a staleTime", () => {
  it("shows a rule another user added after an invalidation, despite the 30s staleTime", async () => {
    const qc = newQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useProductionRules(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.rules).toHaveLength(0);

    // Another manager adds a rule on a different device.
    server.productionRules = [
      {
        id: "r1",
        name: "Brand is required",
        type: "required-field",
        field: "brand",
        enforcement: "flexible",
        enabled: true,
      },
    ];

    // The hook caches for 30s, so a plain re-read would keep showing the empty
    // list. The app forces freshness by invalidating on edit / background poll —
    // that path MUST yield the new rule (a higher staleTime must never trap a
    // stale view).
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ["productionRules"] });
    });

    await waitFor(() => expect(result.current.rules).toHaveLength(1));
    expect(result.current.rules[0]?.name).toBe("Brand is required");
  });
});

describe("learned-memory pool — import aliases read through on every fetch", () => {
  it("returns an alias another user just saved (no client-side snapshot)", async () => {
    // First read: empty pool.
    expect(await fetchImportAliases()).toHaveLength(0);

    // Another user confirms a match; the factory-wide pool grows server-side.
    server.importAliases = [
      { type: "brand", externalName: "Galbani", canonicalName: "Whole Milk Mozzarella" },
    ];

    // The next on-demand fetch (e.g. the next import flow) must hit the network
    // again and return the new alias — it must not be served from an in-module
    // or React Query snapshot.
    const aliases = await fetchImportAliases();
    expect(aliases).toHaveLength(1);
    expect(aliases[0]?.canonicalName).toBe("Whole Milk Mozzarella");

    const aliasFetches = fetchMock.mock.calls.filter((c) =>
      String(c[0]).startsWith("/api/import-aliases"),
    );
    expect(aliasFetches.length).toBe(2);
  });
});
