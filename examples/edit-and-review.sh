#!/usr/bin/env bash
#
# edit-and-review.sh
#
# Demonstrates a typical superdocs-cli workflow:
#   1. Edit a document with a prompt
#   2. Preview the changes with --dry-run
#   3. Apply the edit
#
# Usage:
#   ./examples/edit-and-review.sh <file> <prompt>
#
# Example:
#   ./examples/edit-and-review.sh ./proposal.md "Make this more concise"

set -euo pipefail

FILE="${1:?Usage: $0 <file> <prompt>}"
PROMPT="${2:?Usage: $0 <file> <prompt>}"

echo "=== Step 1: Preview proposed changes ==="
echo ""
superdocs edit "$FILE" --dry-run --prompt "$PROMPT"

echo ""
echo "=== Step 2: Apply? (press Enter to continue, Ctrl+C to abort) ==="
read -r

echo "=== Applying edit... ==="
superdocs edit "$FILE" --prompt "$PROMPT"

echo ""
echo "✅ Done! File updated: $FILE"
