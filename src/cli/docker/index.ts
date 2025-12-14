/**
 * Docker sandboxing module for llmist CLI.
 *
 * Provides secure containerized execution for agent commands,
 * preventing unrestricted filesystem and command access.
 */

// Config validation
export { validateDockerConfig } from "./docker-config.js";
// Docker execution
export {
  checkDockerAvailable,
  createDockerContext,
  DockerRunError,
  DockerSkipError,
  DockerUnavailableError,
  executeInDocker,
  filterDockerArgs,
  isInsideContainer,
  resolveDockerEnabled,
} from "./docker-wrapper.js";
// Dockerfile handling
export {
  computeDockerfileHash,
  DEFAULT_DOCKERFILE,
  resolveDockerfile,
} from "./dockerfile.js";
// Image management
export {
  clearImageCache,
  DockerBuildError,
  ensureImage,
  needsRebuild,
} from "./image-manager.js";
// Types
export type {
  DockerConfig,
  DockerExecutionContext,
  DockerOptions,
  MountConfig,
  MountPermission,
} from "./types.js";
export {
  DEFAULT_CONFIG_PERMISSION,
  DEFAULT_CWD_PERMISSION,
  DEFAULT_IMAGE_NAME,
  DOCKER_CONFIG_KEYS,
  FORWARDED_API_KEYS,
  GADGET_CACHE_VOLUME,
  VALID_MOUNT_PERMISSIONS,
} from "./types.js";
