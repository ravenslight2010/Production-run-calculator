import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ImportTemplateDownloads from "./ImportTemplateDownloads";

const download = vi.hoisted(() => vi.fn());
vi.mock("../importTemplates", () => ({ downloadImportTemplate: download }));
afterEach(cleanup);
beforeEach(() => { download.mockReset(); });

describe("optional import template downloads", () => {
  it("shows seven optional downloads before file selection and never submits a form", async () => {
    const submit = vi.fn();
    render(<form onSubmit={submit}><ImportTemplateDownloads enabled={new Set(["spec", "premix", "cheese", "shipping", "sauce", "dough", "schedule"])} /></form>);
    fireEvent.click(screen.getByText("Optional blank import templates"));
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(7);
    expect(screen.getByText(/using a template is not required/)).toBeTruthy();
    for (const button of buttons) {
      fireEvent.click(button);
      await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
    }
    expect(download.mock.calls.map(([format]) => format)).toEqual(["spec", "premix", "cheese", "shipping", "sauce", "dough", "schedule"]);
    expect(submit).not.toHaveBeenCalled();
  });
  it("shows only enabled importer formats and nothing for an empty capability set", () => {
    const { rerender } = render(<ImportTemplateDownloads enabled={new Set(["schedule"])} />);
    fireEvent.click(screen.getByText("Optional blank import templates"));
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button").textContent).toContain("Production schedule");
    rerender(<ImportTemplateDownloads enabled={new Set()} />);
    expect(screen.queryByText("Optional blank import templates")).toBeNull();
  });
  it("reports failures, permits retry and leaves existing-workbook import available", async () => {
    download.mockImplementationOnce(() => { throw new Error("download blocked"); });
    render(<ImportTemplateDownloads enabled={new Set(["spec"])} />);
    fireEvent.click(screen.getByText("Optional blank import templates"));
    fireEvent.click(screen.getByRole("button"));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain("continue with your existing workbook");
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
