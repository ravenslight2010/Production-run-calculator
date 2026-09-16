#!/usr/bin/env bash

# Offline regression fixture for downloaded TypeScript 7 comparison history.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
COLLECTOR="${SCRIPT_DIR}/fetch-typescript-7-history.sh"
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT

WORKSPACE="${TEST_ROOT}/workspace"
FIXTURES="${TEST_ROOT}/fixtures"
BIN="${TEST_ROOT}/bin"
GITHUB_ENV_FILE="${TEST_ROOT}/github-env"
mkdir -p "$WORKSPACE" "$FIXTURES" "$BIN"

make_report() {
  local path="$1"
  local schema_version="$2"
  local revision="$3"
  local image="$4"
  local hardware_class="$5"

  jq -n \
    --argjson schema_version "$schema_version" \
    --arg revision "$revision" \
    --arg image "$image" \
    --arg hardware_class "$hardware_class" \
    '{
      schemaVersion: $schema_version,
      sourceRevision: $revision,
      runner: {
        image: $image,
        hardwareClass: $hardware_class
      },
      performanceComparison: [range(14) | {index: .}]
    }' >"$path"
}

make_zip() {
  local zip_path="$1"
  local report_path="$2"
  local archive_path="${3:-typescript-7-comparison.json}"

  python3 - "$zip_path" "$report_path" "$archive_path" <<'PY'
import pathlib
import sys
import zipfile

zip_path, report_path, archive_path = sys.argv[1:]
with zipfile.ZipFile(zip_path, "w") as archive:
    archive.write(pathlib.Path(report_path), archive_path)
PY
}

make_conflicting_zip() {
  local zip_path="$1"
  local first_report_path="$2"
  local second_report_path="$3"

  python3 - "$zip_path" "$first_report_path" "$second_report_path" <<'PY'
import pathlib
import sys
import zipfile

zip_path, first_report_path, second_report_path = sys.argv[1:]
with zipfile.ZipFile(zip_path, "w") as archive:
    archive.write(
        pathlib.Path(first_report_path),
        "first/typescript-7-comparison.json",
    )
    archive.write(
        pathlib.Path(second_report_path),
        "second/typescript-7-comparison.json",
    )
PY
}

valid_hash=$(printf 'a%.0s' {1..64})
other_valid_hash=$(printf 'b%.0s' {1..64})
make_report "$FIXTURES/valid-one.json" 3 "revision-one" "ubuntu-24.04" "$valid_hash"
make_report "$FIXTURES/old-schema.json" 2 "old-schema" "ubuntu-24.04" "$valid_hash"
make_report "$FIXTURES/malformed-fingerprint.json" 3 "bad-fingerprint" "ubuntu-24.04" "not-a-sha256"
make_report "$FIXTURES/empty-runner-image.json" 3 "empty-image" "" "$valid_hash"
make_report "$FIXTURES/duplicate.json" 3 "revision-one" "ubuntu-24.04" "$valid_hash"
make_report "$FIXTURES/unsafe.json" 3 "unsafe-path" "ubuntu-24.04" "$valid_hash"
make_report "$FIXTURES/conflicting-one.json" 3 "conflicting-one" "ubuntu-24.04" "$valid_hash"
make_report "$FIXTURES/conflicting-two.json" 3 "conflicting-two" "ubuntu-24.04" "$valid_hash"
make_report "$FIXTURES/valid-two.json" 3 "revision-two" "ubuntu-22.04" "$other_valid_hash"

make_zip "$FIXTURES/101.zip" "$FIXTURES/valid-one.json"
make_zip "$FIXTURES/102.zip" "$FIXTURES/old-schema.json"
make_zip "$FIXTURES/103.zip" "$FIXTURES/malformed-fingerprint.json"
make_zip "$FIXTURES/104.zip" "$FIXTURES/empty-runner-image.json"
make_zip "$FIXTURES/105.zip" "$FIXTURES/duplicate.json"
make_zip "$FIXTURES/106.zip" "$FIXTURES/unsafe.json" "../typescript-7-comparison.json"
printf 'PK\003\004truncated-zip' >"$FIXTURES/107.zip"
make_conflicting_zip "$FIXTURES/108.zip" "$FIXTURES/conflicting-one.json" "$FIXTURES/conflicting-two.json"
make_zip "$FIXTURES/109.zip" "$FIXTURES/valid-two.json"

cat >"$BIN/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

endpoint="${2:?expected gh api endpoint}"
case "$endpoint" in
  */actions/workflows/release-check.yml/runs\?*)
    printf '%s\n' 101 102 103 104 105 106 107 108 109 999
    ;;
  */actions/runs/*/artifacts\?*)
    run_id="${endpoint#*/actions/runs/}"
    run_id="${run_id%%/*}"
    jq -n --argjson id "$run_id" \
      '{artifacts: [{id: $id, name: ("release-evidence-standard-" + ($id | tostring)), expired: false}]}'
    ;;
  */actions/artifacts/*/zip)
    artifact_id="${endpoint#*/actions/artifacts/}"
    artifact_id="${artifact_id%/zip}"
    cat "${FIXTURE_ROOT}/${artifact_id}.zip"
    ;;
  *)
    printf 'Unexpected gh call: %s\n' "$*" >&2
    exit 1
    ;;
esac
EOF
chmod +x "$BIN/gh"

output=$(
  PATH="${BIN}:${PATH}" \
  FIXTURE_ROOT="$FIXTURES" \
  GITHUB_WORKSPACE="$WORKSPACE" \
  GITHUB_REPOSITORY="example/repository" \
  GITHUB_RUN_ID="999" \
  GITHUB_ENV="$GITHUB_ENV_FILE" \
    bash "$COLLECTOR"
)

history="${WORKSPACE}/typescript-7-history/history.json"
jq -e '
  length == 2
  and map(.sourceRevision) == ["revision-one", "revision-two"]
  and all(.schemaVersion == 3)
  and all(.runner.hardwareClass | test("^[a-f0-9]{64}$"))
' "$history" >/dev/null

[[ "$(grep -c '^TYPESCRIPT_7_HISTORY_JSON=' "$GITHUB_ENV_FILE")" -eq 1 ]]
[[ "$output" == *"Ignoring duplicate TypeScript 7 evidence for revision revision-one."* ]]
[[ "$output" == *"Collected 2 prior TypeScript 7 comparison artifact(s)."* ]]

echo "PASS: TypeScript 7 history rejects incompatible downloaded artifacts"