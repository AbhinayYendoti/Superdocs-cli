#!/usr/bin/env bash
#
# git-release-notes.sh
#
# Generates release notes from a Git diff between two refs.
#
# Usage:
#   ./examples/git-release-notes.sh <from-ref> <to-ref> [output-file]
#
# Example:
#   ./examples/git-release-notes.sh v0.9.0 v1.0.0
#   ./examples/git-release-notes.sh v0.9.0 HEAD release-notes.md

set -euo pipefail

FROM="${1:?Usage: $0 <from-ref> <to-ref> [output-file]}"
TO="${2:?Usage: $0 <from-ref> <to-ref> [output-file]}"
OUTPUT="${3:-}"

PROMPT="Write professional release notes from this diff. Include:
- A brief summary of the release
- New features
- Bug fixes
- Breaking changes (if any)
Format as markdown with sections."

if [ -n "$OUTPUT" ]; then
  echo "Generating release notes: $FROM → $TO → $OUTPUT"
  git diff "$FROM".."$TO" | superdocs edit --prompt "$PROMPT" --output "$OUTPUT"
  echo "✅ Release notes saved to $OUTPUT"
else
  echo "Generating release notes: $FROM → $TO"
  echo ""
  git diff "$FROM".."$TO" | superdocs edit --prompt "$PROMPT"
fi
