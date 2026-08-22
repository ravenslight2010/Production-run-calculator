# Release Check Design

## Goal

Make the pre-publish verification easy to run without hiding the existing
individual checks or silently running destructive browser tests.

## Interface

- `pnpm run release:check` runs the safe standard release gates.
- `pnpm run release:check:full` runs the standard gates plus the full browser
  suite.

Both commands execute checks sequentially, stop at the first failure, preserve
the child command's output, and print a concise summary. The full browser suite
is opt-in because its approved test setup resets disposable today-row data.

## Standard gates

The standard command runs generated-client freshness, repository and package
typechecks, recovery evidence, isolated clean-start, all configured unit and
integration suites, model-bump validation, operational-skill evidence, compact
browser smoke, and accessibility checks.

The clean-start step supplies isolated ports so it can run while the normal
preview workflows are active.

## Error handling

Each command is started through Node's child-process API with inherited output.
The runner records pass/fail status by step, stops after the first nonzero exit
or signal, and exits nonzero when any step fails. It does not modify databases,
terminate unrelated services, or swallow command output.

## Verification

The runner supports a help mode for validating its CLI wiring. Existing
commands remain available independently, and the runner itself is covered by
the scripts package typecheck.