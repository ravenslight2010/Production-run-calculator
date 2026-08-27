# Manager action queue performance envelope

The manager action queue keeps the full action-item history available without
transferring it all at once. Active records (open, in progress, and deferred)
remain fully visible and actionable. Resolved history is loaded in 100-record
cursor pages; selecting **All** combines all active records with the currently
loaded resolved page. Status counts remain facility-wide so managers can see work
that exists outside the current view.

## Tested envelope

The browser journey in
`artifacts/run-calculator/e2e/manager-action-queue-stale.spec.ts` seeds **750
resolved historical records** plus active queue records. It verifies that:

- the default open view transfers only open records while still reporting the
  full resolved count;
- selecting All returns active records plus a bounded resolved-history page;
- Load older history advances through the complete resolved history with an
  opaque cursor;
- status filters, stale optimistic writes, source links, and reload behavior
  continue to work at that history size.

This is a tested operating point, not a hard data limit. Active queue size is
intentionally not truncated; resolved history remains bounded per request and
can be reviewed page by page even when a facility has several thousand records.