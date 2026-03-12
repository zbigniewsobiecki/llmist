#!/bin/bash
set -euo pipefail

echo "=== LLMIST Project Setup for CASCADE ==="
echo "Agent profile: ${AGENT_PROFILE_NAME:-not set}"

log_info() {
  echo "[INFO] $1"
}

log_warn() {
  echo "[WARN] $1"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

log_info "Project root: $PROJECT_ROOT"
cd "$PROJECT_ROOT"

echo ""
echo "--- Checking Prerequisites ---"

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js is not installed"
  exit 1
fi
log_info "Node.js: $(node --version)"

if ! command -v npm >/dev/null 2>&1; then
  echo "[ERROR] npm is not installed"
  exit 1
fi
log_info "npm: $(npm --version)"

echo ""
case "${AGENT_PROFILE_NAME:-}" in
  implementation|respond-to-review|review|respond-to-ci)
    echo "--- Installing Dependencies ---"
    CI=true npm install
    log_info "Workspace dependencies installed"
    ;;
  *)
    log_info "Skipping dependency installation (agent: ${AGENT_PROFILE_NAME:-unknown})"
    ;;
esac

echo ""
echo "--- Provider Environment Check ---"

if [ -f ".env" ]; then
  log_info "Found .env"
else
  log_warn "No .env file found; provider-backed E2E tests may be unavailable"
fi

check_env_var() {
  local var_name="$1"
  if [ -n "${!var_name:-}" ]; then
    log_info "$var_name is set"
  else
    log_warn "$var_name is not set"
  fi
}

check_env_var "OPENAI_API_KEY"
check_env_var "ANTHROPIC_API_KEY"
check_env_var "GEMINI_API_KEY"

echo ""
log_info "No database or Redis services are required for this repository"
log_info "Setup complete"
