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

  /** Enable dev mode - mount local source instead of npm install */
  "dev-mode"?: boolean;

  /** Path to llmist source for dev mode (supports ~ for home directory) */
  "dev-source"?: string;

  /** Extra arguments to pass to docker run (e.g., ["-p", "3000:3000"]) */
  "docker-args"?: string[];
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
  "dev-mode",
  "dev-source",
  "docker-args",
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
  /** Dev mode - mount local source instead of npm install */
  dockerDev: boolean;
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
  /** Profile-level CWD permission override (takes precedence over config) */
  profileCwdPermission?: MountPermission;
}

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

/**
 * Dev mode Docker image name (separate from production).
 */
export const DEV_IMAGE_NAME = "llmist-dev-sandbox";

/**
 * Mount target for llmist source in dev mode.
 */
export const DEV_SOURCE_MOUNT_TARGET = "/llmist-src";

/**
 * Resolved dev mode settings.
 */
export interface DevModeSettings {
  /** Whether dev mode is enabled */
  enabled: boolean;
  /** Path to llmist source directory (undefined if not enabled) */
  sourcePath: string | undefined;
}
