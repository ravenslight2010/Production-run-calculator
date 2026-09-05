#!/usr/bin/env bash

# Regression test for the scripts package test command. Read the manifest
# directly so this guard does not invoke, or depend on, the command it protects.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PACKAGE_JSON="${SCRIPT_DIR}/../package.json"
EXPECTED_VALIDATOR='python3 -S ../.agents/skills/skill-creator/scripts/test_quick_validate.py'
EXPECTED_SKILL_CATALOG_CHECK='pnpm run check:skill-catalog'

if [[ ! -f "$PACKAGE_JSON" ]]; then
  printf 'Could not find scripts package manifest: %s\n' "$PACKAGE_JSON" >&2
  exit 1
fi

TEST_COMMAND=$(
  node - "$PACKAGE_JSON" <<'NODE'
const fs = require("node:fs");

const packagePath = process.argv[2];
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const command = packageJson.scripts?.test;

if (typeof command !== "string" || command.trim() === "") {
  process.stderr.write(
    'scripts/package.json must define a non-empty "test" script.\n',
  );
  process.exit(1);
}

process.stdout.write(command);
NODE
)

if [[ "$TEST_COMMAND" != *"$EXPECTED_VALIDATOR"* ]]; then
  cat >&2 <<EOF
scripts/package.json#test must retain the quick validator suite:
  ${EXPECTED_VALIDATOR}

The standard scripts test command must launch this suite directly with
python3 -S so the manifest guard remains independent of the command it checks.
EOF
  exit 1
fi

if [[ "$TEST_COMMAND" != *"$EXPECTED_SKILL_CATALOG_CHECK"* ]]; then
  cat >&2 <<EOF
scripts/package.json#test must run the live skill catalog check:
  ${EXPECTED_SKILL_CATALOG_CHECK}

The standard scripts test command must validate repository skill roots, not
only isolated contract fixtures.
EOF
  exit 1
fi

printf 'PASS: scripts test command retains live skill catalog and quick validator checks.\n'