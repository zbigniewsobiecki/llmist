/**
 * Docker execution wrapper.
 *
 * Handles:
 * - Checking if Docker is available
 * - Building/caching the Docker image
 * - Running llmist inside the container
 * - Forwarding environment variables and mounts
 */

import { homedir } from "node:os";
import { resolveDockerfile } from "./dockerfile.js";
import { ensureImage, DockerBuildError } from "./image-manager.js";
import {
  type DockerConfig,
  type DockerExecutionContext,
  type DockerOptions,
  type MountPermission,
  DEFAULT_IMAGE_NAME,
  DEFAULT_CWD_PERMISSION,
  DEFAULT_CONFIG_PERMISSION,
  FORWARDED_API_KEYS,
  LLMIST_UNSAFE_ENV,
} from "./types.js";

/**
 * Error thrown when Docker is not available.
 */
export class DockerUnavailableError extends Error {
  constructor() {
    super(
      "Docker is required but not available. " +
        "Install Docker or disable Docker sandboxing in your configuration.",
    );
    this.name = "DockerUnavailableError";
  }
}

/**
 * Error thrown when Docker container execution fails.
 */
export class DockerRunError extends Error {
  constructor(
    public readonly exitCode: number,
    public readonly stderr: string,
  ) {
    super(`Docker container exited with code ${exitCode}`);
    this.name = "DockerRunError";
  }
}

/**
 * Checks if Docker is available and running.
 *
 * @returns true if Docker is available
 */
export async function checkDockerAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["docker", "info"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Checks if we're already running inside a Docker container.
 *
 * Uses the LLMIST_UNSAFE_ENVIRONMENT env var to detect nesting.
 *
 * @returns true if running inside a container
 */
export function isInsideContainer(): boolean {
  return process.env[LLMIST_UNSAFE_ENV] === "1";
}

/**
 * Expands ~ to home directory in a path.
 */
function expandHome(path: string): string {
  if (path.startsWith("~")) {
    return path.replace(/^~/, homedir());
  }
  return path;
}

/**
 * Builds the docker run command arguments.
 *
 * @param ctx - Docker execution context
 * @param imageName - Docker image name to run
 * @returns Array of arguments for docker run
 */
function buildDockerRunArgs(
  ctx: DockerExecutionContext,
  imageName: string,
): string[] {
  const args: string[] = ["run", "--rm"];

  // Generate unique container name to avoid collisions
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  const containerName = `llmist-${timestamp}-${random}`;
  args.push("--name", containerName);

  // TTY handling - only add -it if stdin is a TTY
  if (process.stdin.isTTY) {
    args.push("-it");
  }

  // Mount current working directory
  // Priority: --docker-ro flag > profile-level > config-level > default
  const cwdPermission: MountPermission = ctx.options.dockerRo
    ? "ro"
    : (ctx.profileCwdPermission ?? ctx.config["cwd-permission"] ?? DEFAULT_CWD_PERMISSION);
  args.push("-v", `${ctx.cwd}:/workspace:${cwdPermission}`);
  args.push("-w", "/workspace");

  // Mount ~/.llmist config directory (for config access inside container)
  const configPermission = ctx.config["config-permission"] ?? DEFAULT_CONFIG_PERMISSION;
  const llmistDir = expandHome("~/.llmist");
  args.push("-v", `${llmistDir}:/root/.llmist:${configPermission}`);

  // Additional mounts from config
  if (ctx.config.mounts) {
    for (const mount of ctx.config.mounts) {
      const source = expandHome(mount.source);
      args.push("-v", `${source}:${mount.target}:${mount.permission}`);
    }
  }

  // Forward API keys (if set in environment)
  for (const key of FORWARDED_API_KEYS) {
    if (process.env[key]) {
      args.push("-e", key);
    }
  }

  // Forward additional env vars from config
  if (ctx.config["env-vars"]) {
    for (const key of ctx.config["env-vars"]) {
      if (process.env[key]) {
        args.push("-e", key);
      }
    }
  }

  // Set the unsafe environment marker to prevent nesting
  args.push("-e", `${LLMIST_UNSAFE_ENV}=1`);

  // Image name
  args.push(imageName);

  // Forward the CLI arguments (these go to llmist inside the container)
  args.push(...ctx.forwardArgs);

  return args;
}

/**
 * Filters out Docker-related flags from CLI arguments.
 *
 * These flags are consumed by the wrapper and should not be
 * passed to the llmist instance inside the container.
 *
 * @param argv - Original CLI arguments
 * @returns Filtered arguments without Docker flags
 */
export function filterDockerArgs(argv: string[]): string[] {
  const dockerFlags = new Set(["--docker", "--docker-ro", "--no-docker"]);
  return argv.filter((arg) => !dockerFlags.has(arg));
}

/**
 * Resolves whether Docker mode should be enabled.
 *
 * Priority (highest to lowest):
 * 1. --no-docker flag (disables)
 * 2. --docker or --docker-ro flag (enables)
 * 3. Profile/command docker: true in config
 * 4. Global [docker].enabled in config
 *
 * @param config - Docker configuration
 * @param options - CLI options
 * @param profileDocker - docker: true/false from profile config
 * @returns Whether Docker mode is enabled
 */
export function resolveDockerEnabled(
  config: DockerConfig | undefined,
  options: DockerOptions,
  profileDocker?: boolean,
): boolean {
  // CLI --no-docker overrides everything
  if (options.noDocker) {
    return false;
  }

  // CLI --docker or --docker-ro enables
  if (options.docker || options.dockerRo) {
    return true;
  }

  // Profile-level docker: true/false
  if (profileDocker !== undefined) {
    return profileDocker;
  }

  // Global [docker].enabled
  return config?.enabled ?? false;
}

/**
 * Executes llmist inside a Docker container.
 *
 * This function:
 * 1. Checks if already inside a container (prevents nesting)
 * 2. Verifies Docker is available
 * 3. Builds/caches the image
 * 4. Runs the container with appropriate mounts and env vars
 * 5. Exits with the container's exit code
 *
 * @param ctx - Docker execution context
 * @throws DockerUnavailableError if Docker is not available
 * @throws DockerBuildError if image building fails
 * @throws DockerRunError if container execution fails
 */
export async function executeInDocker(ctx: DockerExecutionContext): Promise<never> {
  // Check if we're already inside a container
  if (isInsideContainer()) {
    console.error(
      "Warning: Docker mode requested but already inside a container. " +
        "Proceeding without re-containerization.",
    );
    // Fall through to normal execution by NOT exiting
    // This requires the caller to handle this case
    throw new Error("SKIP_DOCKER");
  }

  // Check Docker availability
  const available = await checkDockerAvailable();
  if (!available) {
    throw new DockerUnavailableError();
  }

  // Resolve Dockerfile and ensure image is built
  const dockerfile = resolveDockerfile(ctx.config);
  const imageName = ctx.config["image-name"] ?? DEFAULT_IMAGE_NAME;

  try {
    await ensureImage(imageName, dockerfile);
  } catch (error) {
    if (error instanceof DockerBuildError) {
      console.error("Docker build failed:");
      console.error(error.output);
      throw error;
    }
    throw error;
  }

  // Build docker run command
  const dockerArgs = buildDockerRunArgs(ctx, imageName);

  // Execute container
  const proc = Bun.spawn(["docker", ...dockerArgs], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;
  process.exit(exitCode);
}

/**
 * Creates a Docker execution context from config and options.
 *
 * @param config - Docker configuration
 * @param options - CLI options
 * @param argv - Original CLI arguments (without 'node' and script name)
 * @param cwd - Current working directory
 * @param profileCwdPermission - Profile-level CWD permission override
 * @returns Docker execution context
 */
export function createDockerContext(
  config: DockerConfig | undefined,
  options: DockerOptions,
  argv: string[],
  cwd: string,
  profileCwdPermission?: "ro" | "rw",
): DockerExecutionContext {
  return {
    config: config ?? {},
    options,
    forwardArgs: filterDockerArgs(argv),
    cwd,
    profileCwdPermission,
  };
}

// Re-export errors for consumers
export { DockerBuildError } from "./image-manager.js";
