# Warehouse and Inventory Navigation Contract

## Decision

Keep two destinations inside the existing responsive web application:

- **Warehouse** is the operational station for preparing production.
- **Inventory** is the stock-record and inventory-maintenance destination.

Do not combine the destinations and do not add a seventh bottom tab. The existing six-tab structure
and capability rules remain unchanged.

## Why this option

The current destinations serve related but distinct jobs:

| Destination | Primary job | Typical actions | Access contract |
| --- | --- | --- | --- |
| Warehouse | Prepare materials for production | Pull from freezer, review due counts, review reorder/use-first guidance, stage ingredients and packaging by run | Visible to all signed-in floor users; existing action-level authorization remains in force |
| Inventory | Maintain and reconcile stock records | Review lots and stock alerts, restock or adjust quantities, manage temporary substitutions, respond to transfers and persistence errors | Destination may remain visible to signed-in users; existing `manage-inventory` checks continue to control restricted writes |

Combining these jobs under **Warehouse & Stock** would make the bottom station broader without
removing the permission boundary. It would also make a cast screen appear to include editing work
that it does not provide. Task-based names are clearer: **Warehouse** answers “what should I prepare?”
and **Inventory** answers “what stock do we have, and may I change its records?”

## Options considered

### 1. Separate destinations with consistent names — selected

Use **Warehouse** for operational preparation and **Inventory** for stock maintenance. This keeps
the current information architecture and permissions while removing the `Whse` / `Stock` /
`Warehouse` mismatch.

### 2. One combined destination

Use **Warehouse & Inventory** with subareas for preparation and records. This reduces the number of
names but makes a frequently used floor station carry a second job, complicates responsive
navigation, and risks implying that all warehouse users can edit inventory.

### 3. Task-only destination names

Use labels such as **Stage Materials** and **Manage Stock**. These are explicit, but they are less
stable because both surfaces contain more than the named action: Warehouse also includes pulls,
counts, and guidance; Inventory includes alerts, substitutions, and reconciliation. Task language
belongs in headings and supporting copy instead.

## User-facing terminology

| Surface | Required term | Supporting copy |
| --- | --- | --- |
| Bottom navigation tab | **Warehouse** | Accessible name: “Warehouse” |
| Warehouse interactive page | **Warehouse** | “Prepare materials and packaging for production.” |
| Warehouse attention section | **Warehouse attention** | “Pulls, counts, and stock guidance are shown first. Run-by-run staging details are below.” |
| Cast-screen chooser and cast display | **Warehouse** | “Production material needs” or equivalent operational description |
| Overflow-menu destination currently labeled Stock | **Inventory** | “Review stock and maintain inventory records.” |
| Inventory page heading | **Inventory** | “Review stock, lots, alerts, transfers, and substitutions.” |
| Settings and help copy | **Inventory** for stock records; **Warehouse** for production preparation | Never use **Whse** or **Stock** as a destination name |

“Stock” remains acceptable as a common noun in sentences and field labels such as “low stock” or
“stock on hand.” It is not a navigation destination. Internal route or tab identifiers such as
`warehouse` and `inventory` do not need to change.

## Destination and role contract

Warehouse and Inventory remain discoverable destinations. Visibility must not imply edit
authority:

- Warehouse continues to show operational guidance to signed-in floor staff.
- Inventory continues to show stock status according to the current capability model.
- Existing capability assignments, server authorization, supervisor authority, and data ownership
  do not change.
- A restricted Inventory action must explain the required role **before** the user attempts it.
  Disabled or read-only controls must have adjacent persistent text such as:
  **“Inventory Manager required to change stock records. You can still review current inventory.”**
- Do not rely only on a tooltip, toast, color, disabled cursor, or a failed request to communicate
  the restriction.
- If the destination is visible but the entire editing area is unavailable, place the explanation
  at the start of that area and keep permitted read-only information usable.

## Responsive acceptance criteria

- The bottom navigation remains exactly six tabs in the existing order.
- **Warehouse** is not visually truncated to **Whse** at supported phone widths. The implementation
  may use responsive typography or spacing, but must preserve a minimum practical touch target and
  must not reduce the accessible name.
- Inventory remains in the overflow menu and does not become a bottom tab.
- Desktop, tablet, and phone layouts use the same destination names and boundaries.
- Cast screens remain display-only operational Warehouse views; no inventory-maintenance controls
  move into cast mode.
- Deep links and existing tab transitions continue to open the same underlying panels.

## Accessibility acceptance criteria

- Visible labels and accessible names use **Warehouse** and **Inventory** consistently.
- Icon-only or space-constrained controls expose the full destination name to assistive technology.
- The active Warehouse tab remains programmatically selected through the existing tab semantics.
- Role explanations are persistent text associated with the restricted region or control; they are
  keyboard reachable when the region contains interactive controls.
- Disabled actions are not the only source of permission information.
- The copy does not encode the distinction by color or icon alone.
- At 200% text zoom and narrow phone widths, destination labels do not overlap or become
  indistinguishable.

## Bounded implementation plan

1. Replace the bottom-tab abbreviation **Whse** with **Warehouse**, preserving the existing
   `warehouse` tab value, icon, order, and six-column tab list.
2. Rename the overflow-menu item **Stock** to **Inventory**, preserving the existing `inventory`
   tab value and panel.
3. Add or normalize Warehouse and Inventory page headings and one-line job descriptions.
4. Normalize cast chooser, cast display, onboarding, guided-tour, help, notification, and settings
   copy according to the terminology table. Keep ordinary phrases such as “low stock.”
5. Add persistent pre-action role guidance to visible Inventory controls restricted by the current
   inventory-management capability. Do not alter capability checks.
6. Update focused navigation/copy tests and retained responsive/accessibility evidence for desktop,
   tablet, phone, keyboard use, and 200% text zoom.

## Explicitly unchanged

- Operational calculations, inventory records, APIs, persistence, and data ownership
- Capability assignments and manager/supervisor authority
- The six-tab responsive web structure
- Separate apps or native-mobile navigation
- Setup, Production, QC, and Management navigation
