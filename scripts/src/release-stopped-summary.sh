#!/usr/bin/env bash
set -euo pipefail

: "${CHECKPOINT_DIR:?CHECKPOINT_DIR is required}"
: "${GITHUB_STEP_SUMMARY:?GITHUB_STEP_SUMMARY is required}"
: "${RELEASE_MODE:?RELEASE_MODE is required}"

if [[ ! -s "$CHECKPOINT_DIR/release-check-checkpoint.md" ]]; then
  exit 0
fi

verify_checkpoint_artifact_link() {
  : "${CHECKPOINT_ARTIFACT_URL:?CHECKPOINT_ARTIFACT_URL is required for artifact-link verification}"
  : "${CHECKPOINT_ARTIFACT_NAME:?CHECKPOINT_ARTIFACT_NAME is required for artifact-link verification}"
  : "${GITHUB_API_URL:?GITHUB_API_URL is required for artifact-link verification}"
  : "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required for artifact-link verification}"
  : "${GITHUB_TOKEN:?GITHUB_TOKEN is required for artifact-link verification}"

  local artifact_id="${CHECKPOINT_ARTIFACT_URL##*/}"
  if [[ ! "$artifact_id" =~ ^[0-9]+$ ]]; then
    echo "Stopped-check artifact link verification failed: malformed artifact link."
    return 1
  fi

  if ! curl --fail --silent --location \
    --header "Authorization: Bearer ${GITHUB_TOKEN}" \
    --header "Accept: application/vnd.github+json" \
    --output /dev/null \
    "$CHECKPOINT_ARTIFACT_URL" 2>/dev/null; then
    echo "Stopped-check artifact link verification failed: link did not resolve."
    return 1
  fi

  local artifact_api_response
  artifact_api_response="$(mktemp)"
  if ! curl --fail --silent --location \
    --header "Authorization: Bearer ${GITHUB_TOKEN}" \
    --header "Accept: application/vnd.github+json" \
    --output "$artifact_api_response" \
    "${GITHUB_API_URL%/}/repos/${GITHUB_REPOSITORY}/actions/artifacts/${artifact_id}" \
    2>/dev/null; then
    rm -f "$artifact_api_response"
    echo "Stopped-check artifact link verification failed: artifact metadata was unavailable."
    return 1
  fi

  local actual_artifact_name
  if ! actual_artifact_name="$(jq -er '.name' "$artifact_api_response" 2>/dev/null)"; then
    rm -f "$artifact_api_response"
    echo "Stopped-check artifact link verification failed: artifact metadata was malformed."
    return 1
  fi
  rm -f "$artifact_api_response"

  if [[ "$actual_artifact_name" != "$CHECKPOINT_ARTIFACT_NAME" ]]; then
    echo "Stopped-check artifact link verification failed: uploaded artifact name did not match."
    return 1
  fi
}

artifact_link_verification_status=0
if [[ "${VERIFY_CHECKPOINT_ARTIFACT_LINK:-0}" == "1" && -n "${CHECKPOINT_ARTIFACT_URL:-}" ]]; then
  verify_checkpoint_artifact_link || artifact_link_verification_status=$?
fi

case "$RELEASE_MODE" in
  standard)
    stopped_message="The release check stopped before all gates completed."
    ;;
  full)
    stopped_message="The full release check stopped before all gates completed."
    ;;
  *)
    echo "Unsupported release mode: $RELEASE_MODE" >&2
    exit 2
    ;;
esac

{
  echo "## Release check stopped — NO-GO"
  echo
  echo "$stopped_message"
  echo
  if [[ -n "${CHECKPOINT_ARTIFACT_URL:-}" ]]; then
    echo "[Download the stopped-check checkpoint artifact]($CHECKPOINT_ARTIFACT_URL)"
  else
    echo "The checkpoint artifact was not uploaded successfully."
  fi
  echo
  echo "**This checkpoint is not retained release evidence and cannot support a GO decision.**"
  echo
  echo "Resume the incomplete check with:"
  echo '```text'
  echo "${RESUME_COMMAND:?RESUME_COMMAND is required}"
  echo '```'
  echo
  echo "Or regenerate the retained report from a fresh run with:"
  echo '```text'
  echo "${REGENERATE_COMMAND:?REGENERATE_COMMAND is required}"
  echo '```'
} >> "$GITHUB_STEP_SUMMARY"

exit "$artifact_link_verification_status"
