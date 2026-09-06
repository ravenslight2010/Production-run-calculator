/**
 * The complete workbook feature graph is intentionally loaded on demand.
 *
 * Keep this as the only runtime entry point for xlsx, run-workbook parsing,
 * import/export, and the related deterministic guide importers from Home. A
 * single cached promise means the first workbook action pays the load cost
 * once, while later actions retain the same module instances and behavior.
 */
export const loadWorkbookWorkflow = (() => {
  let pending: Promise<{
    XLSX: typeof import("xlsx");
    runExcel: typeof import("./utils/runExcel");
    specImport: typeof import("./specImport");
    specExport: typeof import("./specExport");
    premixImport: typeof import("./premixImport");
    shippingImport: typeof import("./shippingImport");
    recipeGuideImport: typeof import("./recipeGuideImport");
    cheeseImport: typeof import("./cheeseImport");
  }> | null = null;

  return () => {
    pending ??= Promise.all([
      import("xlsx"),
      import("./utils/runExcel"),
      import("./specImport"),
      import("./specExport"),
      import("./premixImport"),
      import("./shippingImport"),
      import("./recipeGuideImport"),
      import("./cheeseImport"),
    ]).then(([
      XLSX,
      runExcel,
      specImport,
      specExport,
      premixImport,
      shippingImport,
      recipeGuideImport,
      cheeseImport,
    ]) => ({
      XLSX,
      runExcel,
      specImport,
      specExport,
      premixImport,
      shippingImport,
      recipeGuideImport,
      cheeseImport,
    }));
    return pending;
  };
})();