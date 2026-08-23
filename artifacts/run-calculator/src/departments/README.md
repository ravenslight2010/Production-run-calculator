# Calculator department boundaries

The calculator remains one application. `Home` owns authentication, navigation,
day-state persistence and sync, master data, form/autosave behavior, and the
`LiveRunProvider`. Department components are composition boundaries over those
shared services; they are not independent stores or application entry points.

## Ownership map

- **Production line** — run, dough, sauce, frontline, packaging, and stoppages.
  These surfaces consume `LiveRunContext` for timers and calculations.
- **Warehouse and inventory** — warehouse needs/staging, inventory, and mix
  planning. These surfaces consume the shared run values, substitutions, and
  inventory APIs.
- **QC** — incident review, downtime trends, and quality history. These remain
  permission-gated query surfaces and observe the same run history.
- **Management** — setup, AI assistance, staff, and operations summary. These
  retain their existing manager/capability gates and mutation handlers.

`DepartmentAppContext` is the narrow cross-department contract for navigation,
current run identity, day-state visibility, form values, and targeted refresh
requests. Adding a new department dependency should extend this contract rather
than passing the complete `HomeCtx` value through a component boundary.
