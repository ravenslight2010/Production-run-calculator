#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
VERIFY_SCRIPT="${SCRIPT_DIR}/verify-container-promotion.sh"
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT

revision=0123456789abcdef0123456789abcdef01234567
run_id=123456
artifact_digest=sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
evidence="$TEST_ROOT/evidence.txt"
output="$TEST_ROOT/promotion.txt"

write_valid_evidence() {
  cat >"$evidence" <<EOF
schema_version=2
expected_revision=$revision
producer_workflow=.github/workflows/ci.yml
producer_workflow_run_id=$run_id
image_count=3
image_1_name=api
image_1_repository=ghcr.io/example/runcalc-api
image_1_digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
image_1_observed_revision=$revision
image_1_digest_verified=true
image_1_revision_verified=true
image_1_status=pass
image_2_name=api-migrate
image_2_repository=ghcr.io/example/runcalc-api-migrate
image_2_digest=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
image_2_observed_revision=$revision
image_2_digest_verified=true
image_2_revision_verified=true
image_2_status=pass
image_3_name=web
image_3_repository=ghcr.io/example/runcalc-web
image_3_digest=sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
image_3_observed_revision=$revision
image_3_digest_verified=true
image_3_revision_verified=true
image_3_status=pass
overall_status=pass
failure_count=0
EOF
}

run_verify() {
  PROMOTION_EVIDENCE="$evidence" \
  PROMOTION_OUTPUT="$output" \
  EXPECTED_REVISION="$revision" \
  EXPECTED_WORKFLOW_RUN_ID="$run_id" \
  EXPECTED_WORKFLOW=.github/workflows/ci.yml \
  EXPECTED_ARTIFACT_DIGEST="$artifact_digest" \
  OBSERVED_ARTIFACT_DIGEST="$artifact_digest" \
  API_IMAGE=ghcr.io/example/runcalc-api \
  API_MIGRATE_IMAGE=ghcr.io/example/runcalc-api-migrate \
  WEB_IMAGE=ghcr.io/example/runcalc-web \
    bash "$VERIFY_SCRIPT"
}

write_valid_evidence
run_verify >/dev/null
grep -Fq 'api_image=ghcr.io/example/runcalc-api@sha256:aaaaaaaa' "$output"
grep -Fq "publisher_artifact_digest=$artifact_digest" "$output"

assert_rejected() {
  local description="$1"
  if run_verify >/dev/null 2>&1; then
    echo "Expected rejection: $description" >&2
    exit 1
  fi
}

rm "$evidence"
assert_rejected "missing evidence"
write_valid_evidence
sed -i '/^image_2_digest=/d' "$evidence"
assert_rejected "missing digest"
write_valid_evidence
sed -i 's/^expected_revision=.*/expected_revision=ffffffffffffffffffffffffffffffffffffffff/' "$evidence"
assert_rejected "stale revision"
write_valid_evidence
sed -i 's/^producer_workflow_run_id=.*/producer_workflow_run_id=999999/' "$evidence"
assert_rejected "mismatched workflow run"
write_valid_evidence
sed -i 's/^image_3_digest=.*/image_3_digest=latest/' "$evidence"
assert_rejected "tag-only image"
write_valid_evidence
sed -i 's#^image_1_repository=.*#image_1_repository=ghcr.io/example/other-api#' "$evidence"
assert_rejected "mismatched repository"
write_valid_evidence
OBSERVED_ARTIFACT_DIGEST=sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee \
  EXPECTED_ARTIFACT_DIGEST="$artifact_digest" \
  PROMOTION_EVIDENCE="$evidence" PROMOTION_OUTPUT="$output" \
  EXPECTED_REVISION="$revision" EXPECTED_WORKFLOW_RUN_ID="$run_id" \
  API_IMAGE=ghcr.io/example/runcalc-api \
  API_MIGRATE_IMAGE=ghcr.io/example/runcalc-api-migrate \
  WEB_IMAGE=ghcr.io/example/runcalc-web \
  bash "$VERIFY_SCRIPT" >/dev/null 2>&1 && {
    echo "Expected artifact digest mismatch to fail." >&2
    exit 1
  }

echo "PASS: container promotion accepts only revision/run/artifact-bound immutable images"