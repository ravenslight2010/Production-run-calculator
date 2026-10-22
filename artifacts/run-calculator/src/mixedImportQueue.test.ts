import { describe, expect, it } from "vitest";
import { canStartMixedImport, cancelQueuedMixedImports, isSupportedReviewWorkbook, isSupportedReviewFile, type MixedImportItem } from "./mixedImportQueue";
describe("mixed workbook boundaries", () => {
  it.each(["xlsx", "XLS", "xlsm", "xlsb", "csv", "ods"])("supports %s without interpreting contents", (extension) => {
    expect(isSupportedReviewWorkbook(`Procédure 配方.${extension}`)).toBe(true);
  });
  it.each(["workbook.xlsx.exe", "photo.jpg", "sheet.pdf", "archive.zip", "no-extension"])("rejects %s", (name) => {
    expect(isSupportedReviewWorkbook(name)).toBe(false);
  });
  it.each(["docx", "DOC", "txt"])("routes %s documents only to the existing sauce guide importer", (extension) => {
    expect(isSupportedReviewFile(`Sauce.${extension}`, "sauce")).toBe(true);
    expect(isSupportedReviewFile(`Sauce.${extension}`, "spec")).toBe(false);
    expect(isSupportedReviewFile("Sauce.xlsx", "sauce")).toBe(false);
  });
  it("only cancels queued files and never replays settled or uncertain operations", () => {
    const statuses = ["queued", "applied", "partial", "uncertain", "reviewing", "failed"] as const;
    const items: MixedImportItem[] = statuses.map((status) => ({ id: status, file: new File([], "synthetic.xlsx"), type: "spec", status }));
    expect(cancelQueuedMixedImports(items).map((item) => item.status)).toEqual(["cancelled", ...statuses.slice(1)]);
    for (const item of items) expect(canStartMixedImport(item, true)).toBe(false);
    expect(items.filter((item) => canStartMixedImport(item, false)).map((item) => item.status)).toEqual(["queued", "failed"]);
    expect(items[0].status).toBe("queued");
  });
});
