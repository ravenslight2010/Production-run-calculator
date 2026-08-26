"""Offline fixture for the nightly Gemini outage notification policy."""

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


HELPER = Path(__file__).with_name("gemini_failure_alert.sh").resolve()


class GeminiFailureAlertTests(unittest.TestCase):
    def run_alert(self, prior_runs, conclusions, threshold=2):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fake_bin = root / "bin"
            fake_bin.mkdir()
            workflow_response = root / "workflow-runs.json"
            workflow_response.write_text(
                json.dumps(
                    {
                        "workflow_runs": [
                            {"id": run_id, "status": "completed"}
                            for run_id in prior_runs
                        ]
                    }
                )
            )
            capture = root / "slack-request.jsonl"
            conclusions_file = root / "conclusions.json"
            conclusions_file.write_text(json.dumps(conclusions))

            (fake_bin / "gh").write_text(
                """#!/usr/bin/env bash
set -euo pipefail
if [[ "$2" == repos/*/actions/workflows/*/runs?* ]]; then
  cat "$GH_WORKFLOW_RESPONSE"
  exit 0
fi
run_id="$(sed -n 's#.*actions/runs/\\([0-9][0-9]*\\)/jobs.*#\\1#p' <<<"$2")"
jq -r --arg id "$run_id" '.[$id] // "success"' "$GH_CONCLUSIONS"
"""
            )
            (fake_bin / "curl").write_text(
                """#!/usr/bin/env bash
set -euo pipefail
jq -c . >> "$SLACK_CAPTURE"
printf '\\n' >> "$SLACK_CAPTURE"
"""
            )
            for executable in ("gh", "curl"):
                (fake_bin / executable).chmod(0o755)

            result = subprocess.run(
                ["bash", str(HELPER)],
                env={
                    **os.environ,
                    "PATH": f"{fake_bin}:{os.environ['PATH']}",
                    "GH_WORKFLOW_RESPONSE": str(workflow_response),
                    "GH_CONCLUSIONS": str(conclusions_file),
                    "SLACK_CAPTURE": str(capture),
                    "GITHUB_SERVER_URL": "https://github.example",
                    "GITHUB_REPOSITORY": "factory/app",
                    "GITHUB_RUN_ID": "999",
                    "GEMINI_FAILURE_ALERT_THRESHOLD": str(threshold),
                    "SLACK_WEBHOOK_URL": "https://slack.example/webhook",
                },
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            requests = (
                [
                    line
                    for line in capture.read_text().splitlines()
                    if line.strip()
                ]
                if capture.exists()
                else []
            )
            return requests, result.stdout

    def test_first_failure_is_silent(self):
        requests, output = self.run_alert([100], {"100": "success"})
        self.assertEqual(requests, [])
        self.assertIn("streak is 1", output)

    def test_configured_threshold_alerts_once_with_operator_links(self):
        requests, _ = self.run_alert(
            [102, 101], {"102": "failure", "101": "failure"}, threshold=3
        )
        self.assertEqual(len(requests), 1)
        payload = json.loads(requests[0])
        self.assertIn(
            "https://github.example/factory/app/actions/runs/999",
            payload["text"],
        )
        self.assertIn(
            "https://github.example/factory/app/actions/runs/999#artifacts",
            payload["text"],
        )

    def test_later_failure_in_same_streak_is_silent(self):
        requests, output = self.run_alert(
            [101, 100], {"101": "failure", "100": "failure"}
        )
        self.assertEqual(requests, [])
        self.assertIn("streak is 3", output)

    def test_success_resets_streak_before_next_failure(self):
        requests, output = self.run_alert(
            [200, 199], {"200": "success", "199": "failure"}
        )
        self.assertEqual(requests, [])
        self.assertIn("streak is 1", output)


if __name__ == "__main__":
    unittest.main()