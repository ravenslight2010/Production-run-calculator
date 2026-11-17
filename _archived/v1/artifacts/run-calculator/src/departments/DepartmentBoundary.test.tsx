import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Tabs } from "@/components/ui/tabs";
import {
  DepartmentProvider,
  ManagementDepartment,
  ProductionLineDepartment,
  QcDepartment,
  WarehouseInventoryDepartment,
  type DepartmentAppContext,
} from "./index";

const context = {
  activeTab: "run",
  navigate: vi.fn(),
  currentRunId: "run-1",
  dayState: { runs: [], currentIndex: 0 },
  formValues: {},
  identity: { isManager: false },
  permissions: { canManageProfiles: false, canManageInventory: false, canManageStaff: false },
  live: { runStatus: "pending", isOnline: true },
  masterData: { brands: [], doughRecipeNames: [], frontlineRecipeNames: [], mixRecipeNames: [] },
  notifications: { pendingResetCount: 0, unreviewedIncidentCount: 0 },
  requestRefresh: vi.fn(),
} as unknown as DepartmentAppContext;

describe("department composition boundaries", () => {
  it("keeps all department surfaces inside one shared provider", () => {
    render(
      <DepartmentProvider value={context}>
        <ProductionLineDepartment>line</ProductionLineDepartment>
        <WarehouseInventoryDepartment>warehouse</WarehouseInventoryDepartment>
        <QcDepartment>qc</QcDepartment>
        <ManagementDepartment>management</ManagementDepartment>
      </DepartmentProvider>,
    );

    expect(screen.getByText("line").closest("[data-department]")?.getAttribute("data-department")).toBe("production-line");
    expect(screen.getByText("warehouse").closest("[data-department]")?.getAttribute("data-department")).toBe("warehouse-inventory");
    expect(screen.getByText("qc").closest("[data-department]")?.getAttribute("data-department")).toBe("qc");
    expect(screen.getByText("management").closest("[data-department]")?.getAttribute("data-department")).toBe("management");
  });

  it("marks only the owning department as active", () => {
    document.body.innerHTML = "";
    render(
      <DepartmentProvider value={{ ...context, activeTab: "quality" }}>
        <ProductionLineDepartment>line</ProductionLineDepartment>
        <QcDepartment>qc</QcDepartment>
      </DepartmentProvider>,
    );

    expect(screen.getByText("line").closest("[data-department]")?.getAttribute("data-department-active")).toBe("false");
    expect(screen.getByText("qc").closest("[data-department]")?.getAttribute("data-department-active")).toBe("true");
  });
  it("composes named department slots inside the shared provider", () => {
    document.body.innerHTML = "";
    render(
      <DepartmentProvider value={{ ...context, activeTab: "summary" }}>
        <Tabs defaultValue="summary">
          <ProductionLineDepartment
            run={<span>run surface</span>}
            summary={<span>summary surface</span>}
          />
          <WarehouseInventoryDepartment inventory={<span>inventory surface</span>} />
          <ManagementDepartment ai={<span>ai surface</span>} />
        </Tabs>
      </DepartmentProvider>,
    );

    expect(screen.getByText("summary surface").closest("[data-department]")?.getAttribute("data-department")).toBe("production-line");
    expect(screen.getByText("summary surface").closest("[data-department]")?.getAttribute("data-department-active")).toBe("true");
    expect(screen.getByLabelText("warehouse-inventory department")).not.toBeNull();
    expect(screen.getByLabelText("management department")).not.toBeNull();
  });
});
