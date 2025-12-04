/**
 * Docker execution wrapper.
 *
 * Handles:
 * - Checking if Docker is available
 * - Building/caching the Docker image
 * - Running llmist inside the container
 * - Forwarding environment variables and mounts
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { resolveDockerfile } from "./dockerfile.js";
import { ensureImage, DockerBuildError } from "./image-manager.js";
import {
  type DevModeSettings,
  type DockerConfig,
  type DockerExecutionContext,
  type DockerOptions,
  type MountPermission,
  DEFAULT_IMAGE_NAME,
  DEFAULT_CWD_PERMISSION,
  DEFAULT_CONFIG_PERMISSION,
  DEV_IMAGE_NAME,
  DEV_SOURCE_MOUNT_TARGET,
  FORWARDED_API_KEYS,
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
 * Error thrown when Docker execution should be skipped.
 * This occurs when already running inside a container.
 */
export class DockerSkipError extends Error {
  constructor() {
    super("Docker execution skipped - already inside container");
    this.name = "DockerSkipError";
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
 * Detection methods:
 * 1. /.dockerenv file - Docker creates this in all containers
 * 2. /proc/1/cgroup contains "docker" or "containerd" - Linux cgroup detection
 *
 * @returns true if running inside a container
 */
export function isInsideContainer(): boolean {
  // Method 1: Check for /.dockerenv (most reliable)
  if (existsSync("/.dockerenv")) {
    return true;
  }

  // Method 2: Check cgroup for docker/containerd (Linux)
  try {
    const cgroup = readFileSync("/proc/1/cgroup", "utf-8");
    if (cgroup.includes("docker") || cgroup.includes("containerd")) {
      return true;
    }
  } catch {
    // Not on Linux or no access to /proc
  }

  return false;
}

/**
 * Attempts to auto-detect the llmist source directory.
 *
 * Checks if the current script is being run from an llmist source tree
 * by examining the script path and verifying package.json.
 *
 * @returns Path to llmist source directory, or undefined if not detectable
 */
export function autoDetectDevSource(): string | undefined {
  // Check if running from source via bun (e.g., `bun src/cli.ts`)
  const scriptPath = process.argv[1];
  if (!scriptPath || !scriptPath.endsWith("src/cli.ts")) {
    return undefined;
  }

  const srcDir = dirname(scriptPath);
  const projectDir = dirname(srcDir);

  // Verify it's the llmist project by checking package.json
  const packageJsonPath = join(projectDir, "package.json");
  if (!existsSync(packageJsonPath)) {
    return undefined;
  }

  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    if (pkg.name === "llmist") {
      return projectDir;
    }
  } catch {
    // Ignore parse errors
  }

  return undefined;
}

/**
 * Resolves dev mode settings.
 *
 * Priority for enablement:
 * 1. CLI --docker-dev flag
 * 2. Config [docker].dev-mode
 * 3. LLMIST_DEV_MODE environment variable
 *
 * Priority for source path:
 * 1. Config [docker].dev-source
 * 2. LLMIST_DEV_SOURCE environment variable
 * 3. Auto-detect from script path
 *
 * @param config - Docker configuration
 * @param cliDevMode - Whether --docker-dev flag was used
 * @returns Resolved dev mode settings
 * @throws Error if dev mode is enabled but source path cannot be found
 */
export function resolveDevMode(
  config: DockerConfig | undefined,
  cliDevMode: boolean,
): DevModeSettings {
  // Check if dev mode is enabled
  const enabled = cliDevMode || config?.["dev-mode"] || process.env.LLMIST_DEV_MODE === "1";

  if (!enabled) {
    return { enabled: false, sourcePath: undefined };
  }

  // Resolve source path
  const sourcePath =
    config?.["dev-source"] || process.env.LLMIST_DEV_SOURCE || autoDetectDevSource();

  if (!sourcePath) {
    throw new Error(
      "Docker dev mode enabled but llmist source path not found. " +
        "Set [docker].dev-source in config, LLMIST_DEV_SOURCE env var, " +
        "or run from the llmist source directory (bun src/cli.ts).",
    );
  }

  return { enabled: true, sourcePath };
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
 * @param devMode - Dev mode settings (for source mounting)
 * @returns Array of arguments for docker run
 */
function buildDockerRunArgs(
  ctx: DockerExecutionContext,
  imageName: string,
  devMode: DevModeSettings,
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

  // Mount llmist source in dev mode (read-only to prevent accidental modifications)
  if (devMode.enabled && devMode.sourcePath) {
    const expandedSource = expandHome(devMode.sourcePath);
    args.push("-v", `${expandedSource}:${DEV_SOURCE_MOUNT_TARGET}:ro`);
  }

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
  const dockerFlags = new Set(["--docker", "--docker-ro", "--no-docker", "--docker-dev"]);
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
 * 3. Builds/caches the image (dev or production)
 * 4. Runs the container with appropriate mounts and env vars
 * 5. Exits with the container's exit code
 *
 * @param ctx - Docker execution context
 * @param devMode - Dev mode settings
 * @throws DockerUnavailableError if Docker is not available
 * @throws DockerBuildError if image building fails
 * @throws DockerRunError if container execution fails
 */
export async function executeInDocker(
  ctx: DockerExecutionContext,
  devMode: DevModeSettings,
): Promise<never> {
  // Check if we're already inside a container
  if (isInsideContainer()) {
    console.error(
      "Warning: Docker mode requested but already inside a container. " +
        "Proceeding without re-containerization.",
    );
    // Signal to caller that Docker should be skipped
    throw new DockerSkipError();
  }

  // Check Docker availability
  const available = await checkDockerAvailable();
  if (!available) {
    throw new DockerUnavailableError();
  }

  // Resolve Dockerfile and image name based on dev mode
  const dockerfile = resolveDockerfile(ctx.config, devMode.enabled);
  const imageName = devMode.enabled
    ? DEV_IMAGE_NAME
    : (ctx.config["image-name"] ?? DEFAULT_IMAGE_NAME);

  // Show dev mode feedback
  if (devMode.enabled) {
    console.error(`[dev mode] Mounting source from ${devMode.sourcePath}`);
  }

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
  const dockerArgs = buildDockerRunArgs(ctx, imageName, devMode);

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
