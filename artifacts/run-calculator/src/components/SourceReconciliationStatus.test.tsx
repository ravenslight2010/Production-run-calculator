import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SourceReconciliationStatus } from "./SourceReconciliationStatus";
describe("fresh source audit status", () => {
  it("labels historical production audit as not applicable, not verified or missing", () => {
    render(
      <SourceReconciliationStatus
        status={{
          status: "not-applicable",
          buildProfile: "self-host-fresh",
          reason: "legacy-production-audit-not-packaged",
          findings: [],
        }}
      />,
    );
    const panel = screen.getByRole("status");
    expect(panel.textContent).toContain(
      "Historical production audit: Not applicable",
    );
    expect(panel.textContent).toContain(
      "No historical repair has been claimed or verified",
    );
    expect(panel.textContent).toContain(
      "current data-health checks below still apply",
    );
    expect(panel.textContent).not.toContain("approved proposals");
    expect(panel.textContent).not.toContain("heal marker is missing");
    expect(panel.textContent).not.toContain("captured");
  });
});
