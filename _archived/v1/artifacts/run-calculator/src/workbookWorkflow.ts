/**
 * The complete workbook feature graph is intentionally loaded on demand.
 *
 * Keep this as the only runtime entry point for xlsx, run-workbook parsing,
 * import/export, and the related deterministic guide importers from Home. A
 * single cached promise means the first workbook action pays the load cost
 * once, while later actions retain the same module instances and behavior.
 */
export function createRetryableLoader<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    pending ??= load().catch((error) => {
      // A transient network/chunk failure must not poison the loader forever:
      // DeferredSurface's Retry action should make a fresh attempt.
      pending = null;
      throw error;
    });
    return pending;
  };
}

export const loadWorkbookWorkflow = createRetryableLoader(() =>
  Promise.all([
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
  ]): {
    XLSX: typeof import("xlsx");
    runExcel: typeof import("./utils/runExcel");
    specImport: typeof import("./specImport");
    specExport: typeof import("./specExport");
    premixImport: typeof import("./premixImport");
    shippingImport: typeof import("./shippingImport");
    recipeGuideImport: typeof import("./recipeGuideImport");
    cheeseImport: typeof import("./cheeseImport");
  } => ({
      XLSX,
      runExcel,
      specImport,
      specExport,
      premixImport,
      shippingImport,
      recipeGuideImport,
      cheeseImport,
    })),
);