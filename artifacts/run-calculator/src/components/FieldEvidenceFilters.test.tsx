import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FieldEvidenceFilters } from "./FieldEvidenceFilters";

afterEach(cleanup);

describe("field evidence controls inside Home's form", () => {
  it("applies exact build/browser and clears without submitting the outer form", () => {
    const onApply = vi.fn();
    const onSubmit = vi.fn((event) => event.preventDefault());
    const { container } = render(
      <form onSubmit={onSubmit}>
        <FieldEvidenceFilters filters={{}} onApply={onApply} />
      </form>,
    );
    expect(container.querySelectorAll("form").length).toBe(1);
    fireEvent.change(screen.getByLabelText("Build", { exact: true }), { target: { value: "exact" } });
    const apply = screen.getByRole("button", { name: "Apply field filters" });
    expect((apply as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Exact build identifier"), { target: { value: " release-a " } });
    fireEvent.change(screen.getByLabelText("Browser category"), { target: { value: "mobile-safari" } });
    fireEvent.click(apply);
    expect(onApply).toHaveBeenLastCalledWith({ appBuild: "release-a", deviceCategory: "mobile-safari" });
    expect(apply.getAttribute("type")).toBe("button");
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByLabelText("Exact build identifier"), { key: "Enter" });
    expect(onApply).toHaveBeenCalledTimes(2);
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Clear field filters" }));
    expect(onApply).toHaveBeenLastCalledWith({});
    expect((screen.getByLabelText("Build", { exact: true }) as HTMLSelectElement).value).toBe("all");
    expect((screen.getByLabelText("Browser category") as HTMLSelectElement).value).toBe("");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("sends local only when unknown is selected and leaves all filters omitted by default", () => {
    const onApply = vi.fn();
    render(<FieldEvidenceFilters filters={{ appBuild: "local" }} onApply={onApply} />);
    expect(screen.getByTestId("field-evidence-population").textContent).toContain("Unknown build (local)");
    fireEvent.change(screen.getByLabelText("Build", { exact: true }), { target: { value: "unknown" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply field filters" }));
    expect(onApply).toHaveBeenLastCalledWith({ appBuild: "local" });
    fireEvent.change(screen.getByLabelText("Build", { exact: true }), { target: { value: "all" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply field filters" }));
    expect(onApply).toHaveBeenLastCalledWith({});
  });
});
