import path from "node:path";
import {
  isSourceInput,
  SELF_HOST_FRESH_SOURCE_POLICY,
} from "../src/build-source-files.mjs";
const slash = (value) => value.split(path.sep).join("/");
const legacyModule = (relative) =>
  relative.startsWith("artifacts/api-server/src/lib/repairs/") ||
  /^artifacts\/api-server\/src\/lib\/(?:dataHeals|buildInfo|sourceLibraryReconciliation(?:Heal|Capture|Plan\.generated)|crbIngredientHeal|repairDefinitionFingerprint(?:Manifest)?)\.ts$/.test(
    relative,
  ) ||
  relative ===
    "artifacts/api-server/src/routes/sourceLibraryReconciliationCapture.ts" ||
  /scripts\/src\/source-library-(?:reconciliation-capture-core|approval-bundle)\.[cm]?[jt]s$/.test(
    relative,
  );
export function assertFreshRuntimeGraph(root, metafile) {
  if (!metafile || typeof metafile.inputs !== "object")
    throw new Error("Fresh runtime graph is missing.");
  for (const input of Object.keys(metafile.inputs)) {
    const relative = slash(path.relative(root, path.resolve(root, input)));
    if (legacyModule(relative))
      throw new Error(
        "Historical repair/capture module is forbidden in a fresh runtime.",
      );
    if (relative.includes("node_modules/")) continue;
    // Pino's virtual entrypoints contain dependency-owned worker code only.
    if (
      /^(?:pino-worker|pino-pipeline-worker|pino-file|pino-pretty)$/.test(input)
    )
      continue;
    if (
      relative.startsWith("../") ||
      !isSourceInput(relative, SELF_HOST_FRESH_SOURCE_POLICY)
    )
      throw new Error(
        "Unsealed authored input is forbidden in a fresh runtime: " +
          relative.replace(/[^A-Za-z0-9_./:-]/g, "_").slice(0, 200),
      );
  }
}
export function freshRuntimePlugin(root) {
  const source = "artifacts/api-server/src/";
  const replacements = new Map(
    [
      ["lib/dataHeals.ts", "selfHostFresh/dataHeals.ts"],
      ["lib/buildInfo.ts", "selfHostFresh/buildInfo.ts"],
      [
        "lib/sourceLibraryReconciliationHeal.ts",
        "selfHostFresh/sourceReconciliation.ts",
      ],
      [
        "routes/sourceLibraryReconciliationCapture.ts",
        "selfHostFresh/captureRoutes.ts",
      ],
    ].map(([from, to]) => [
      path.resolve(root, source + from),
      path.resolve(root, source + to),
    ]),
  );
  return {
    name: "fresh-self-host-authority-boundary",
    setup(build) {
      build.onResolve(
        {
          filter:
            /(?:dataHeals|buildInfo|sourceLibraryReconciliationHeal|sourceLibraryReconciliationCapture)(?:\.[cm]?[jt]s)?$/,
        },
        (args) => {
          const resolved = path.resolve(args.resolveDir, args.path);
          for (const candidate of [
            resolved,
            resolved + ".ts",
            resolved.replace(/\.[cm]?[jt]s$/, ".ts"),
          ]) {
            const replacement = replacements.get(candidate);
            if (replacement) return { path: replacement };
          }
          return null;
        },
      );
      build.onLoad({ filter: /.*/ }, (args) => {
        if (legacyModule(slash(path.relative(root, args.path))))
          return {
            errors: [
              {
                text: "Historical repair/capture modules cannot be loaded in a fresh runtime.",
              },
            ],
          };
        return null;
      });
    },
  };
}
export const FRESH_RUNTIME_BUILD_CONTRACT = Object.freeze({
  schemaVersion: 1,
  buildProfile: "self-host-fresh",
  legacyRepairAuthority: "unavailable",
  historicalAudit: "not-packaged",
});
