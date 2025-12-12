/**
 * Docker configuration validation.
 *
 * Follows the same validation patterns as the main config.ts module.
 */

import { ConfigError } from "../config.js";
import {
  DOCKER_CONFIG_KEYS,
  type DockerConfig,
  type MountConfig,
  type MountPermission,
  VALID_MOUNT_PERMISSIONS,
} from "./types.js";

/**
 * Valid keys for mount config objects.
 */
const MOUNT_CONFIG_KEYS = new Set(["source", "target", "permission"]);

/**
 * Validates that a value is a string.
 */
function validateString(value: unknown, key: string, section: string): string {
  if (typeof value !== "string") {
    throw new ConfigError(`[${section}].${key} must be a string`);
  }
  return value;
}

/**
 * Validates that a value is a boolean.
 */
function validateBoolean(value: unknown, key: string, section: string): boolean {
  if (typeof value !== "boolean") {
    throw new ConfigError(`[${section}].${key} must be a boolean`);
  }
  return value;
}

/**
 * Validates that a value is an array of strings.
 */
function validateStringArray(value: unknown, key: string, section: string): string[] {
  if (!Array.isArray(value)) {
    throw new ConfigError(`[${section}].${key} must be an array`);
  }
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== "string") {
      throw new ConfigError(`[${section}].${key}[${i}] must be a string`);
    }
  }
  return value as string[];
}

/**
 * Validates a mount permission value.
 */
function validateMountPermission(value: unknown, key: string, section: string): MountPermission {
  const str = validateString(value, key, section);
  if (!VALID_MOUNT_PERMISSIONS.includes(str as MountPermission)) {
    throw new ConfigError(
      `[${section}].${key} must be one of: ${VALID_MOUNT_PERMISSIONS.join(", ")}`,
    );
  }
  return str as MountPermission;
}

/**
 * Validates a single mount configuration object.
 */
function validateMountConfig(value: unknown, index: number, section: string): MountConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConfigError(`[${section}].mounts[${index}] must be a table`);
  }

  const rawObj = value as Record<string, unknown>;
  const mountSection = `${section}.mounts[${index}]`;

  // Check for unknown keys
  for (const key of Object.keys(rawObj)) {
    if (!MOUNT_CONFIG_KEYS.has(key)) {
      throw new ConfigError(`[${mountSection}].${key} is not a valid mount option`);
    }
  }

  // Required fields
  if (!("source" in rawObj)) {
    throw new ConfigError(`[${mountSection}] missing required field 'source'`);
  }
  if (!("target" in rawObj)) {
    throw new ConfigError(`[${mountSection}] missing required field 'target'`);
  }
  if (!("permission" in rawObj)) {
    throw new ConfigError(`[${mountSection}] missing required field 'permission'`);
  }

  return {
    source: validateString(rawObj.source, "source", mountSection),
    target: validateString(rawObj.target, "target", mountSection),
    permission: validateMountPermission(rawObj.permission, "permission", mountSection),
  };
}

/**
 * Validates an array of mount configurations.
 */
function validateMountsArray(value: unknown, section: string): MountConfig[] {
  if (!Array.isArray(value)) {
    throw new ConfigError(`[${section}].mounts must be an array of tables`);
  }

  const result: MountConfig[] = [];
  for (let i = 0; i < value.length; i++) {
    result.push(validateMountConfig(value[i], i, section));
  }
  return result;
}

/**
 * Validates the docker configuration section.
 *
 * @param raw - Raw config object from TOML parser
 * @param section - Section name for error messages (usually "docker")
 * @returns Validated DockerConfig
 * @throws ConfigError if validation fails
 */
export function validateDockerConfig(raw: unknown, section: string): DockerConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new ConfigError(`[${section}] must be a table`);
  }

  const rawObj = raw as Record<string, unknown>;

  // Check for unknown keys
  for (const key of Object.keys(rawObj)) {
    if (!DOCKER_CONFIG_KEYS.has(key)) {
      throw new ConfigError(`[${section}].${key} is not a valid option`);
    }
  }

  const result: DockerConfig = {};

  if ("enabled" in rawObj) {
    result.enabled = validateBoolean(rawObj.enabled, "enabled", section);
  }

  if ("dockerfile" in rawObj) {
    result.dockerfile = validateString(rawObj.dockerfile, "dockerfile", section);
  }

  if ("cwd-permission" in rawObj) {
    result["cwd-permission"] = validateMountPermission(
      rawObj["cwd-permission"],
      "cwd-permission",
      section,
    );
  }

  if ("config-permission" in rawObj) {
    result["config-permission"] = validateMountPermission(
      rawObj["config-permission"],
      "config-permission",
      section,
    );
  }

  if ("mounts" in rawObj) {
    result.mounts = validateMountsArray(rawObj.mounts, section);
  }

  if ("env-vars" in rawObj) {
    result["env-vars"] = validateStringArray(rawObj["env-vars"], "env-vars", section);
  }

  if ("image-name" in rawObj) {
    result["image-name"] = validateString(rawObj["image-name"], "image-name", section);
  }

  if ("dev-mode" in rawObj) {
    result["dev-mode"] = validateBoolean(rawObj["dev-mode"], "dev-mode", section);
  }

  if ("dev-source" in rawObj) {
    result["dev-source"] = validateString(rawObj["dev-source"], "dev-source", section);
  }

  // Note: docker-args is intentionally only configurable in the global ~/.llmist/cli.toml.
  // Since llmist only loads config from the user's home directory (not project-level configs),
  // this is inherently safe from supply-chain attacks where a malicious project could inject
  // dangerous Docker arguments like "--privileged" or "-v /:/host".
  if ("docker-args" in rawObj) {
    result["docker-args"] = validateStringArray(rawObj["docker-args"], "docker-args", section);
  }

  return result;
}
