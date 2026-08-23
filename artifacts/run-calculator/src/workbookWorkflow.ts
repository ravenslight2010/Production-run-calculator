/**
 * The complete workbook feature graph is intentionally loaded on demand.
 *
 * Keep this as the only runtime entry point for xlsx, run-workbook parsing,
 * spec import, and spec export from Home. A single cached promise means the
 * first workbook action pays the load cost once, while later import/export
 * actions retain the same module instances and behavior.
 */
export const loadWorkbookWorkflow = (() => {
  let pending: Promise<{
    XLSX: typeof import("xlsx");
    runExcel: typeof import("./utils/runExcel");
    specImport: typeof import("./specImport");
    specExport: typeof import("./specExport");
  }> | null = null;

  return () => {
    pending ??= Promise.all([
      import("xlsx"),
      import("./utils/runExcel"),
      import("./specImport"),
      import("./specExport"),
    ]).then(([XLSX, runExcel, specImport, specExport]) => ({
      XLSX,
      runExcel,
      specImport,
      specExport,
    }));
    return pending;
  };
})();