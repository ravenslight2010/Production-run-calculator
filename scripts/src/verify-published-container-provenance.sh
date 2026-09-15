#!/usr/bin/env bash

set -euo pipefail

expected_revision="${EXPECTED_REVISION:-}"
producer_run_id="${PRODUCER_WORKFLOW_RUN_ID:-}"
producer_workflow="${PRODUCER_WORKFLOW:-}"
report_path="${PROVENANCE_REPORT:-}"

if [[ -z "$report_path" ]]; then
  echo "Published container provenance verification failed: PROVENANCE_REPORT is required." >&2
  exit 1
fi

report_dir="$(dirname "$report_path")"
mkdir -p "$report_dir"
temporary_report="${report_path}.tmp"
rm -f "$temporary_report"
trap 'rm -f "$temporary_report"' EXIT

if [[ ! "$expected_revision" =~ ^[0-9a-f]{40}$ ]]; then
  printf 'schema_version=1\nexpected_revision=%s\noverall_status=fail\nfailure=EXPECTED_REVISION must be a 40-character lowercase commit SHA\n' \
    "$expected_revision" >"$report_path"
  echo "Published container provenance verification failed: EXPECTED_REVISION is not a 40-character lowercase commit SHA." >&2
  exit 1
fi

if [[ ! "$producer_run_id" =~ ^[1-9][0-9]*$ ]]; then
  echo "Published container provenance verification failed: PRODUCER_WORKFLOW_RUN_ID must be a positive integer." >&2
  exit 1
fi

if [[ "$producer_workflow" != ".github/workflows/ci.yml" ]]; then
  echo "Published container provenance verification failed: PRODUCER_WORKFLOW must identify .github/workflows/ci.yml." >&2
  exit 1
fi

image_names=(
  "${API_IMAGE:-}"
  "${API_MIGRATE_IMAGE:-}"
  "${WEB_IMAGE:-}"
)
image_digests=(
  "${API_DIGEST:-}"
  "${API_MIGRATE_DIGEST:-}"
  "${WEB_DIGEST:-}"
)
image_labels=(
  "api"
  "api-migrate"
  "web"
)

{
  printf 'schema_version=2\n'
  printf 'expected_revision=%s\n' "$expected_revision"
  printf 'producer_workflow=%s\n' "$producer_workflow"
  printf 'producer_workflow_run_id=%s\n' "$producer_run_id"
  printf 'image_count=%s\n' "${#image_names[@]}"
} >"$temporary_report"

failures=0

for index in "${!image_names[@]}"; do
  image_name="${image_names[$index]}"
  image_digest="${image_digests[$index]}"
  image_label="${image_labels[$index]}"
  image_number=$((index + 1))
  image_ref="${image_name}@${image_digest}"
  digest_verified=false
  revision_verified=false
  observed_revision=""
  failure_reason=""
  status=fail

  if [[ ! "$image_name" =~ ^[A-Za-z0-9._/-]+$ ]]; then
    failure_reason="image name is missing or malformed"
  elif [[ ! "$image_digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    failure_reason="publisher did not return a valid immutable sha256 digest"
  elif ! docker pull --quiet "$image_ref" >/dev/null 2>&1; then
    failure_reason="registry pull by immutable digest failed"
  else
    actual_ref_found=false
    while IFS= read -r repo_digest; do
      if [[ "$repo_digest" == *@${image_digest} ]]; then
        actual_ref_found=true
        break
      fi
    done < <(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$image_ref" 2>/dev/null || true)

    if [[ "$actual_ref_found" == true ]]; then
      digest_verified=true
    else
      failure_reason="pulled image did not retain the publisher digest"
    fi

    raw_observed_revision="$(
      docker image inspect \
        --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
        "$image_ref" 2>/dev/null | head -c 128 || true
    )"
    if [[ "$raw_observed_revision" =~ ^[0-9a-f]{40}$ ]]; then
      observed_revision="$raw_observed_revision"
    else
      observed_revision="<invalid>"
    fi
    if [[ "$observed_revision" == "$expected_revision" ]]; then
      revision_verified=true
    elif [[ -z "$failure_reason" ]]; then
      failure_reason="image revision label does not match the reviewed commit"
    fi

    if [[ "$digest_verified" == true && "$revision_verified" == true ]]; then
      status=pass
    fi
  fi

  if [[ "$status" != pass ]]; then
    failures=$((failures + 1))
  fi

  {
    report_image_name="$image_name"
    report_image_digest="$image_digest"
    if [[ ! "$report_image_name" =~ ^[A-Za-z0-9._/-]+$ ]]; then
      report_image_name="<invalid>"
    fi
    if [[ ! "$report_image_digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
      report_image_digest="<invalid>"
    fi
    printf 'image_%s_name=%s\n' "$image_number" "$image_label"
    printf 'image_%s_repository=%s\n' "$image_number" "$report_image_name"
    printf 'image_%s_digest=%s\n' "$image_number" "$report_image_digest"
    printf 'image_%s_observed_revision=%s\n' "$image_number" "$observed_revision"
    printf 'image_%s_digest_verified=%s\n' "$image_number" "$digest_verified"
    printf 'image_%s_revision_verified=%s\n' "$image_number" "$revision_verified"
    printf 'image_%s_status=%s\n' "$image_number" "$status"
    if [[ "$status" != pass ]]; then
      printf 'image_%s_failure=%s\n' "$image_number" "${failure_reason:-verification failed}"
    fi
  } >>"$temporary_report"
done

if (( failures > 0 )); then
  printf 'overall_status=fail\nfailure_count=%s\n' "$failures" >>"$temporary_report"
  mv "$temporary_report" "$report_path"
  echo "Published container provenance verification failed for $failures image(s)." >&2
  exit 1
fi

printf 'overall_status=pass\nfailure_count=0\n' >>"$temporary_report"
mv "$temporary_report" "$report_path"
echo "Published container provenance verified for all ${#image_names[@]} images."