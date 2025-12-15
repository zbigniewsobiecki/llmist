import { describe, expect, it } from "bun:test";
import {
  createDockerContext,
  DockerRunError,
  DockerUnavailableError,
  filterDockerArgs,
  resolveDockerEnabled,
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

    it("should remove multiple docker flags", () => {
      const args = ["--docker", "--docker-ro", "agent", "--no-docker", "prompt"];
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

  describe("createDockerContext", () => {
    const defaultOptions: DockerOptions = {
      docker: true,
      dockerRo: false,
      noDocker: false,
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

    it("should preserve docker-args in config", () => {
      const config: DockerConfig = {
        enabled: true,
        "docker-args": ["-p", "3000:3000", "--network", "host"],
      };
      const ctx = createDockerContext(config, defaultOptions, ["agent"], "/work");
      expect(ctx.config["docker-args"]).toEqual(["-p", "3000:3000", "--network", "host"]);
    });

    it("should handle empty docker-args array", () => {
      const config: DockerConfig = {
        enabled: true,
        "docker-args": [],
      };
      const ctx = createDockerContext(config, defaultOptions, ["agent"], "/work");
      expect(ctx.config["docker-args"]).toEqual([]);
    });

    it("should handle undefined docker-args", () => {
      const config: DockerConfig = { enabled: true };
      const ctx = createDockerContext(config, defaultOptions, ["agent"], "/work");
      expect(ctx.config["docker-args"]).toBeUndefined();
    });
  });
});
