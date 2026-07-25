#!/usr/bin/env bash
#
# ci-edit.sh
#
# Example CI/CD script that uses superdocs-cli to auto-format
# a generated file and validates the result via JSON output.
#
# Usage:
#   SUPERDOCS_API_KEY=sk_... ./examples/ci-edit.sh <file> <prompt>
#
# Example:
#   SUPERDOCS_API_KEY=sk_... ./examples/ci-edit.sh ./CHANGELOG.md "Format as Keep a Changelog"

set -euo pipefail

FILE="${1:?Usage: $0 <file> <prompt>}"
PROMPT="${2:?Usage: $0 <file> <prompt>}"

echo "Running superdocs edit in CI mode..."

RESULT=$(superdocs edit "$FILE" --prompt "$PROMPT" --json 2>/dev/null)
OK=$(echo "$RESULT" | jq -r '.ok')

if [ "$OK" = "true" ]; then
  SESSION=$(echo "$RESULT" | jq -r '.sessionId')
  JOB=$(echo "$RESULT" | jq -r '.jobId')
  echo "✅ Edit succeeded (session: $SESSION, job: $JOB)"
  exit 0
else
  ERROR=$(echo "$RESULT" | jq -r '.error // "Unknown error"')
  echo "❌ Edit failed: $ERROR"
  exit 1
fi
