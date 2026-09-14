#!/usr/bin/env bash

set -euo pipefail

workspace_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
workflow_dir="${CI_BINARY_WORKFLOW_DIR:-$workspace_root/.github/workflows}"
inventory="$workflow_dir/ci-binary-provenance.md"

if [[ ! -d "$workflow_dir" ]]; then
  echo "CI binary provenance check failed: workflow directory is missing: $workflow_dir" >&2
  exit 1
fi

if [[ ! -f "$inventory" ]]; then
  echo "CI binary provenance check failed: missing inventory: $inventory" >&2
  exit 1
fi

mapfile -t workflow_files < <(
  find "$workflow_dir" -type f \( -name '*.yml' -o -name '*.yaml' \) -print | sort
)

if (( ${#workflow_files[@]} == 0 )); then
  echo "CI binary provenance check failed: no workflow files were found." >&2
  exit 1
fi

failures=0

check_published_container_contract() {
  local publisher_workflow="$workflow_dir/ci.yml"
  local publisher_block
  local verify_line
  local retain_line

  if [[ ! -f "$publisher_workflow" ]]; then
    return 0
  fi

  publisher_block="$(
    awk '
      $0 == "  docker-publish:" {
        found = 1
        print
        next
      }
      found && $0 ~ /^  [A-Za-z0-9_-]+:/ {
        exit
      }
      found {
        print
      }
    ' "$publisher_workflow"
  )"

  if [[ -z "$publisher_block" ]]; then
    return 0
  fi

  if ! grep -Fq "if: github.event_name == 'push' && github.ref == 'refs/heads/main'" <<<"$publisher_block"; then
    echo "::error file=$publisher_workflow::Container publisher must be restricted to trusted pushes on main." >&2
    failures=$((failures + 1))
  fi

  if ! grep -Fq "packages: write" <<<"$publisher_block"; then
    echo "::error file=$publisher_workflow::Container publisher must declare packages: write explicitly." >&2
    failures=$((failures + 1))
  fi

  for required_text in \
    "id: publish-api" \
    "id: publish-api-migrate" \
    "id: publish-web" \
    "org.opencontainers.image.revision=\${{ github.sha }}" \
    "bash scripts/src/verify-published-container-provenance.sh" \
    "name: release-evidence-container-images-\${{ github.run_id }}" \
    "retention-days: 14"; do
    if ! grep -Fq "$required_text" <<<"$publisher_block"; then
      echo "::error file=$publisher_workflow::Container publisher is missing required provenance contract: $required_text" >&2
      failures=$((failures + 1))
    fi
  done

  verify_line="$(
    grep -nF "bash scripts/src/verify-published-container-provenance.sh" <<<"$publisher_block" |
      cut -d: -f1 |
      head -n1 || true
  )"
  retain_line="$(
    grep -nF "name: release-evidence-container-images-\${{ github.run_id }}" <<<"$publisher_block" |
      cut -d: -f1 |
      head -n1 || true
  )"
  if [[ -n "$verify_line" && -n "$retain_line" && "$verify_line" -ge "$retain_line" ]]; then
    echo "::error file=$publisher_workflow::Container provenance verification must happen before evidence retention." >&2
    failures=$((failures + 1))
  fi
}

for workflow in "${workflow_files[@]}"; do
  # These patterns deliberately cover both the current release-download form
  # and common future forms. Package-manager installs and health/webhook curls
  # are not binary downloads and therefore are not flagged.
  mapfile -t download_lines < <(
    {
      grep -Ein \
        'releases/download|gh[[:space:]]+(release[[:space:]]+)?download|actions/download-artifact|(^|[[:space:]])(curl|wget)[[:space:]].*(--output[=[:space:]]|-o[[:space:]]|--remote-name([[:space:]]|$)|(^|[[:space:]])-O([[:space:]]|$))|(^|[[:space:]])(tar|unzip)[[:space:]]' \
        "$workflow" || true
      awk '
        function continued(line) { return line ~ /\\[[:space:]]*$/ }
        {
          if (!in_download && $0 ~ /(^|[[:space:]])(curl|wget)[[:space:]]/) {
            in_download = 1
            start_line = NR
          }
          if (in_download && $0 ~ /--output([=[:space:]])|-o[[:space:]]|--remote-name([[:space:]]|$)|(^|[[:space:]])-O([[:space:]]|$)/) {
            print start_line ": multiline curl/wget output"
            in_download = 0
          } else if (in_download && !continued($0)) {
            in_download = 0
          }
        }
      ' "$workflow"
    } | sort -t: -k1,1n -u
  )

  if (( ${#download_lines[@]} == 0 )); then
    continue
  fi

  verify_line="$(
    grep -Ein 'gh[[:space:]]+attestation[[:space:]]+verify' "$workflow" |
      cut -d: -f1 |
      head -n1 || true
  )"
  extract_line="$(
    grep -Ein '(^|[[:space:]])(tar[[:space:]]+-[a-zA-Z]*x|unzip([[:space:]]|$)|install[[:space:]]+-m|chmod[[:space:]]+\+x|(^|[[:space:]])\./)' "$workflow" |
      cut -d: -f1 |
      head -n1 || true
  )"

  if [[ -z "$verify_line" ]]; then
    echo "::error file=$workflow::Downloaded executable/archive has no GitHub artifact-attestation verification." >&2
    failures=$((failures + 1))
    continue
  fi

  if ! grep -Eq -- '--repo[[:space:]]+[^[:space:]]+' "$workflow"; then
    echo "::error file=$workflow::Artifact-attestation verification must pin the expected publisher repository with --repo." >&2
    failures=$((failures + 1))
  fi

  if ! grep -Eq -- '--signer-workflow[[:space:]]+[^[:space:]]+' "$workflow"; then
    echo "::error file=$workflow::Artifact-attestation verification must pin the expected signing workflow with --signer-workflow." >&2
    failures=$((failures + 1))
  fi

  if ! grep -Eq -- '--cert-oidc-issuer[[:space:]]+https://token\.actions\.githubusercontent\.com' "$workflow"; then
    echo "::error file=$workflow::Artifact-attestation verification must pin GitHub's Actions OIDC issuer." >&2
    failures=$((failures + 1))
  fi

  if [[ -n "$extract_line" && "$verify_line" -ge "$extract_line" ]]; then
    echo "::error file=$workflow::Artifact-attestation verification must happen before extraction, installation, or execution." >&2
    failures=$((failures + 1))
  fi
done

check_published_container_contract

if (( failures > 0 )); then
  echo "CI binary/container provenance check failed with $failures issue(s)." >&2
  exit 1
fi

echo "All downloaded CI executables and published container images have fail-closed provenance gates."