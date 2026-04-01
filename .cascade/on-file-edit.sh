#!/bin/bash
# Post-edit validation for LLMIST agent
# Runs linting and targeted type checks on edited files.
#
# Usage: .cascade/on-file-edit.sh <file-path>
#
# Exit codes:
#   0  - All checks passed (or file type not applicable)
#   1  - Lint errors found
#   2  - Type errors found
#   3  - Both lint and type errors found
#   10 - File not found
#   11 - No file path provided

set -uo pipefail

FILE_PATH="${1:-}"

if [ -z "$FILE_PATH" ]; then
  echo "Error: No file path provided"
  echo "Usage: $0 <file-path>"
  exit 11
fi

if [[ ! "$FILE_PATH" = /* ]]; then
  FILE_PATH="$(pwd)/$FILE_PATH"
fi

if [ ! -f "$FILE_PATH" ]; then
  echo "Error: File not found: $FILE_PATH"
  exit 10
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

REL_PATH="${FILE_PATH#$PROJECT_ROOT/}"
EXT="${FILE_PATH##*.}"

LINT_APPLICABLE=false
TYPE_APPLICABLE=false
TYPE_CMD=()

case "$EXT" in
  ts|tsx)
    LINT_APPLICABLE=true
    TYPE_APPLICABLE=true
    ;;
  js|jsx|json|jsonc|mjs|cjs)
    LINT_APPLICABLE=true
    ;;
esac

if [ "$LINT_APPLICABLE" = false ] && [ "$TYPE_APPLICABLE" = false ]; then
  exit 0
fi

if [ "$TYPE_APPLICABLE" = true ]; then
  if [[ "$REL_PATH" == packages/cli/* ]]; then
    TYPE_CMD=(npx tsc --noEmit --project packages/cli/tsconfig.json)
  elif [[ "$REL_PATH" == packages/llmist/* ]]; then
    TYPE_CMD=(npx tsc --noEmit --project packages/llmist/tsconfig.json)
  elif [[ "$REL_PATH" == packages/testing/* ]]; then
    TYPE_CMD=(npx tsc --noEmit --project packages/testing/tsconfig.json)
  elif [[ "$REL_PATH" == packages/docs/* ]]; then
    TYPE_CMD=(npm run --workspace @llmist/docs typecheck)
  else
    TYPE_APPLICABLE=false
  fi
fi

LINT_EXIT=0
TYPE_EXIT=0
LINT_OUTPUT=""
TYPE_OUTPUT=""

if [ "$LINT_APPLICABLE" = true ]; then
  LINT_OUTPUT=$(npx biome lint "$REL_PATH" 2>&1)
  LINT_EXIT=$?
fi

if [ "$TYPE_APPLICABLE" = true ]; then
  TYPE_OUTPUT=$("${TYPE_CMD[@]}" 2>&1)
  TYPE_EXIT=$?
fi

if [ $LINT_EXIT -ne 0 ]; then
  echo "=== Biome Lint: $REL_PATH ==="
  echo "$LINT_OUTPUT"
  echo ""
fi

if [ $TYPE_EXIT -ne 0 ]; then
  echo "=== Type Check: $REL_PATH ==="
  echo "$TYPE_OUTPUT"
  echo ""
fi

if [ $LINT_EXIT -ne 0 ] && [ $TYPE_EXIT -ne 0 ]; then
  exit 3
elif [ $LINT_EXIT -ne 0 ]; then
  exit 1
elif [ $TYPE_EXIT -ne 0 ]; then
  exit 2
else
  exit 0
fi
