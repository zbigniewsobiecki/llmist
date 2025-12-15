/**
 * Dockerfile templates for llmist sandboxing.
 *
 * Includes:
 * - Bun runtime
 * - ed (line editor for EditFile gadget)
 * - ripgrep (fast search tool)
 * - ast-grep (code search/refactoring)
 * - git (version control)
 *
 * For development setups, use a custom dockerfile in config with docker-args
 * to mount your local source.
 */

import type { DockerConfig } from "./types.js";

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
    # python3 for native module compilation (node-gyp)
    python3 \\
    # build-essential for compiling native modules
    build-essential \\
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
 * Resolves the Dockerfile content to use.
 *
 * Returns custom dockerfile from config if provided, otherwise DEFAULT_DOCKERFILE.
 *
 * @param config - Docker configuration
 * @returns Dockerfile content
 */
export function resolveDockerfile(config: DockerConfig): string {
  return config.dockerfile ?? DEFAULT_DOCKERFILE;
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
