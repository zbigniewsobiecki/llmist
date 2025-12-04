/**
 * Docker sandboxing type definitions.
 *
 * These types define the configuration schema for running llmist agent
 * commands inside Docker containers for security isolation.
 */

/**
 * Mount permission for Docker volume mounts.
 * - "ro": Read-only mount (safer, prevents modifications)
 * - "rw": Read-write mount (allows modifications)
 */
export type MountPermission = "ro" | "rw";

/**
 * Valid mount permissions for validation.
 */
export const VALID_MOUNT_PERMISSIONS: MountPermission[] = ["ro", "rw"];

/**
 * Configuration for an additional mount point.
 */
export interface MountConfig {
  /** Host path to mount (supports ~ for home directory) */
  source: string;
  /** Path inside the container */
  target: string;
  /** Mount permission mode */
  permission: MountPermission;
}

/**
 * Docker configuration section in cli.toml.
 *
 * @example
 * ```toml
 * [docker]
 * enabled = true
 * cwd-permission = "rw"
 * config-permission = "ro"
 * image-name = "llmist-sandbox"
 *
 * [[docker.mounts]]
 * source = "~/data"
 * target = "/data"
 * permission = "ro"
 * ```
 */
export interface DockerConfig {
  /** Enable Docker sandboxing globally (default: false) */
  enabled?: boolean;

  /** Custom Dockerfile contents (overrides default template) */
  dockerfile?: string;

  /** Permission for current working directory mount (default: "rw") */
  "cwd-permission"?: MountPermission;

  /** Permission for ~/.llmist config directory mount (default: "ro") */
  "config-permission"?: MountPermission;

  /** Additional mount points */
  mounts?: MountConfig[];

  /** Extra environment variables to forward to container */
  "env-vars"?: string[];

  /** Custom Docker image name (default: "llmist-sandbox") */
  "image-name"?: string;
}

/**
 * Valid keys for docker config validation.
 */
export const DOCKER_CONFIG_KEYS = new Set([
  "enabled",
  "dockerfile",
  "cwd-permission",
  "config-permission",
  "mounts",
  "env-vars",
  "image-name",
]);

/**
 * Docker CLI options (resolved from config and CLI flags).
 */
export interface DockerOptions {
  /** Docker mode enabled via --docker flag */
  docker: boolean;
  /** Read-only CWD mount via --docker-ro flag */
  dockerRo: boolean;
  /** Explicitly disabled via --no-docker flag */
  noDocker: boolean;
}

/**
 * Resolved Docker execution context.
 */
export interface DockerExecutionContext {
  /** Merged Docker configuration */
  config: DockerConfig;
  /** CLI options */
  options: DockerOptions;
  /** Original CLI arguments to forward (minus docker flags) */
  forwardArgs: string[];
  /** Current working directory on host */
  cwd: string;
}

/**
 * Environment variable that indicates we're running inside an unsafe/sandboxed environment.
 * Used to prevent infinite nesting when agent tries to run llmist again.
 * Named "unsafe" because the environment has restricted permissions and capabilities.
 */
export const LLMIST_UNSAFE_ENV = "LLMIST_UNSAFE_ENVIRONMENT";

/**
 * Default Docker image name.
 */
export const DEFAULT_IMAGE_NAME = "llmist-sandbox";

/**
 * Default mount permissions.
 */
export const DEFAULT_CWD_PERMISSION: MountPermission = "rw";
export const DEFAULT_CONFIG_PERMISSION: MountPermission = "ro";

/**
 * API keys that are always forwarded to the container.
 */
export const FORWARDED_API_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
] as const;
