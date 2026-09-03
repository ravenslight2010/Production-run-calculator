# Schema-Safe Application Rollback Rehearsal

## Goal

Prove that operators can redeploy an earlier API application image by immutable
tag after a newer release has applied schema changes, without reversing or
silently skipping the forward-only schema state.

The rehearsal must be repeatable in CI, must use only disposable local
infrastructure, and must retain enough evidence to map the same procedure to
Render and GHCR.

## Scope

The change will add a Docker-based rollback rehearsal, wire it into GitHub
Actions, and document the equivalent operator procedure using published
`runcalc-api:<sha>` and `runcalc-api-migrate:<sha>` images.

It will not connect to Render, GHCR, or a production database. It will not
attempt a down migration or prove that an arbitrarily old application remains
compatible with every future schema.

## Rehearsal Architecture

The rehearsal runs on a dedicated Docker network with a disposable PostgreSQL
container and no external `DATABASE_URL`.

It builds three local immutable tags:

1. A previous API runtime image from the parent Git revision.
2. A current API runtime image from the checked-out revision.
3. A current migration image from the checked-out revision.

The current migration image applies the schema once and exits successfully.
The current runtime then starts against that database and must serve both the
compiled web root `/` and `/api/healthz`. The runtime container is replaced by the
previous immutable runtime tag while the database and its forward schema remain
in place. Both deployed checks must pass again.

Using the parent revision models an actual code rollback rather than retagging
the same image. CI must fetch enough Git history for that build context.

## Safety and Failure Behavior

The script will:

- Reject or ignore externally supplied database connection settings and create
  its own disposable credentials and database.
- Use unique names for containers, images, network, volume, and evidence so
  concurrent or interrupted runs do not share state.
- Fail immediately when an image build, migration, container start, or health
  check fails.
- Apply bounded startup and health-check timeouts.
- Register cleanup before creating resources and remove all disposable
  containers, networks, volumes, and locally built rehearsal images on exit.
- Never run a migration from the previous image after the current schema has
  been applied. The rollback operation changes application code only.

## Evidence

Each successful run writes a Markdown report containing:

- UTC timestamp and current/previous Git revisions.
- Immutable local image tags and image IDs.
- The migration container exit result.
- Health responses for the current and rolled-back runtimes.
- Confirmation that the same database volume remained mounted across the
  runtime replacement.
- An explicit statement that the schema was not rolled back and remains at the
  forward-applied state.

CI will upload the report as an artifact. The job summary will point to it and
state whether the rehearsal passed.

## CI Integration

A dedicated CI job will run on pull requests and pushes after checkout with
sufficient history. It will invoke only the rollback rehearsal script, keeping
the proof isolated from the image-publishing job.

The rehearsal builds locally and does not require package-registry or Render
credentials. A failure blocks CI because it means the repository can no longer
prove the documented rollback invariant.

## Operator Runbook

The README will describe the production-equivalent sequence:

1. Identify the target application SHA and its matching migration image.
2. Run the matching migration image or Render pre-deploy migration against the
   intended database.
3. Deploy `runcalc-api:<sha>` by immutable tag.
4. Verify the compiled web root `/` and `/api/healthz`.
5. To roll application code back, redeploy the earlier
   `runcalc-api:<previous-sha>` tag without attempting to reverse the database.
6. Stop and roll forward with a compatibility fix if the earlier runtime cannot
   operate on the forward schema.

The runbook will explain that application rollback and schema rollback are
separate operations. The project supports forward-only schema application; an
application image redeploy must never be represented as undoing schema work.

## Verification

The implementation is complete when:

- The rehearsal passes locally with Docker.
- Both deployed checks pass before and after the immutable runtime replacement.
- The retained report contains the expected revisions, image identities,
  migration result, and forward-only statement.
- The CI workflow syntax and script checks pass.
- The documentation names matching runtime/migration tags and the stop
  condition for an incompatible previous runtime.

## Self-Review

- No placeholders or unresolved choices remain.
- Production credentials and databases are explicitly out of scope.
- “Previous image” means the parent Git revision, not an alias of the current
  image.
- Passing the rehearsal proves the tested adjacent-version rollback only; it
  does not claim universal backward compatibility.