#!/usr/bin/env bash
set -eu

echo "V2 is limited to a private development pilot. Publishing is blocked until production database access and required V2 SQL objects pass review." >&2
exit 78
