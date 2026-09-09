# Recipe Pool Freshness Fence

## Context

The live source-library reconciliation was correct immediately after its
approved repair, but later full-pool writes changed 13 cheese recipes and 7
mixes. The existing recipe and mix write routes accept complete row snapshots
without comparing them with the server's current `updated_at`, so a long-lived
or resumed client can restore an older snapshot.

The repair must prevent stale writes before any new production data heal is
considered. It must not add a database column or mutate production directly.

## Approved approach

Use the existing per-row `updated_at` as the freshness revision:

1. Include `updatedAt` in cheese and mix API list items and in the shared
   client models used by bootstrap and direct list reads.
2. Accept an optional `updatedAt` on save input for compatibility with
   clients that create new IDs. An existing row must include a valid revision.
3. For each existing ID, update only when the incoming revision is at least as
   new as the stored revision. The comparison must occur in the database
   conflict update condition so concurrent requests cannot pass a read-then-
   write check.
4. If a batch contains stale or missing revisions for existing IDs, reject the
   whole request with HTTP 409 and return the authoritative current pool plus
   the rejected IDs. No row in that request may be changed.
5. The web client adopts the authoritative pool on 409 and does not retry the
   rejected body. Fresh writes continue to use the row stamps received from
   GET/bootstrap.
6. New IDs may omit `updatedAt`; accepted inserts receive a server timestamp.
   Delete behavior is unchanged and remains manager-gated.

An equal revision is the expected compare-and-swap precondition for a current
edit. If the normalized incoming row is equivalent to the stored row, the
server treats it as an idempotent no-op; otherwise it applies the edit and
issues a fresh server revision. This is the only useful interpretation of a
single row revision: an equal stamp means the client read the current row,
while an older stamp is stale.

## Alternatives considered

- **Pool-level ETag/If-Match:** would protect an entire list but requires
  additional revision state through bootstrap caches and every save caller.
- **Continue timestamp-only client behavior:** would leave unstamped legacy
  clients able to overwrite repaired rows and cannot satisfy the production
  reconciliation gate.

## Error and cache behavior

The conflict response is intentionally authoritative. Existing clients that
only throw on non-2xx remain safe because the server does not apply the stale
body; updated clients parse the response, replace their cache, and surface a
reload/retry-required state without automatically resubmitting. The response
contains only recipe rows and rejected IDs, not actor data or request payload
logging.

## Verification contract

Add API coverage for both resource types covering:

- new-row insert without a revision;
- fresh update acceptance;
- older revision rejection;
- equal revision with identical content as an idempotent retry;
- equal revision with changed content rejection;
- mixed fresh/stale batch atomic rejection;
- authoritative conflict response.

Add client coverage proving a 409 adopts the canonical pool and never retries
the stale request. Run generated-client freshness and typechecks after the
contract update, then the relevant API/client suites and the complete release
cycle on the final revision.

## Operational boundary

This change only prevents future stale writes. A separate manager-approved,
fingerprinted one-time data heal is required to repair already-drifted live
rows. Until that heal is deployed and verified through the read-only
production reconciliation procedure, the release remains NO-GO.