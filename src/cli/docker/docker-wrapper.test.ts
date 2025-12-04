import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import {
  filterDockerArgs,
  resolveDockerEnabled,
  resolveDevMode,
  createDockerContext,
  DockerUnavailableError,
  DockerRunError,
} from "./docker-wrapper.js";
import type { DockerConfig, DockerOptions } from "./types.js";

describe("docker-wrapper", () => {
  describe("DockerUnavailableError", () => {
    it("should have correct name", () => {
      const error = new DockerUnavailableError();
      expect(error.name).toBe("DockerUnavailableError");
    });

    it("should have descriptive message", () => {
      const error = new DockerUnavailableError();
      expect(error.message).toContain("Docker is required but not available");
    });
  });

  describe("DockerRunError", () => {
    it("should have correct name", () => {
      const error = new DockerRunError(1, "some error");
      expect(error.name).toBe("DockerRunError");
    });

    it("should include exit code in message", () => {
      const error = new DockerRunError(127, "command not found");
      expect(error.message).toContain("127");
    });

    it("should store exit code and stderr", () => {
      const error = new DockerRunError(1, "error output");
      expect(error.exitCode).toBe(1);
      expect(error.stderr).toBe("error output");
    });
  });

  describe("filterDockerArgs", () => {
    it("should remove --docker flag", () => {
      const args = ["agent", "--docker", "tell me a joke"];
      const result = filterDockerArgs(args);
      expect(result).toEqual(["agent", "tell me a joke"]);
    });

    it("should remove --docker-ro flag", () => {
      const args = ["agent", "--docker-ro", "prompt"];
      const result = filterDockerArgs(args);
      expect(result).toEqual(["agent", "prompt"]);
    });

    it("should remove --no-docker flag", () => {
      const args = ["--no-docker", "agent", "prompt"];
      const result = filterDockerArgs(args);
      expect(result).toEqual(["agent", "prompt"]);
    });

    it("should remove --docker-dev flag", () => {
      const args = ["agent", "--docker-dev", "prompt"];
      const result = filterDockerArgs(args);
      expect(result).toEqual(["agent", "prompt"]);
    });

    it("should remove multiple docker flags", () => {
      const args = ["--docker", "--docker-ro", "agent", "--docker-dev", "prompt"];
      const result = filterDockerArgs(args);
      expect(result).toEqual(["agent", "prompt"]);
    });

    it("should preserve non-docker flags", () => {
      const args = ["agent", "--model", "gpt-4", "--system", "Be helpful", "prompt"];
      const result = filterDockerArgs(args);
      expect(result).toEqual(["agent", "--model", "gpt-4", "--system", "Be helpful", "prompt"]);
    });

    it("should handle empty array", () => {
      const result = filterDockerArgs([]);
      expect(result).toEqual([]);
    });

    it("should handle array with no docker flags", () => {
      const args = ["agent", "prompt"];
      const result = filterDockerArgs(args);
      expect(result).toEqual(["agent", "prompt"]);
    });
  });

  describe("resolveDockerEnabled", () => {
    const defaultOptions: DockerOptions = {
      docker: false,
      dockerRo: false,
      noDocker: false,
      dockerDev: false,
    };

    it("should return false when no config and no options", () => {
      const result = resolveDockerEnabled(undefined, defaultOptions);
      expect(result).toBe(false);
    });

    it("should return true when config.enabled is true", () => {
      const config: DockerConfig = { enabled: true };
      const result = resolveDockerEnabled(config, defaultOptions);
      expect(result).toBe(true);
    });

    it("should return false when config.enabled is false", () => {
      const config: DockerConfig = { enabled: false };
      const result = resolveDockerEnabled(config, defaultOptions);
      expect(result).toBe(false);
    });

    it("should return true when --docker flag is set", () => {
      const options: DockerOptions = { ...defaultOptions, docker: true };
      const result = resolveDockerEnabled(undefined, options);
      expect(result).toBe(true);
    });

    it("should return true when --docker-ro flag is set", () => {
      const options: DockerOptions = { ...defaultOptions, dockerRo: true };
      const result = resolveDockerEnabled(undefined, options);
      expect(result).toBe(true);
    });

    it("should return false when --no-docker flag overrides config", () => {
      const config: DockerConfig = { enabled: true };
      const options: DockerOptions = { ...defaultOptions, noDocker: true };
      const result = resolveDockerEnabled(config, options);
      expect(result).toBe(false);
    });

    it("should return false when --no-docker overrides --docker", () => {
      const options: DockerOptions = { ...defaultOptions, docker: true, noDocker: true };
      const result = resolveDockerEnabled(undefined, options);
      expect(result).toBe(false);
    });

    it("should use profile docker setting over config.enabled", () => {
      const config: DockerConfig = { enabled: false };
      const result = resolveDockerEnabled(config, defaultOptions, true);
      expect(result).toBe(true);
    });

    it("should use CLI flags over profile setting", () => {
      const options: DockerOptions = { ...defaultOptions, noDocker: true };
      const result = resolveDockerEnabled(undefined, options, true);
      expect(result).toBe(false);
    });

    it("should return profile=false over config.enabled=true", () => {
      const config: DockerConfig = { enabled: true };
      const result = resolveDockerEnabled(config, defaultOptions, false);
      expect(result).toBe(false);
    });
  });

  describe("resolveDevMode", () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      // Clean up dev mode env vars
      delete process.env.LLMIST_DEV_MODE;
      delete process.env.LLMIST_DEV_SOURCE;
    });

    afterEach(() => {
      // Restore original env
      process.env = { ...originalEnv };
    });

    it("should return disabled when CLI flag is false and config has no dev-mode", () => {
      const result = resolveDevMode({}, false);
      expect(result.enabled).toBe(false);
      expect(result.sourcePath).toBeUndefined();
    });

    it("should enable via CLI flag with config source", () => {
      const config: DockerConfig = { "dev-source": "/path/to/source" };
      const result = resolveDevMode(config, true);
      expect(result.enabled).toBe(true);
      expect(result.sourcePath).toBe("/path/to/source");
    });

    it("should enable via config dev-mode with config source", () => {
      const config: DockerConfig = { "dev-mode": true, "dev-source": "/my/source" };
      const result = resolveDevMode(config, false);
      expect(result.enabled).toBe(true);
      expect(result.sourcePath).toBe("/my/source");
    });

    it("should enable via LLMIST_DEV_MODE env var", () => {
      process.env.LLMIST_DEV_MODE = "1";
      process.env.LLMIST_DEV_SOURCE = "/env/source";
      const result = resolveDevMode({}, false);
      expect(result.enabled).toBe(true);
      expect(result.sourcePath).toBe("/env/source");
    });

    it("should prioritize config source over env var", () => {
      process.env.LLMIST_DEV_SOURCE = "/env/source";
      const config: DockerConfig = { "dev-source": "/config/source" };
      const result = resolveDevMode(config, true);
      expect(result.sourcePath).toBe("/config/source");
    });

    it("should throw when dev mode enabled but no source available", () => {
      expect(() => resolveDevMode({}, true)).toThrow("llmist source path not found");
    });

    it("should not enable with LLMIST_DEV_MODE=0", () => {
      process.env.LLMIST_DEV_MODE = "0";
      const result = resolveDevMode({}, false);
      expect(result.enabled).toBe(false);
    });
  });

  describe("createDockerContext", () => {
    const defaultOptions: DockerOptions = {
      docker: true,
      dockerRo: false,
      noDocker: false,
      dockerDev: false,
    };

    it("should create context with provided config", () => {
      const config: DockerConfig = { enabled: true, "cwd-permission": "ro" };
      const ctx = createDockerContext(config, defaultOptions, ["agent", "prompt"], "/work");
      expect(ctx.config).toEqual(config);
    });

    it("should use empty config when undefined", () => {
      const ctx = createDockerContext(undefined, defaultOptions, ["arg"], "/work");
      expect(ctx.config).toEqual({});
    });

    it("should filter docker flags from forwardArgs", () => {
      const args = ["agent", "--docker", "--model", "gpt-4", "prompt"];
      const ctx = createDockerContext({}, defaultOptions, args, "/work");
      expect(ctx.forwardArgs).toEqual(["agent", "--model", "gpt-4", "prompt"]);
    });

    it("should store cwd", () => {
      const ctx = createDockerContext({}, defaultOptions, [], "/my/project");
      expect(ctx.cwd).toBe("/my/project");
    });

    it("should store options", () => {
      const options: DockerOptions = { ...defaultOptions, dockerRo: true };
      const ctx = createDockerContext({}, options, [], "/work");
      expect(ctx.options).toEqual(options);
    });

    it("should store profileCwdPermission when provided", () => {
      const ctx = createDockerContext({}, defaultOptions, [], "/work", "ro");
      expect(ctx.profileCwdPermission).toBe("ro");
    });

    it("should leave profileCwdPermission undefined when not provided", () => {
      const ctx = createDockerContext({}, defaultOptions, [], "/work");
      expect(ctx.profileCwdPermission).toBeUndefined();
    });
  });
});
