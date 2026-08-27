# Manager action queue performance envelope

The manager action queue keeps the full action-item history available. Performance
is protected by narrowing the API response to the selected status and source
filters, while the status counts remain facility-wide so managers can see work
that exists outside the current view. Selecting **All** intentionally requests
the complete matching history; it does not delete or silently discard records.

## Tested envelope

The browser journey in
`artifacts/run-calculator/e2e/manager-action-queue-stale.spec.ts` seeds **750
resolved historical records** plus active queue records. It verifies that:

- the default open view transfers only open records while still reporting the
  full resolved count;
- selecting All returns and renders the historical records;
- status filters, stale optimistic writes, source links, and reload behavior
  continue to work at that history size.

This is a tested operating point, not a hard data limit. Loading All remains
proportional to the number of selected records because managers must be able to
review and act on every returned item. If a facility routinely needs to inspect
several thousand records at once, the next step should be an explicit
cursor-based history view rather than silently truncating the queue.