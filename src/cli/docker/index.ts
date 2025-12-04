/**
 * Docker sandboxing module for llmist CLI.
 *
 * Provides secure containerized execution for agent commands,
 * preventing unrestricted filesystem and command access.
 */

// Types
export type {
  DevModeSettings,
  DockerConfig,
  DockerExecutionContext,
  DockerOptions,
  MountConfig,
  MountPermission,
} from "./types.js";

export {
  DEFAULT_IMAGE_NAME,
  DEFAULT_CWD_PERMISSION,
  DEFAULT_CONFIG_PERMISSION,
  DEV_IMAGE_NAME,
  DEV_SOURCE_MOUNT_TARGET,
  DOCKER_CONFIG_KEYS,
  FORWARDED_API_KEYS,
  VALID_MOUNT_PERMISSIONS,
} from "./types.js";

// Config validation
export { validateDockerConfig } from "./docker-config.js";

// Dockerfile handling
export {
  DEFAULT_DOCKERFILE,
  DEV_DOCKERFILE,
  resolveDockerfile,
  computeDockerfileHash,
} from "./dockerfile.js";

// Image management
export {
  ensureImage,
  needsRebuild,
  clearImageCache,
  DockerBuildError,
} from "./image-manager.js";

// Docker execution
export {
  autoDetectDevSource,
  checkDockerAvailable,
  createDockerContext,
  executeInDocker,
  filterDockerArgs,
  isInsideContainer,
  resolveDevMode,
  resolveDockerEnabled,
  DockerRunError,
  DockerUnavailableError,
} from "./docker-wrapper.js";
