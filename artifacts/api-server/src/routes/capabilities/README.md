# API capability families

`routes/index.ts` is the only top-level API composition point. It preserves the
global lifecycle boundary in this order:

1. no-store response policy
2. public health probes
3. startup readiness gate
4. public authentication routes
5. signed-in-user requirement
6. authenticated capability families

Authorization remains owned by each route module. A family groups related
transport modules; it does not replace `requireCapability` or create a separate
service/database boundary.

| Family | Route modules | Shared policy |
| --- | --- | --- |
| Core sync/runs | `runs`, `sync`, `completedHistory` | Global authentication; route-owned run/sync capabilities and transaction fences |
| Master data/imports | `duplicateReviews`, `importAliases`, `fillMissingValues`, `ingredientBatchWeights`, `photoAliases`, `specImportAliases`, saved source sheets/guides, `importHistory`, `masterDataBootstrap`, merge records, `productionRules`, recipe/ingredient/profile pools, schedules/templates, die settings, `factoryData` | Global authentication; route-owned manager/profile/import permissions |
| Inventory/operations | `inventory`, `incidents`, `fieldChecks`, `actionItems`, freezer pull/surplus, `runSuggestions`, `operationalReports` | Global authentication; route-owned inventory and operational capabilities |
| Administration | `roles`, `webPush`, `masterDataHealth`, `profileDataHealth`, `supervisorPin`, `sandbox`, `auditLogs` | Global authentication; route-owned staff/admin capabilities |
| Retained AI | `ai`, `aiCorrections`, `aiMemory`, `aiMemoryHealth` | Global authentication; shared AI cost/retry/cache policy plus route-owned capabilities |

Health and authentication are public lifecycle routes and intentionally do not
belong to an authenticated family. Public endpoint paths and generated API
contracts are not namespaced by these internal boundaries.