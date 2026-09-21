// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { exportAuditLogsPdf, toast } = vi.hoisted(() => ({
  exportAuditLogsPdf: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({ exportAuditLogsPdf }));
vi.mock("@/hooks/use-toast", () => ({ toast }));

import AuditLogCard from "./AuditLogCard";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  exportAuditLogsPdf.mockReset();
  toast.mockReset();
});

function auditResponse() {
  return new Response(JSON.stringify({
    logs: [{
      id: 1,
      actor: "manager",
      action: "role_changed",
      resource: "staff",
      changes: { outcome: "success" },
      createdAt: "2026-09-21T12:00:00.000Z",
    }],
    count: 1,
  }), {
    headers: { "Content-Type": "application/json" },
  });
}

function renderAuditLogCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuditLogCard />
    </QueryClientProvider>,
  );
}

describe("AuditLogCard PDF export", () => {
  it("uses newly applied date and row filters for the list and PDF", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(auditResponse())
      .mockResolvedValueOnce(auditResponse());
    vi.stubGlobal("fetch", fetchMock);
    const pdf = new Blob(["%PDF-1.4"], { type: "application/pdf" });
    exportAuditLogsPdf.mockResolvedValueOnce(pdf);

    renderAuditLogCard();
    await screen.findByText("role_changed");
    const dateInputs = document.querySelectorAll<HTMLInputElement>('input[type="date"]');
    const limitInput = document.querySelector<HTMLInputElement>('input[type="number"]');
    expect(dateInputs).toHaveLength(2);
    expect(limitInput).toBeTruthy();
    fireEvent.change(dateInputs[0] as HTMLInputElement, { target: { value: "2026-01-01" } });
    fireEvent.change(dateInputs[1] as HTMLInputElement, { target: { value: "2026-01-02" } });
    fireEvent.change(limitInput as HTMLInputElement, { target: { value: "7" } });
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const listUrl = new URL(fetchMock.mock.calls[1]?.[0] as string, "http://localhost");
    expect(listUrl.searchParams.get("startDate")).toBe("2026-01-01");
    expect(listUrl.searchParams.get("endDate")).toBe("2026-01-02T23:59:59");
    expect(listUrl.searchParams.get("limit")).toBe("7");

    await userEvent.click(screen.getByRole("button", { name: "PDF" }));
    await waitFor(() => expect(exportAuditLogsPdf).toHaveBeenCalledWith({
      startDate: "2026-01-01T00:00:00.000Z",
      endDate: "2026-01-02T23:59:59.999Z",
      limit: 7,
    }));
  });

  it("downloads a PDF using the committed date range and row limit", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => auditResponse()));
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob: audit");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const pdf = new Blob(["%PDF-1.4"], { type: "application/pdf" });
    exportAuditLogsPdf.mockResolvedValueOnce(pdf);

    renderAuditLogCard();
    await screen.findByText("role_changed");
    await userEvent.click(screen.getByRole("button", { name: "PDF" }));

    await waitFor(() => expect(exportAuditLogsPdf).toHaveBeenCalledWith({
      startDate: "2026-08-22T00:00:00.000Z",
      endDate: "2026-09-21T23:59:59.999Z",
      limit: 100,
    }));
    expect(createObjectURL).toHaveBeenCalledWith(pdf);
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob: audit");
    expect(toast).not.toHaveBeenCalled();
  });

  it("shows a safe authorization error without clearing the audit view", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => auditResponse()));
    exportAuditLogsPdf.mockRejectedValueOnce({ status: 403, data: { error: "private audit payload" } });

    renderAuditLogCard();
    await screen.findByText("role_changed");
    await userEvent.click(screen.getByRole("button", { name: "PDF" }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith({
      title: "Audit PDF download failed",
      description: "PDF export requires manager access in the live facility.",
      variant: "destructive",
    }));
    expect(screen.getByText("role_changed")).toBeTruthy();
    expect(screen.queryByText("private audit payload")).toBeNull();
    expect((screen.getByRole("button", { name: "PDF" }) as HTMLButtonElement).disabled).toBe(false);
  });
});