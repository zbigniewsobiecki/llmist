import { describe, expect, it } from "bun:test";
import { ConfigError } from "../config.js";
import { validateDockerConfig } from "./docker-config.js";

describe("docker-config", () => {
  describe("validateDockerConfig", () => {
    it("should accept empty config", () => {
      const result = validateDockerConfig({}, "docker");
      expect(result).toEqual({});
    });

    it("should accept valid complete config", () => {
      const raw = {
        enabled: true,
        dockerfile: "FROM node:18",
        "cwd-permission": "rw",
        "config-permission": "ro",
        "image-name": "my-sandbox",
        "env-vars": ["GH_TOKEN", "CUSTOM_VAR"],
        "docker-args": ["-p", "3000:3000", "--memory", "4g"],
        mounts: [{ source: "~/data", target: "/data", permission: "ro" }],
      };

      const result = validateDockerConfig(raw, "docker");

      expect(result.enabled).toBe(true);
      expect(result.dockerfile).toBe("FROM node:18");
      expect(result["cwd-permission"]).toBe("rw");
      expect(result["config-permission"]).toBe("ro");
      expect(result["image-name"]).toBe("my-sandbox");
      expect(result["env-vars"]).toEqual(["GH_TOKEN", "CUSTOM_VAR"]);
      expect(result["docker-args"]).toEqual(["-p", "3000:3000", "--memory", "4g"]);
      expect(result.mounts).toHaveLength(1);
      expect(result.mounts![0]).toEqual({
        source: "~/data",
        target: "/data",
        permission: "ro",
      });
    });

    describe("enabled field", () => {
      it("should accept boolean true", () => {
        const result = validateDockerConfig({ enabled: true }, "docker");
        expect(result.enabled).toBe(true);
      });

      it("should accept boolean false", () => {
        const result = validateDockerConfig({ enabled: false }, "docker");
        expect(result.enabled).toBe(false);
      });

      it("should reject non-boolean", () => {
        expect(() => validateDockerConfig({ enabled: "true" }, "docker")).toThrow(ConfigError);
        expect(() => validateDockerConfig({ enabled: "true" }, "docker")).toThrow(
          "[docker].enabled must be a boolean",
        );
      });
    });

    describe("dockerfile field", () => {
      it("should accept string", () => {
        const result = validateDockerConfig({ dockerfile: "FROM alpine" }, "docker");
        expect(result.dockerfile).toBe("FROM alpine");
      });

      it("should reject non-string", () => {
        expect(() => validateDockerConfig({ dockerfile: 123 }, "docker")).toThrow(ConfigError);
        expect(() => validateDockerConfig({ dockerfile: 123 }, "docker")).toThrow(
          "[docker].dockerfile must be a string",
        );
      });
    });

    describe("cwd-permission field", () => {
      it("should accept 'ro'", () => {
        const result = validateDockerConfig({ "cwd-permission": "ro" }, "docker");
        expect(result["cwd-permission"]).toBe("ro");
      });

      it("should accept 'rw'", () => {
        const result = validateDockerConfig({ "cwd-permission": "rw" }, "docker");
        expect(result["cwd-permission"]).toBe("rw");
      });

      it("should reject invalid permission", () => {
        expect(() => validateDockerConfig({ "cwd-permission": "rwx" }, "docker")).toThrow(
          ConfigError,
        );
        expect(() => validateDockerConfig({ "cwd-permission": "rwx" }, "docker")).toThrow(
          "[docker].cwd-permission must be one of: ro, rw",
        );
      });
    });

    describe("config-permission field", () => {
      it("should accept valid permissions", () => {
        const result = validateDockerConfig({ "config-permission": "ro" }, "docker");
        expect(result["config-permission"]).toBe("ro");
      });

      it("should reject invalid permission", () => {
        expect(() => validateDockerConfig({ "config-permission": "invalid" }, "docker")).toThrow(
          "[docker].config-permission must be one of: ro, rw",
        );
      });
    });

    describe("image-name field", () => {
      it("should accept string", () => {
        const result = validateDockerConfig({ "image-name": "custom-image" }, "docker");
        expect(result["image-name"]).toBe("custom-image");
      });

      it("should reject non-string", () => {
        expect(() => validateDockerConfig({ "image-name": [] }, "docker")).toThrow(
          "[docker].image-name must be a string",
        );
      });
    });

    describe("env-vars field", () => {
      it("should accept array of strings", () => {
        const result = validateDockerConfig({ "env-vars": ["VAR1", "VAR2"] }, "docker");
        expect(result["env-vars"]).toEqual(["VAR1", "VAR2"]);
      });

      it("should accept empty array", () => {
        const result = validateDockerConfig({ "env-vars": [] }, "docker");
        expect(result["env-vars"]).toEqual([]);
      });

      it("should reject non-array", () => {
        expect(() => validateDockerConfig({ "env-vars": "VAR1" }, "docker")).toThrow(
          "[docker].env-vars must be an array",
        );
      });

      it("should reject array with non-strings", () => {
        expect(() => validateDockerConfig({ "env-vars": ["VAR1", 123] }, "docker")).toThrow(
          "[docker].env-vars[1] must be a string",
        );
      });
    });

    describe("docker-args field", () => {
      it("should accept array of strings", () => {
        const result = validateDockerConfig(
          { "docker-args": ["-p", "3000:3000", "--network", "host"] },
          "docker",
        );
        expect(result["docker-args"]).toEqual(["-p", "3000:3000", "--network", "host"]);
      });

      it("should accept empty array", () => {
        const result = validateDockerConfig({ "docker-args": [] }, "docker");
        expect(result["docker-args"]).toEqual([]);
      });

      it("should accept single argument", () => {
        const result = validateDockerConfig({ "docker-args": ["--privileged"] }, "docker");
        expect(result["docker-args"]).toEqual(["--privileged"]);
      });

      it("should reject non-array", () => {
        expect(() => validateDockerConfig({ "docker-args": "-p 3000:3000" }, "docker")).toThrow(
          "[docker].docker-args must be an array",
        );
      });

      it("should reject array with non-strings", () => {
        expect(() => validateDockerConfig({ "docker-args": ["-p", 3000] }, "docker")).toThrow(
          "[docker].docker-args[1] must be a string",
        );
      });

      it("should reject array with null values", () => {
        expect(() => validateDockerConfig({ "docker-args": ["-p", null] }, "docker")).toThrow(
          "[docker].docker-args[1] must be a string",
        );
      });
    });

    describe("mounts field", () => {
      it("should accept valid mounts array", () => {
        const mounts = [
          { source: "/host/path1", target: "/container/path1", permission: "ro" },
          { source: "~/data", target: "/data", permission: "rw" },
        ];
        const result = validateDockerConfig({ mounts }, "docker");
        expect(result.mounts).toHaveLength(2);
        expect(result.mounts![0]).toEqual({
          source: "/host/path1",
          target: "/container/path1",
          permission: "ro",
        });
      });

      it("should accept empty mounts array", () => {
        const result = validateDockerConfig({ mounts: [] }, "docker");
        expect(result.mounts).toEqual([]);
      });

      it("should reject non-array mounts", () => {
        expect(() => validateDockerConfig({ mounts: {} }, "docker")).toThrow(
          "[docker].mounts must be an array of tables",
        );
      });

      it("should reject mount without source", () => {
        const mounts = [{ target: "/data", permission: "ro" }];
        expect(() => validateDockerConfig({ mounts }, "docker")).toThrow(
          "missing required field 'source'",
        );
      });

      it("should reject mount without target", () => {
        const mounts = [{ source: "/data", permission: "ro" }];
        expect(() => validateDockerConfig({ mounts }, "docker")).toThrow(
          "missing required field 'target'",
        );
      });

      it("should reject mount without permission", () => {
        const mounts = [{ source: "/data", target: "/data" }];
        expect(() => validateDockerConfig({ mounts }, "docker")).toThrow(
          "missing required field 'permission'",
        );
      });

      it("should reject mount with invalid permission", () => {
        const mounts = [{ source: "/data", target: "/data", permission: "invalid" }];
        expect(() => validateDockerConfig({ mounts }, "docker")).toThrow("must be one of: ro, rw");
      });

      it("should reject mount with unknown keys", () => {
        const mounts = [{ source: "/data", target: "/data", permission: "ro", extra: true }];
        expect(() => validateDockerConfig({ mounts }, "docker")).toThrow(
          "extra is not a valid mount option",
        );
      });

      it("should reject non-object mount entry", () => {
        const mounts = ["invalid"];
        expect(() => validateDockerConfig({ mounts }, "docker")).toThrow(
          "[docker].mounts[0] must be a table",
        );
      });
    });

    describe("unknown keys", () => {
      it("should reject unknown config keys", () => {
        expect(() => validateDockerConfig({ unknown: true }, "docker")).toThrow(ConfigError);
        expect(() => validateDockerConfig({ unknown: true }, "docker")).toThrow(
          "[docker].unknown is not a valid option",
        );
      });
    });

    describe("invalid raw input", () => {
      it("should reject null", () => {
        expect(() => validateDockerConfig(null, "docker")).toThrow("[docker] must be a table");
      });

      it("should reject non-object", () => {
        expect(() => validateDockerConfig("string", "docker")).toThrow("[docker] must be a table");
      });

      // Note: Arrays are technically objects in JS, so [] passes the typeof check.
      // The validation doesn't currently reject empty arrays - they're treated as
      // objects with no keys, which is valid. This matches TOML parsing behavior
      // where an empty section is valid.
      it("should treat empty array as empty config (no keys)", () => {
        const result = validateDockerConfig([], "docker");
        expect(result).toEqual({});
      });
    });

    describe("section name in error messages", () => {
      it("should use custom section name", () => {
        expect(() => validateDockerConfig({ unknown: true }, "custom-section")).toThrow(
          "[custom-section].unknown is not a valid option",
        );
      });
    });
  });
});
