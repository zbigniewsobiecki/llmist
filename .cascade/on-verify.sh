#!/bin/bash
# Post-edit verification suite for LLMIST agent
# Runs diagnostics and tests based on scope argument.
#
# Usage: .cascade/on-verify.sh <scope>
#   scope: diagnostics | tests | e2e | full (default: full)
#
# Exit codes:
#   0  - All checks passed
#   1  - Lint errors found
#   2  - Type errors found
#   3  - Both lint and type errors found
#   4  - Test failures
#   5  - Multiple failure types (diagnostics + tests)
#   6  - E2E failures

set -uo pipefail

SCOPE="${1:-full}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

LINT_EXIT=0
TYPE_EXIT=0
TEST_EXIT=0
E2E_EXIT=0
LINT_OUTPUT=""
TYPE_OUTPUT=""
TEST_OUTPUT=""
E2E_OUTPUT=""

if [ "$SCOPE" = "diagnostics" ] || [ "$SCOPE" = "full" ]; then
  LINT_OUTPUT=$(npm run lint 2>&1)
  LINT_EXIT=$?

  TYPE_OUTPUT=$(npm run typecheck 2>&1)
  TYPE_EXIT=$?
fi

if [ "$SCOPE" = "tests" ] || [ "$SCOPE" = "full" ]; then
  TEST_OUTPUT=$(npm test 2>&1)
  TEST_EXIT=$?
fi

if [ "$SCOPE" = "e2e" ]; then
  E2E_OUTPUT=$(npm run test:e2e 2>&1)
  E2E_EXIT=$?
fi

HAS_ERRORS=false

if [ $LINT_EXIT -ne 0 ]; then
  HAS_ERRORS=true
  echo "=== Biome Lint ==="
  echo "$LINT_OUTPUT"
  echo ""
fi

if [ $TYPE_EXIT -ne 0 ]; then
  HAS_ERRORS=true
  echo "=== TypeScript ==="
  echo "$TYPE_OUTPUT"
  echo ""
fi

if [ $TEST_EXIT -ne 0 ]; then
  HAS_ERRORS=true
  echo "=== Tests ==="
  echo "$TEST_OUTPUT"
  echo ""
fi

if [ $E2E_EXIT -ne 0 ]; then
  HAS_ERRORS=true
  echo "=== E2E Tests ==="
  echo "$E2E_OUTPUT"
  echo ""
fi

if [ "$HAS_ERRORS" = false ]; then
  echo "All checks passed."
fi

DIAG_FAILED=false
if [ $LINT_EXIT -ne 0 ] || [ $TYPE_EXIT -ne 0 ]; then
  DIAG_FAILED=true
fi

if [ "$SCOPE" = "e2e" ]; then
  if [ $E2E_EXIT -ne 0 ]; then
    exit 6
  fi
  exit 0
fi

if [ "$DIAG_FAILED" = true ] && [ $TEST_EXIT -ne 0 ]; then
  exit 5
elif [ $LINT_EXIT -ne 0 ] && [ $TYPE_EXIT -ne 0 ]; then
  exit 3
elif [ $LINT_EXIT -ne 0 ]; then
  exit 1
elif [ $TYPE_EXIT -ne 0 ]; then
  exit 2
elif [ $TEST_EXIT -ne 0 ]; then
  exit 4
else
  exit 0
fi
