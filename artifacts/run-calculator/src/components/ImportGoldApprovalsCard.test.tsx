import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ImportGoldApproval } from "@workspace/api-client-react";

const { auth, list, create, verify, revoke } = vi.hoisted(() => ({
  auth: { me: { userId: "synthetic-manager", role: "manager", capabilities: ["manage-staff"], sandbox: false }, isLoading: false },
  list: vi.fn(), create: vi.fn(), verify: vi.fn(), revoke: vi.fn(),
}));
vi.mock("@/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@workspace/api-client-react", () => ({
  listImportGoldApprovals: list, createImportGoldApproval: create,
  verifyImportGoldApproval: verify, revokeImportGoldApproval: revoke,
}));
import ImportGoldApprovalsCard, { approvalStatus } from "./ImportGoldApprovalsCard";

const metadata = {
  recordRef: "synthetic-approval", sourceDigest: "a".repeat(64),
  importType: "spec", purpose: "local_spec_import_accuracy",
  ownerRef: "synthetic-owner", ownerApprovedAt: "2020-01-01T00:00:00.000Z",
  privacyStatus: "not_required", privacyReviewerRef: "synthetic-reviewer",
  privacyReviewedAt: "2020-01-01T00:00:00.000Z", conditionsRef: "synthetic-conditions",
  externalCopiesRef: "synthetic-copies", backupHandlingRef: "synthetic-backups",
  manualDeletionAccepted: true, retentionDays: 30, conditionsSatisfied: true,
  validUntil: "2099-01-01T00:00:00.000Z",
} as const;
const approval: ImportGoldApproval = {
  ...metadata, id: 1, scope: "live", createdBy: "synthetic-manager", createdAt: "2021-01-01T00:00:00.000Z",
  verifiedBy: null, verifiedAt: null, revokedBy: null, revokedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.me = { userId: "synthetic-manager", role: "manager", capabilities: ["manage-staff"], sandbox: false };
  auth.isLoading = false;
  list.mockResolvedValue({ approvals: [approval], nextBefore: null });
});
afterEach(cleanup);

async function openCreate() {
  fireEvent.click(await screen.findByTestId("button-toggle-gold-approval-form"));
  for (const name of ["recordRef", "ownerRef", "privacyReviewerRef", "conditionsRef", "externalCopiesRef", "backupHandlingRef", "sourceDigest"] as const) {
    fireEvent.change(screen.getByTestId(`input-gold-${name}`), { target: { value: metadata[name] } });
  }
  for (const name of ["ownerApprovedAt", "privacyReviewedAt", "validUntil"] as const) {
    fireEvent.change(screen.getByTestId(`input-gold-${name}`), { target: { value: name === "validUntil" ? "2099-01-01T00:00" : "2020-01-01T00:00" } });
  }
  fireEvent.change(screen.getByTestId("select-gold-privacyStatus"), { target: { value: "not_required" } });
  fireEvent.click(screen.getByTestId("checkbox-gold-manualDeletionAccepted"));
  fireEvent.click(screen.getByTestId("checkbox-gold-conditionsSatisfied"));
}

describe("Gold approval manager workflow", () => {
  it.each([
    ["manager", ["manage-staff"]], ["manager", ["manage-qc"]], ["qc-manager", ["manage-qc"]], ["qc-manager", ["manage-staff"]],
  ])("admits %s only with an allowed capability: %j", async (role, capabilities) => {
    auth.me = { ...auth.me, role, capabilities };
    render(<ImportGoldApprovalsCard />);
    expect(await screen.findByTestId("gold-approval-1")).toBeTruthy();
  });

  it.each([["operator", ["manage-qc"]], ["custom-manager", ["manage-staff"]], ["manager", []], ["qc-manager", []]])(
    "denies %s with %j without fetching metadata", (role, capabilities) => {
      auth.me = { ...auth.me, role, capabilities };
      render(<ImportGoldApprovalsCard />);
      expect(screen.getByTestId("gold-approvals-denied")).toBeTruthy();
      expect(list).not.toHaveBeenCalled();
    },
  );

  it("shows all states, including expiry precedence, and supports revoking expired records", async () => {
    list.mockResolvedValue({ approvals: [
      approval,
      { ...approval, id: 2, verifiedAt: "2022-01-01T00:00:00Z" },
      { ...approval, id: 3, validUntil: "2020-01-01T00:00:00Z", verifiedAt: "2022-01-01T00:00:00Z" },
      { ...approval, id: 4, revokedAt: "2022-01-01T00:00:00Z" },
    ], nextBefore: null });
    render(<ImportGoldApprovalsCard />);
    expect((await screen.findByTestId("gold-approval-status-1")).textContent).toBe("Pending verification");
    expect(screen.getByTestId("gold-approval-status-2").textContent).toBe("Verified");
    expect(screen.getByTestId("gold-approval-status-3").textContent).toBe("Expired");
    expect(screen.getByTestId("gold-approval-status-4").textContent).toBe("Revoked");
    fireEvent.click(screen.getByTestId("button-toggle-gold-approval-3"));
    expect(screen.queryByTestId("button-verify-gold-approval-3")).toBeNull();
    expect(screen.getByTestId("button-revoke-gold-approval-3")).toBeTruthy();
    expect(approvalStatus({ ...approval, revokedAt: "2020-01-01", validUntil: "2020-01-01" })).toBe("revoked");
  });

  it("creates only immutable metadata after field review, without submitting Home on Enter", async () => {
    create.mockResolvedValue({ approval: { ...approval, id: 2 } });
    const submit = vi.fn((e) => e.preventDefault());
    render(<form onSubmit={submit}><ImportGoldApprovalsCard /></form>);
    await openCreate();
    fireEvent.keyDown(screen.getByTestId("input-gold-recordRef"), { key: "Enter" });
    expect(submit).not.toHaveBeenCalled();
    expect(document.querySelectorAll("form")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("button-review-gold-approval"));
    expect(screen.getByTestId("gold-approval-review").textContent).toContain(metadata.sourceDigest);
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("button-submit-gold-approval"));
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create.mock.calls[0][0]).toMatchObject({
      ...metadata, ownerApprovedAt: expect.any(String), privacyReviewedAt: expect.any(String), validUntil: expect.any(String),
    });
    expect(Object.keys(create.mock.calls[0][0]).sort()).toEqual(Object.keys(metadata).sort());
    expect(await screen.findByTestId("gold-approval-2")).toBeTruthy();
    expect(screen.queryByTestId("gold-approval-form")).toBeNull();
    for (const button of document.querySelectorAll("button")) expect(button.type).toBe("button");
  });

  it("rejects private-looking references, incorrect digest, future completed dates and missing confirmations", async () => {
    render(<ImportGoldApprovalsCard />);
    await openCreate();
    expect(screen.getByTestId("input-gold-sourceDigest").hasAttribute("maxlength")).toBe(false);
    fireEvent.change(screen.getByTestId("input-gold-ownerRef"), { target: { value: "https://private.example/approval" } });
    fireEvent.change(screen.getByTestId("input-gold-sourceDigest"), { target: { value: "a".repeat(65) } });
    fireEvent.change(screen.getByTestId("input-gold-ownerApprovedAt"), { target: { value: "2099-01-01T00:00" } });
    fireEvent.click(screen.getByTestId("checkbox-gold-manualDeletionAccepted"));
    fireEvent.click(screen.getByTestId("button-review-gold-approval"));
    expect(screen.queryByTestId("button-submit-gold-approval")).toBeNull();
    expect(screen.getByTestId("input-gold-ownerRef").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByTestId("input-gold-sourceDigest").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByTestId("input-gold-ownerApprovedAt").getAttribute("aria-invalid")).toBe("true");
    expect(create).not.toHaveBeenCalled();
  });

  it("requires explicit verification and revocation and adopts only acknowledged outcomes", async () => {
    verify.mockResolvedValue({ approval: { ...approval, verifiedBy: "synthetic-qc", verifiedAt: "2022-01-01T00:00:00Z" } });
    revoke.mockRejectedValueOnce({ status: 503, message: "PRIVATE SERVER PAYLOAD" });
    render(<ImportGoldApprovalsCard />);
    fireEvent.click(await screen.findByTestId("button-toggle-gold-approval-1"));
    expect((screen.getByTestId("button-verify-gold-approval-1") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("checkbox-gold-attest-1"));
    fireEvent.click(screen.getByTestId("button-verify-gold-approval-1"));
    await waitFor(() => expect(verify).toHaveBeenCalledWith(1, { reviewed: true }));
    await waitFor(() => expect(screen.getByTestId("gold-approval-status-1").textContent).toBe("Verified"));
    fireEvent.click(screen.getByTestId("button-revoke-gold-approval-1"));
    expect(revoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("button-confirm-revoke-gold-approval-1"));
    expect(await screen.findByTestId("gold-approvals-action-error")).toBeTruthy();
    expect(screen.getByTestId("gold-approval-status-1").textContent).toBe("Verified");
    expect(screen.queryByText(/PRIVATE SERVER PAYLOAD/)).toBeNull();
    expect(screen.queryByTestId("gold-approvals-notice")).toBeNull();
    revoke.mockResolvedValueOnce({ approval: { ...approval, revokedAt: "2022-01-01T00:00:00Z", revokedBy: "synthetic-manager" } });
    fireEvent.click(screen.getByTestId("button-confirm-revoke-gold-approval-1"));
    await waitFor(() => expect(screen.getByTestId("gold-approval-status-1").textContent).toBe("Revoked"));
    expect(revoke).toHaveBeenLastCalledWith(1, { reviewed: true });
  });

  it("retries a denied read without presenting an empty success", async () => {
    list.mockRejectedValueOnce({ status: 403 });
    render(<ImportGoldApprovalsCard />);
    expect((await screen.findByTestId("gold-approvals-load-error")).textContent).toContain("Access denied");
    expect(screen.queryByTestId("gold-approvals-empty")).toBeNull();
    fireEvent.click(screen.getByTestId("button-retry-gold-approvals"));
    expect(await screen.findByTestId("gold-approval-1")).toBeTruthy();
  });

  it("does not adopt malformed successful responses or claim a saved mutation", async () => {
    list.mockResolvedValueOnce({ approvals: null, nextBefore: null });
    render(<ImportGoldApprovalsCard />);
    expect(await screen.findByTestId("gold-approvals-load-error")).toBeTruthy();
    fireEvent.click(screen.getByTestId("button-retry-gold-approvals"));
    expect(await screen.findByTestId("gold-approval-1")).toBeTruthy();
    create.mockResolvedValueOnce({ approval: { id: 2 } });
    await openCreate();
    fireEvent.click(screen.getByTestId("button-review-gold-approval"));
    fireEvent.click(screen.getByTestId("button-submit-gold-approval"));
    expect(await screen.findByTestId("gold-approvals-action-error")).toBeTruthy();
    expect(screen.queryByTestId("gold-approvals-notice")).toBeNull();
    expect(screen.getByTestId("gold-approval-form")).toBeTruthy();
    expect(screen.queryByTestId("gold-approval-2")).toBeNull();
  });

  it("loads older pages using the opaque server cursor", async () => {
    list.mockResolvedValueOnce({ approvals: [approval], nextBefore: 1 });
    list.mockResolvedValueOnce({ approvals: [{ ...approval, id: 2 }], nextBefore: null });
    render(<ImportGoldApprovalsCard />);
    fireEvent.click(await screen.findByTestId("button-load-more-gold-approvals"));
    expect(await screen.findByTestId("gold-approval-2")).toBeTruthy();
    expect(list).toHaveBeenLastCalledWith({ before: 1 });
    expect(screen.getByTestId("gold-approval-1")).toBeTruthy();
  });

  it("discards late reads and open forms across scope changes", async () => {
    let resolveOld!: (value: unknown) => void;
    list.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }));
    const ui = render(<ImportGoldApprovalsCard />);
    fireEvent.click(screen.getByTestId("button-toggle-gold-approval-form"));
    auth.me = { ...auth.me, sandbox: true };
    list.mockResolvedValueOnce({ approvals: [{ ...approval, id: 2, scope: "sandbox" }], nextBefore: null });
    ui.rerender(<ImportGoldApprovalsCard />);
    expect(await screen.findByTestId("gold-approval-2")).toBeTruthy();
    resolveOld({ approvals: [approval], nextBefore: null });
    await waitFor(() => expect(screen.queryByTestId("gold-approvals-loading")).toBeNull());
    expect(screen.queryByTestId("gold-approval-1")).toBeNull();
    expect(screen.queryByTestId("gold-approval-form")).toBeNull();
    expect(within(screen.getByTestId("gold-approvals-explainer")).getByText(/does not grant Gemini or export permission/)).toBeTruthy();
  });

  it("looks up by exact reference on the server and resets the cursor deliberately", async () => {
    list.mockResolvedValueOnce({ approvals: [approval], nextBefore: 1 });
    render(<ImportGoldApprovalsCard />);
    await screen.findByTestId("button-load-more-gold-approvals");
    fireEvent.change(screen.getByTestId("input-gold-lookup"), { target: { value: "https://x" } });
    fireEvent.click(screen.getByTestId("button-gold-lookup"));
    expect(list).toHaveBeenCalledTimes(1);
    list.mockResolvedValueOnce({ approvals: [{ ...approval, id: 9, recordRef: "other-ref" }], nextBefore: 4 });
    fireEvent.change(screen.getByTestId("input-gold-lookup"), { target: { value: "other-ref" } });
    fireEvent.click(screen.getByTestId("button-gold-lookup"));
    expect(await screen.findByTestId("gold-approval-9")).toBeTruthy();
    expect(list).toHaveBeenLastCalledWith({ recordRef: "other-ref" });
    expect(screen.queryByTestId("gold-approval-1")).toBeNull();
    list.mockResolvedValueOnce({ approvals: [], nextBefore: null });
    fireEvent.click(screen.getByTestId("button-load-more-gold-approvals"));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ recordRef: "other-ref", before: 4 }));
    list.mockResolvedValueOnce({ approvals: [], nextBefore: null });
    fireEvent.click(screen.getByTestId("button-gold-lookup-clear"));
    expect(await screen.findByTestId("gold-approvals-empty")).toBeTruthy();
    expect(list).toHaveBeenLastCalledWith({});
  });

  it("shows a missing lookup match factually", async () => {
    render(<ImportGoldApprovalsCard />);
    await screen.findByTestId("gold-approval-1");
    list.mockResolvedValueOnce({ approvals: [], nextBefore: null });
    fireEvent.change(screen.getByTestId("input-gold-lookup"), { target: { value: "missing-ref" } });
    fireEvent.click(screen.getByTestId("button-gold-lookup"));
    expect((await screen.findByTestId("gold-approvals-empty")).textContent).toContain("missing-ref");
  });

  it("distinguishes unavailable legacy reminder metadata from zero and shows scope-wide count", async () => {
    const ui = render(<ImportGoldApprovalsCard />);
    expect(await screen.findByTestId("gold-approvals-reminders-unavailable")).toBeTruthy();
    expect(screen.queryByTestId("gold-approvals-reminders")).toBeNull();
    ui.unmount();
    list.mockResolvedValue({ approvals: [approval], nextBefore: null, expiryReminders: { windowDays: 7, expiringCount: 0, asOf: "2024-01-01T00:00:00Z" } });
    const ui2 = render(<ImportGoldApprovalsCard />);
    expect((await screen.findByTestId("gold-approvals-reminders-count")).textContent).toBe("0");
    ui2.unmount();
    list.mockResolvedValue({ approvals: [], nextBefore: null, expiryReminders: { windowDays: 7, expiringCount: 3, asOf: "2024-01-01T00:00:00Z" } });
    render(<ImportGoldApprovalsCard />);
    const panel = await screen.findByTestId("gold-approvals-reminders");
    expect(panel.textContent).toContain("3");
    expect(panel.textContent).toMatch(/No reminder is sent/);
    expect(panel.textContent).toMatch(/cannot be extended/);
  });

  it("keeps an unsent draft when a lookup fails, without showing an empty success", async () => {
    render(<ImportGoldApprovalsCard />);
    await screen.findByTestId("gold-approval-1");
    await openCreate();
    list.mockRejectedValueOnce({ status: 503 });
    fireEvent.change(screen.getByTestId("input-gold-lookup"), { target: { value: "some-ref" } });
    fireEvent.click(screen.getByTestId("button-gold-lookup"));
    expect(await screen.findByTestId("gold-approvals-load-error")).toBeTruthy();
    expect((screen.getByTestId("input-gold-recordRef") as HTMLInputElement).value).toBe(metadata.recordRef);
    expect(create).not.toHaveBeenCalled();
  });
});
