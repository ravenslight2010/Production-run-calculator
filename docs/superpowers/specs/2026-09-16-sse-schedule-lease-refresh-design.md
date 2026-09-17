# SSE Schedule Lease Refresh Design

## Problem

The sync SSE heartbeat currently sends one schedule data frame and then
comment-only keepalives while the schedule's structural key is unchanged.
Browser `EventSource` does not expose comment frames to the application's
message handler, so the web client's 30-second server-schedule lease expires
even though the connection is healthy.

## Design

On every existing auto-track heartbeat interval:

- Read the current canonical day row and reset epoch as today.
- If a reset or rollover occurred, send that control frame and return.
- If a live auto-track schedule exists, send a normal SSE data frame containing
  the freshly computed live state, canonical revision, and `heartbeat: true`.
- If no live schedule exists, send the existing comment-only keepalive.
- If the read fails, retain the existing fail-safe comment-only keepalive so the
  client lease expires and local fallback can resume.

The schedule remains a transport-only projection. It is not persisted in the
sync document and does not affect snapshot identity or LWW stamps.

## Alternatives Rejected

- A new named SSE lease event would require a wider client/server contract
  change for no additional safety.
- Extending the client lease would mask missing schedule delivery and delay
  fallback after a real server or transport failure.

## Validation

- Update the heartbeat integration test to require recurring schedule data
  frames while the schedule is live.
- Keep coverage that identifies the scheduled run.
- Run the focused API sync integration test and the relevant auto-track client
  tests from the sync and state-accuracy checklists.
- Re-run typecheck and the protected GitHub checks on the final commit.