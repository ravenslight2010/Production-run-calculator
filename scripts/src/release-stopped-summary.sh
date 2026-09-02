#!/usr/bin/env bash
set -euo pipefail

: "${CHECKPOINT_DIR:?CHECKPOINT_DIR is required}"
: "${GITHUB_STEP_SUMMARY:?GITHUB_STEP_SUMMARY is required}"
: "${RELEASE_MODE:?RELEASE_MODE is required}"

if [[ ! -s "$CHECKPOINT_DIR/release-check-checkpoint.md" ]]; then
  exit 0
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