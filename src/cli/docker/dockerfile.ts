/**
 * Dockerfile templates for llmist sandboxing.
 *
 * Two templates are provided:
 * - DEFAULT_DOCKERFILE: Production mode - installs llmist from npm
 * - DEV_DOCKERFILE: Dev mode - runs from mounted source code
 *
 * Both include:
 * - Bun runtime
 * - ed (line editor for EditFile gadget)
 * - ripgrep (fast search tool)
 * - ast-grep (code search/refactoring)
 * - git (version control)
 */

import type { DockerConfig } from "./types.js";
import { DEV_SOURCE_MOUNT_TARGET } from "./types.js";

/**
 * Default Dockerfile template.
 *
 * Uses oven/bun:1-debian as base for:
 * - Modern Bun runtime
 * - Debian's extensive package ecosystem
 * - Good compatibility with common tools
 */
export const DEFAULT_DOCKERFILE = `# llmist sandbox image
# Auto-generated - customize via [docker].dockerfile in cli.toml

FROM oven/bun:1-debian

# Install essential tools
RUN apt-get update && apt-get install -y --no-install-recommends \\
    # ed for EditFile gadget (line-oriented editor)
    ed \\
    # ripgrep for fast file searching
    ripgrep \\
    # git for version control operations
    git \\
    # curl for downloads and API calls
    curl \\
    # ca-certificates for HTTPS
    ca-certificates \\
    && rm -rf /var/lib/apt/lists/*

# Install ast-grep for code search/refactoring
# Using the official install script
RUN curl -fsSL https://raw.githubusercontent.com/ast-grep/ast-grep/main/install.sh | bash \\
    && mv /root/.local/bin/ast-grep /usr/local/bin/ 2>/dev/null || true \\
    && mv /root/.local/bin/sg /usr/local/bin/ 2>/dev/null || true

# Install llmist globally via bun
RUN bun add -g llmist

# Working directory (host CWD will be mounted here)
WORKDIR /workspace

# Entry point - llmist with all arguments forwarded
ENTRYPOINT ["llmist"]
`;

/**
 * Dev mode Dockerfile template.
 *
 * Key differences from production:
 * - Does NOT install llmist from npm
 * - Expects llmist source to be mounted at ${DEV_SOURCE_MOUNT_TARGET}
 * - Runs directly from source via bun
 */
export const DEV_DOCKERFILE = `# llmist DEV sandbox image
# For development/testing with local source code

FROM oven/bun:1-debian

# Install essential tools (same as production)
RUN apt-get update && apt-get install -y --no-install-recommends \\
    ed \\
    ripgrep \\
    git \\
    curl \\
    ca-certificates \\
    && rm -rf /var/lib/apt/lists/*

# Install ast-grep for code search/refactoring
RUN curl -fsSL https://raw.githubusercontent.com/ast-grep/ast-grep/main/install.sh | bash \\
    && mv /root/.local/bin/ast-grep /usr/local/bin/ 2>/dev/null || true \\
    && mv /root/.local/bin/sg /usr/local/bin/ 2>/dev/null || true

# Working directory (host CWD will be mounted here)
WORKDIR /workspace

# Entry point - run llmist from mounted source
# Source is mounted at ${DEV_SOURCE_MOUNT_TARGET}
ENTRYPOINT ["bun", "run", "${DEV_SOURCE_MOUNT_TARGET}/src/cli.ts"]
`;

/**
 * Resolves the Dockerfile content to use.
 *
 * Priority:
 * 1. Custom dockerfile from config (always takes precedence)
 * 2. DEV_DOCKERFILE if dev mode is enabled
 * 3. DEFAULT_DOCKERFILE (production)
 *
 * @param config - Docker configuration
 * @param devMode - Whether dev mode is enabled
 * @returns Dockerfile content
 */
export function resolveDockerfile(config: DockerConfig, devMode = false): string {
  // Custom Dockerfile always takes precedence
  if (config.dockerfile) {
    return config.dockerfile;
  }
  return devMode ? DEV_DOCKERFILE : DEFAULT_DOCKERFILE;
}

/**
 * Computes a hash of the Dockerfile content for cache invalidation.
 *
 * Uses Bun's fast native hash function.
 *
 * @param dockerfile - Dockerfile content
 * @returns Hex string hash
 */
export function computeDockerfileHash(dockerfile: string): string {
  const encoder = new TextEncoder();
  const data = encoder.encode(dockerfile);
  // Bun.hash returns a 64-bit hash as BigInt, convert to hex string
  return Bun.hash(data).toString(16);
}
