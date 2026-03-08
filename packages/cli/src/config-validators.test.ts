import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  ConfigError,
  validateAgentConfig,
  validateBaseConfig,
  validateBoolean,
  validateCompleteConfig,
  validateCustomConfig,
  validateGadgetApproval,
  validateGlobalConfig,
  validateGlobalSubagentConfig,
  validateImageConfig,
  validateInherits,
  validateInitialGadgets,
  validateLoggingConfig,
  validateNumber,
  validatePathString,
  validatePromptsConfig,
  validateRateLimitsConfig,
  validateReasoningConfig,
  validateRetryConfig,
  validateSingleSubagentConfig,
  validateSpeechConfig,
  validateString,
  validateStringArray,
  validateSubagentConfigMap,
  validateTable,
} from "./config-validators.js";

describe("config-validators", () => {
  // ─────────────────────────────────────────────────────────────────────────────
  // ConfigError
  // ─────────────────────────────────────────────────────────────────────────────

  describe("ConfigError", () => {
    it("should create error with message only (no path)", () => {
      const err = new ConfigError("something went wrong");
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(ConfigError);
      expect(err.name).toBe("ConfigError");
      expect(err.message).toBe("something went wrong");
      expect(err.path).toBeUndefined();
    });

    it("should create error with path prepended", () => {
      const err = new ConfigError("must be a string", "/path/to/config.toml");
      expect(err.name).toBe("ConfigError");
      expect(err.message).toBe("/path/to/config.toml: must be a string");
      expect(err.path).toBe("/path/to/config.toml");
    });

    it("should create error with empty path as falsy (no prefix)", () => {
      const err = new ConfigError("bare message", "");
      // empty string is falsy; constructor uses `path ?` so no prefix
      expect(err.message).toBe("bare message");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Primitive validators
  // ─────────────────────────────────────────────────────────────────────────────

  describe("validateString", () => {
    it("should return string value unchanged", () => {
      expect(validateString("hello", "field", "section")).toBe("hello");
    });

    it("should return empty string", () => {
      expect(validateString("", "field", "section")).toBe("");
    });

    it("should throw ConfigError when value is a number", () => {
      expect(() => validateString(42, "key", "sect")).toThrow(ConfigError);
      expect(() => validateString(42, "key", "sect")).toThrow("[sect].key must be a string");
    });

    it("should throw ConfigError when value is boolean", () => {
      expect(() => validateString(true, "k", "s")).toThrow(ConfigError);
      expect(() => validateString(true, "k", "s")).toThrow("[s].k must be a string");
    });

    it("should throw ConfigError when value is null", () => {
      expect(() => validateString(null, "k", "s")).toThrow(ConfigError);
    });

    it("should throw ConfigError when value is undefined", () => {
      expect(() => validateString(undefined, "k", "s")).toThrow(ConfigError);
    });

    it("should throw ConfigError when value is an object", () => {
      expect(() => validateString({}, "k", "s")).toThrow(ConfigError);
    });

    it("should throw ConfigError when value is an array", () => {
      expect(() => validateString([], "k", "s")).toThrow(ConfigError);
    });

    it("should include key and section in error message", () => {
      expect(() => validateString(99, "my-key", "my-section")).toThrow(
        "[my-section].my-key must be a string",
      );
    });
  });

  describe("validatePathString", () => {
    it("should return non-tilde paths unchanged", () => {
      expect(validatePathString("/absolute/path", "output", "s")).toBe("/absolute/path");
      expect(validatePathString("./relative", "output", "s")).toBe("./relative");
    });

    it("should expand tilde to home directory", () => {
      const result = validatePathString("~/config/file.toml", "output", "s");
      expect(result).toBe(`${homedir()}/config/file.toml`);
    });

    it("should throw ConfigError when value is not a string", () => {
      expect(() => validatePathString(123, "output", "s")).toThrow(ConfigError);
      expect(() => validatePathString(123, "output", "s")).toThrow("[s].output must be a string");
    });
  });

  describe("validateNumber", () => {
    it("should return number value unchanged", () => {
      expect(validateNumber(42, "k", "s")).toBe(42);
    });

    it("should return 0", () => {
      expect(validateNumber(0, "k", "s")).toBe(0);
    });

    it("should return negative numbers when no min constraint", () => {
      expect(validateNumber(-5, "k", "s")).toBe(-5);
    });

    it("should return float", () => {
      expect(validateNumber(3.14, "k", "s")).toBe(3.14);
    });

    it("should throw ConfigError when value is a string", () => {
      expect(() => validateNumber("42", "k", "s")).toThrow(ConfigError);
      expect(() => validateNumber("42", "k", "s")).toThrow("[s].k must be a number");
    });

    it("should throw ConfigError when value is boolean", () => {
      expect(() => validateNumber(true, "k", "s")).toThrow(ConfigError);
    });

    it("should throw ConfigError when value is null", () => {
      expect(() => validateNumber(null, "k", "s")).toThrow(ConfigError);
    });

    it("should throw when integer option is true and value is a float", () => {
      expect(() => validateNumber(1.5, "k", "s", { integer: true })).toThrow(ConfigError);
      expect(() => validateNumber(1.5, "k", "s", { integer: true })).toThrow(
        "[s].k must be an integer",
      );
    });

    it("should accept integer when integer option is true", () => {
      expect(validateNumber(5, "k", "s", { integer: true })).toBe(5);
    });

    it("should throw when value is below min", () => {
      expect(() => validateNumber(0, "k", "s", { min: 1 })).toThrow(ConfigError);
      expect(() => validateNumber(0, "k", "s", { min: 1 })).toThrow("[s].k must be >= 1");
    });

    it("should accept value equal to min", () => {
      expect(validateNumber(1, "k", "s", { min: 1 })).toBe(1);
    });

    it("should throw when value exceeds max", () => {
      expect(() => validateNumber(3, "k", "s", { max: 2 })).toThrow(ConfigError);
      expect(() => validateNumber(3, "k", "s", { max: 2 })).toThrow("[s].k must be <= 2");
    });

    it("should accept value equal to max", () => {
      expect(validateNumber(2, "k", "s", { max: 2 })).toBe(2);
    });

    it("should enforce both min and max", () => {
      expect(validateNumber(1, "k", "s", { min: 0, max: 2 })).toBe(1);
      expect(() => validateNumber(-1, "k", "s", { min: 0, max: 2 })).toThrow("must be >= 0");
      expect(() => validateNumber(3, "k", "s", { min: 0, max: 2 })).toThrow("must be <= 2");
    });

    it("should enforce integer, min, and max together", () => {
      expect(validateNumber(5, "k", "s", { integer: true, min: 1, max: 10 })).toBe(5);
      expect(() => validateNumber(0, "k", "s", { integer: true, min: 1, max: 10 })).toThrow(
        "must be >= 1",
      );
      expect(() => validateNumber(11, "k", "s", { integer: true, min: 1, max: 10 })).toThrow(
        "must be <= 10",
      );
    });
  });

  describe("validateBoolean", () => {
    it("should return true unchanged", () => {
      expect(validateBoolean(true, "k", "s")).toBe(true);
    });

    it("should return false unchanged", () => {
      expect(validateBoolean(false, "k", "s")).toBe(false);
    });

    it("should throw ConfigError when value is a string 'true'", () => {
      expect(() => validateBoolean("true", "k", "s")).toThrow(ConfigError);
      expect(() => validateBoolean("true", "k", "s")).toThrow("[s].k must be a boolean");
    });

    it("should throw ConfigError when value is number 1", () => {
      expect(() => validateBoolean(1, "enabled", "s")).toThrow(ConfigError);
    });

    it("should throw ConfigError when value is null", () => {
      expect(() => validateBoolean(null, "k", "s")).toThrow(ConfigError);
    });

    it("should throw ConfigError when value is undefined", () => {
      expect(() => validateBoolean(undefined, "k", "s")).toThrow(ConfigError);
    });

    it("should include key and section in error message", () => {
      expect(() => validateBoolean("yes", "enabled", "agent")).toThrow(
        "[agent].enabled must be a boolean",
      );
    });
  });

  describe("validateStringArray", () => {
    it("should return string array unchanged", () => {
      expect(validateStringArray(["a", "b", "c"], "k", "s")).toEqual(["a", "b", "c"]);
    });

    it("should return empty array", () => {
      expect(validateStringArray([], "k", "s")).toEqual([]);
    });

    it("should throw ConfigError when value is a string (not array)", () => {
      expect(() => validateStringArray("not-array", "k", "s")).toThrow(ConfigError);
      expect(() => validateStringArray("not-array", "k", "s")).toThrow("[s].k must be an array");
    });

    it("should throw ConfigError when value is null", () => {
      expect(() => validateStringArray(null, "k", "s")).toThrow(ConfigError);
    });

    it("should throw ConfigError when value is object", () => {
      expect(() => validateStringArray({}, "k", "s")).toThrow(ConfigError);
    });

    it("should throw ConfigError when array contains non-string element", () => {
      expect(() => validateStringArray(["a", 123, "c"], "k", "s")).toThrow(ConfigError);
      expect(() => validateStringArray(["a", 123, "c"], "k", "s")).toThrow(
        "[s].k[1] must be a string",
      );
    });

    it("should throw ConfigError indicating which index is invalid", () => {
      expect(() => validateStringArray(["a", "b", null], "gadget", "agent")).toThrow(
        "[agent].gadget[2] must be a string",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Table validator
  // ─────────────────────────────────────────────────────────────────────────────

  describe("validateTable", () => {
    it("should return a plain object unchanged", () => {
      const obj = { a: 1, b: 2 };
      expect(validateTable(obj, "s")).toEqual({ a: 1, b: 2 });
    });

    it("should return empty object", () => {
      expect(validateTable({}, "s")).toEqual({});
    });

    it("should throw ConfigError when value is a string", () => {
      expect(() => validateTable("string", "s")).toThrow(ConfigError);
      expect(() => validateTable("string", "s")).toThrow("[s] must be a table");
    });

    it("should throw ConfigError when value is null", () => {
      expect(() => validateTable(null, "s")).toThrow(ConfigError);
      expect(() => validateTable(null, "s")).toThrow("[s] must be a table");
    });

    it("should throw ConfigError when value is an array", () => {
      expect(() => validateTable([1, 2, 3], "s")).toThrow(ConfigError);
    });

    it("should throw ConfigError when value is a number", () => {
      expect(() => validateTable(42, "s")).toThrow(ConfigError);
    });

    it("should accept all keys when validKeys is not provided", () => {
      const obj = { arbitrary: "key", another: 123 };
      expect(validateTable(obj, "s")).toEqual(obj);
    });

    it("should reject unknown key when validKeys is provided", () => {
      const validKeys = new Set(["model", "temperature"]);
      expect(() => validateTable({ model: "gpt4", unknown: "bad" }, "s", validKeys)).toThrow(
        ConfigError,
      );
      expect(() => validateTable({ model: "gpt4", unknown: "bad" }, "s", validKeys)).toThrow(
        "[s].unknown is not a valid option",
      );
    });

    it("should accept valid keys from validKeys set", () => {
      const validKeys = new Set(["model", "temperature"]);
      expect(validateTable({ model: "gpt4", temperature: 0.5 }, "s", validKeys)).toEqual({
        model: "gpt4",
        temperature: 0.5,
      });
    });

    it("should reject each unknown key individually", () => {
      const validKeys = new Set(["model"]);
      expect(() => validateTable({ model: "gpt4", bad1: "x" }, "sect", validKeys)).toThrow(
        "[sect].bad1 is not a valid option",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // validateInherits
  // ─────────────────────────────────────────────────────────────────────────────

  describe("validateInherits", () => {
    it("should return a string value unchanged", () => {
      expect(validateInherits("agent", "s")).toBe("agent");
    });

    it("should return empty string", () => {
      expect(validateInherits("", "s")).toBe("");
    });

    it("should return array of strings", () => {
      expect(validateInherits(["agent", "complete"], "s")).toEqual(["agent", "complete"]);
    });

    it("should return empty array", () => {
      expect(validateInherits([], "s")).toEqual([]);
    });

    it("should throw ConfigError when value is a number", () => {
      expect(() => validateInherits(42, "s")).toThrow(ConfigError);
      expect(() => validateInherits(42, "s")).toThrow(
        "[s].inherits must be a string or array of strings",
      );
    });

    it("should throw ConfigError when value is null", () => {
      expect(() => validateInherits(null, "s")).toThrow(ConfigError);
    });

    it("should throw ConfigError when value is an object (not array)", () => {
      expect(() => validateInherits({}, "s")).toThrow(ConfigError);
    });

    it("should throw ConfigError when array contains a non-string element", () => {
      expect(() => validateInherits(["ok", 123], "sect")).toThrow(ConfigError);
      expect(() => validateInherits(["ok", 123], "sect")).toThrow(
        "[sect].inherits[1] must be a string",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // validateRateLimitsConfig
  // ─────────────────────────────────────────────────────────────────────────────

  describe("validateRateLimitsConfig", () => {
    it("should accept empty object", () => {
      expect(validateRateLimitsConfig({}, "s")).toEqual({});
    });

    it("should validate requests-per-minute", () => {
      const result = validateRateLimitsConfig({ "requests-per-minute": 60 }, "s");
      expect(result["requests-per-minute"]).toBe(60);
    });

    it("should validate tokens-per-minute", () => {
      const result = validateRateLimitsConfig({ "tokens-per-minute": 100000 }, "s");
      expect(result["tokens-per-minute"]).toBe(100000);
    });

    it("should validate tokens-per-day", () => {
      const result = validateRateLimitsConfig({ "tokens-per-day": 1000000 }, "s");
      expect(result["tokens-per-day"]).toBe(1000000);
    });

    it("should validate safety-margin (0 to 1)", () => {
      const result = validateRateLimitsConfig({ "safety-margin": 0.1 }, "s");
      expect(result["safety-margin"]).toBe(0.1);
    });

    it("should validate enabled boolean", () => {
      expect(validateRateLimitsConfig({ enabled: true }, "s").enabled).toBe(true);
      expect(validateRateLimitsConfig({ enabled: false }, "s").enabled).toBe(false);
    });

    it("should accept all valid fields together", () => {
      const result = validateRateLimitsConfig(
        {
          "requests-per-minute": 100,
          "tokens-per-minute": 200000,
          "tokens-per-day": 1000000,
          "safety-margin": 0.2,
          enabled: true,
        },
        "s",
      );
      expect(result["requests-per-minute"]).toBe(100);
      expect(result["tokens-per-minute"]).toBe(200000);
      expect(result["tokens-per-day"]).toBe(1000000);
      expect(result["safety-margin"]).toBe(0.2);
      expect(result.enabled).toBe(true);
    });

    it("should throw when requests-per-minute is not an integer", () => {
      expect(() => validateRateLimitsConfig({ "requests-per-minute": 1.5 }, "s")).toThrow(
        ConfigError,
      );
    });

    it("should throw when requests-per-minute is less than 1", () => {
      expect(() => validateRateLimitsConfig({ "requests-per-minute": 0 }, "s")).toThrow(
        ConfigError,
      );
    });

    it("should throw when tokens-per-minute is not an integer", () => {
      expect(() => validateRateLimitsConfig({ "tokens-per-minute": 100.5 }, "s")).toThrow(
        ConfigError,
      );
    });

    it("should throw when tokens-per-minute is less than 1", () => {
      expect(() => validateRateLimitsConfig({ "tokens-per-minute": 0 }, "s")).toThrow(ConfigError);
    });

    it("should throw when tokens-per-day is less than 1", () => {
      expect(() => validateRateLimitsConfig({ "tokens-per-day": 0 }, "s")).toThrow(ConfigError);
    });

    it("should throw when safety-margin is below 0", () => {
      expect(() => validateRateLimitsConfig({ "safety-margin": -0.1 }, "s")).toThrow(ConfigError);
    });

    it("should throw when safety-margin exceeds 1", () => {
      expect(() => validateRateLimitsConfig({ "safety-margin": 1.1 }, "s")).toThrow(ConfigError);
    });

    it("should throw when enabled is not a boolean", () => {
      expect(() => validateRateLimitsConfig({ enabled: "yes" }, "s")).toThrow(ConfigError);
    });

    it("should throw when an unknown key is provided", () => {
      expect(() => validateRateLimitsConfig({ unknown: 1 }, "s")).toThrow(ConfigError);
    });

    it("should throw when value is not an object", () => {
      expect(() => validateRateLimitsConfig("invalid", "s")).toThrow(ConfigError);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // validateRetryConfig
  // ─────────────────────────────────────────────────────────────────────────────

  describe("validateRetryConfig", () => {
    it("should accept empty object", () => {
      expect(validateRetryConfig({}, "s")).toEqual({});
    });

    it("should validate enabled boolean", () => {
      expect(validateRetryConfig({ enabled: true }, "s").enabled).toBe(true);
    });

    it("should validate retries integer >= 0", () => {
      expect(validateRetryConfig({ retries: 3 }, "s").retries).toBe(3);
      expect(validateRetryConfig({ retries: 0 }, "s").retries).toBe(0);
    });

    it("should validate min-timeout integer >= 0", () => {
      expect(validateRetryConfig({ "min-timeout": 1000 }, "s")["min-timeout"]).toBe(1000);
    });

    it("should validate max-timeout integer >= 0", () => {
      expect(validateRetryConfig({ "max-timeout": 60000 }, "s")["max-timeout"]).toBe(60000);
    });

    it("should validate factor number >= 1", () => {
      expect(validateRetryConfig({ factor: 2 }, "s").factor).toBe(2);
      expect(validateRetryConfig({ factor: 1.5 }, "s").factor).toBe(1.5);
    });

    it("should validate randomize boolean", () => {
      expect(validateRetryConfig({ randomize: true }, "s").randomize).toBe(true);
    });

    it("should validate respect-retry-after boolean", () => {
      expect(validateRetryConfig({ "respect-retry-after": true }, "s")["respect-retry-after"]).toBe(
        true,
      );
    });

    it("should validate max-retry-after-ms integer >= 0", () => {
      expect(validateRetryConfig({ "max-retry-after-ms": 30000 }, "s")["max-retry-after-ms"]).toBe(
        30000,
      );
    });

    it("should accept all valid fields together", () => {
      const result = validateRetryConfig(
        {
          enabled: true,
          retries: 3,
          "min-timeout": 1000,
          "max-timeout": 60000,
          factor: 2,
          randomize: false,
          "respect-retry-after": true,
          "max-retry-after-ms": 5000,
        },
        "s",
      );
      expect(result.enabled).toBe(true);
      expect(result.retries).toBe(3);
      expect(result["min-timeout"]).toBe(1000);
      expect(result["max-timeout"]).toBe(60000);
      expect(result.factor).toBe(2);
      expect(result.randomize).toBe(false);
      expect(result["respect-retry-after"]).toBe(true);
      expect(result["max-retry-after-ms"]).toBe(5000);
    });

    it("should throw when retries is not an integer", () => {
      expect(() => validateRetryConfig({ retries: 1.5 }, "s")).toThrow(ConfigError);
    });

    it("should throw when retries is negative", () => {
      expect(() => validateRetryConfig({ retries: -1 }, "s")).toThrow(ConfigError);
    });

    it("should throw when factor is below 1", () => {
      expect(() => validateRetryConfig({ factor: 0.5 }, "s")).toThrow(ConfigError);
    });

    it("should throw when enabled is not boolean", () => {
      expect(() => validateRetryConfig({ enabled: "yes" }, "s")).toThrow(ConfigError);
    });

    it("should throw when unknown key is provided", () => {
      expect(() => validateRetryConfig({ unknown: 1 }, "s")).toThrow(ConfigError);
    });

    it("should throw when value is not an object", () => {
      expect(() => validateRetryConfig("invalid", "s")).toThrow(ConfigError);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // validateReasoningConfig
  // ─────────────────────────────────────────────────────────────────────────────

  describe("validateReasoningConfig", () => {
    it("should accept empty object", () => {
      expect(validateReasoningConfig({}, "s")).toEqual({});
    });

    it("should validate enabled boolean", () => {
      expect(validateReasoningConfig({ enabled: true }, "s").enabled).toBe(true);
    });

    it("should accept all valid effort levels", () => {
      for (const effort of ["none", "low", "medium", "high", "maximum"]) {
        const result = validateReasoningConfig({ effort }, "s");
        expect(result.effort).toBe(effort);
      }
    });

    it("should validate budget-tokens integer >= 1", () => {
      expect(validateReasoningConfig({ "budget-tokens": 1024 }, "s")["budget-tokens"]).toBe(1024);
    });

    it("should accept all fields together", () => {
      const result = validateReasoningConfig(
        { enabled: true, effort: "high", "budget-tokens": 2048 },
        "s",
      );
      expect(result.enabled).toBe(true);
      expect(result.effort).toBe("high");
      expect(result["budget-tokens"]).toBe(2048);
    });

    it("should throw when effort is an invalid value", () => {
      expect(() => validateReasoningConfig({ effort: "ultra" }, "s")).toThrow(ConfigError);
      expect(() => validateReasoningConfig({ effort: "ultra" }, "s")).toThrow(
        'must be one of: none, low, medium, high, maximum (got "ultra")',
      );
    });

    it("should throw when effort is not a string", () => {
      expect(() => validateReasoningConfig({ effort: 1 }, "s")).toThrow(ConfigError);
    });

    it("should throw when budget-tokens is not an integer", () => {
      expect(() => validateReasoningConfig({ "budget-tokens": 1.5 }, "s")).toThrow(ConfigError);
    });

    it("should throw when budget-tokens is less than 1", () => {
      expect(() => validateReasoningConfig({ "budget-tokens": 0 }, "s")).toThrow(ConfigError);
    });

    it("should throw when unknown key is provided", () => {
      expect(() => validateReasoningConfig({ unknown: 1 }, "s")).toThrow(ConfigError);
    });

    it("should throw when value is not an object", () => {
      expect(() => validateReasoningConfig("invalid", "s")).toThrow(ConfigError);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // validateGadgetApproval
  // ─────────────────────────────────────────────────────────────────────────────

  describe("validateGadgetApproval", () => {
    it("should accept empty object", () => {
      expect(validateGadgetApproval({}, "s")).toEqual({});
    });

    it("should accept valid permission levels for gadgets", () => {
      const result = validateGadgetApproval(
        {
          WriteFile: "allowed",
          DeleteFile: "denied",
          RunCommand: "approval-required",
        },
        "s",
      );
      expect(result.WriteFile).toBe("allowed");
      expect(result.DeleteFile).toBe("denied");
      expect(result.RunCommand).toBe("approval-required");
    });

    it("should accept wildcard key *", () => {
      const result = validateGadgetApproval({ "*": "approval-required" }, "s");
      expect(result["*"]).toBe("approval-required");
    });

    it("should throw when value is not an object", () => {
      expect(() => validateGadgetApproval("bad", "s")).toThrow(ConfigError);
      expect(() => validateGadgetApproval("bad", "s")).toThrow(
        "[s].gadget-approval must be a table",
      );
    });

    it("should throw when value is null", () => {
      expect(() => validateGadgetApproval(null, "s")).toThrow(ConfigError);
    });

    it("should throw when value is an array", () => {
      expect(() => validateGadgetApproval([], "s")).toThrow(ConfigError);
    });

    it("should throw when a gadget permission level is not a string", () => {
      expect(() => validateGadgetApproval({ WriteFile: 123 }, "s")).toThrow(ConfigError);
      expect(() => validateGadgetApproval({ WriteFile: 123 }, "s")).toThrow(
        "[s].gadget-approval.WriteFile must be a string",
      );
    });

    it("should throw when a gadget permission level is an invalid string", () => {
      expect(() => validateGadgetApproval({ WriteFile: "maybe" }, "s")).toThrow(ConfigError);
      expect(() => validateGadgetApproval({ WriteFile: "maybe" }, "s")).toThrow(
        "[s].gadget-approval.WriteFile must be one of: allowed, denied, approval-required",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // validateInitialGadgets
  // ─────────────────────────────────────────────────────────────────────────────

  describe("validateInitialGadgets", () => {
    it("should accept empty array", () => {
      expect(validateInitialGadgets([], "s")).toEqual([]);
    });

    it("should accept a valid single entry", () => {
      const result = validateInitialGadgets(
        [{ gadget: "ListDirectory", parameters: { path: "." }, result: "file.ts" }],
        "s",
      );
      expect(result).toHaveLength(1);
      expect(result[0].gadget).toBe("ListDirectory");
      expect(result[0].parameters).toEqual({ path: "." });
      expect(result[0].result).toBe("file.ts");
    });

    it("should accept multiple entries", () => {
      const result = validateInitialGadgets(
        [
          { gadget: "ListDirectory", parameters: { path: "." }, result: "file.ts" },
          { gadget: "ReadFile", parameters: { filePath: "README.md" }, result: "# Hello" },
        ],
        "s",
      );
      expect(result).toHaveLength(2);
      expect(result[1].gadget).toBe("ReadFile");
    });

    it("should accept empty parameters object", () => {
      const result = validateInitialGadgets(
        [{ gadget: "ListDirectory", parameters: {}, result: "output" }],
        "s",
      );
      expect(result[0].parameters).toEqual({});
    });

    it("should throw when value is not an array", () => {
      expect(() => validateInitialGadgets({}, "agent")).toThrow(ConfigError);
      expect(() => validateInitialGadgets({}, "agent")).toThrow(
        "[agent].initial-gadgets must be an array",
      );
    });

    it("should throw when entry is not an object", () => {
      expect(() => validateInitialGadgets(["not-an-object"], "s")).toThrow(ConfigError);
      expect(() => validateInitialGadgets(["not-an-object"], "s")).toThrow(
        "[s].initial-gadgets[0] must be a table",
      );
    });

    it("should throw when entry is null", () => {
      expect(() => validateInitialGadgets([null], "s")).toThrow(ConfigError);
    });

    it("should throw when entry is missing gadget field", () => {
      expect(() => validateInitialGadgets([{ parameters: {}, result: "out" }], "s")).toThrow(
        ConfigError,
      );
      expect(() => validateInitialGadgets([{ parameters: {}, result: "out" }], "s")).toThrow(
        "[s].initial-gadgets[0] is missing required field 'gadget'",
      );
    });

    it("should throw when entry gadget is not a string", () => {
      expect(() =>
        validateInitialGadgets([{ gadget: 123, parameters: {}, result: "out" }], "s"),
      ).toThrow(ConfigError);
      expect(() =>
        validateInitialGadgets([{ gadget: 123, parameters: {}, result: "out" }], "s"),
      ).toThrow("[s].initial-gadgets[0].gadget must be a string");
    });

    it("should throw when entry is missing parameters field", () => {
      expect(() =>
        validateInitialGadgets([{ gadget: "ListDirectory", result: "out" }], "s"),
      ).toThrow(ConfigError);
      expect(() =>
        validateInitialGadgets([{ gadget: "ListDirectory", result: "out" }], "s"),
      ).toThrow("[s].initial-gadgets[0] is missing required field 'parameters'");
    });

    it("should throw when entry parameters is not an object", () => {
      expect(() =>
        validateInitialGadgets(
          [{ gadget: "ListDirectory", parameters: "bad", result: "out" }],
          "s",
        ),
      ).toThrow(ConfigError);
      expect(() =>
        validateInitialGadgets(
          [{ gadget: "ListDirectory", parameters: "bad", result: "out" }],
          "s",
        ),
      ).toThrow("[s].initial-gadgets[0].parameters must be a table");
    });

    it("should throw when entry is missing result field", () => {
      expect(() =>
        validateInitialGadgets([{ gadget: "ListDirectory", parameters: {} }], "s"),
      ).toThrow(ConfigError);
      expect(() =>
        validateInitialGadgets([{ gadget: "ListDirectory", parameters: {} }], "s"),
      ).toThrow("[s].initial-gadgets[0] is missing required field 'result'");
    });

    it("should throw when entry result is not a string", () => {
      expect(() =>
        validateInitialGadgets([{ gadget: "ListDirectory", parameters: {}, result: 42 }], "s"),
      ).toThrow(ConfigError);
      expect(() =>
        validateInitialGadgets([{ gadget: "ListDirectory", parameters: {}, result: 42 }], "s"),
      ).toThrow("[s].initial-gadgets[0].result must be a string");
    });

    it("should include correct index in error for second entry", () => {
      const validEntry = { gadget: "ListDirectory", parameters: {}, result: "out" };
      const badEntry = { gadget: 123, parameters: {}, result: "out" };
      expect(() => validateInitialGadgets([validEntry, badEntry], "s")).toThrow(
        "[s].initial-gadgets[1].gadget must be a string",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // validateLoggingConfig
  // ─────────────────────────────────────────────────────────────────────────────

  describe("validateLoggingConfig", () => {
    it("should return empty result when no log-level key", () => {
      expect(validateLoggingConfig({}, "s")).toEqual({});
    });

    it("should accept all valid log levels", () => {
      for (const level of ["silly", "trace", "debug", "info", "warn", "error", "fatal"]) {
        const result = validateLoggingConfig({ "log-level": level }, "s");
        expect(result["log-level"]).toBe(level);
      }
    });

    it("should throw when log-level is not a string", () => {
      expect(() => validateLoggingConfig({ "log-level": 1 }, "s")).toThrow(ConfigError);
    });

    it("should throw when log-level is invalid string", () => {
      expect(() => validateLoggingConfig({ "log-level": "verbose" }, "s")).toThrow(ConfigError);
      expect(() => validateLoggingConfig({ "log-level": "verbose" }, "s")).toThrow(
        "[s].log-level must be one of: silly, trace, debug, info, warn, error, fatal",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // validateBaseConfig
  // ─────────────────────────────────────────────────────────────────────────────

  describe("validateBaseConfig", () => {
    it("should return empty result for empty object", () => {
      expect(validateBaseConfig({}, "s")).toEqual({});
    });

    it("should validate model string", () => {
      expect(validateBaseConfig({ model: "gpt-4o" }, "s").model).toBe("gpt-4o");
    });

    it("should validate system string", () => {
      expect(validateBaseConfig({ system: "You are helpful" }, "s").system).toBe("You are helpful");
    });

    it("should validate temperature number (0-2)", () => {
      expect(validateBaseConfig({ temperature: 0.7 }, "s").temperature).toBe(0.7);
      expect(validateBaseConfig({ temperature: 0 }, "s").temperature).toBe(0);
      expect(validateBaseConfig({ temperature: 2 }, "s").temperature).toBe(2);
    });

    it("should throw when temperature is out of range", () => {
      expect(() => validateBaseConfig({ temperature: -0.1 }, "s")).toThrow("must be >= 0");
      expect(() => validateBaseConfig({ temperature: 2.1 }, "s")).toThrow("must be <= 2");
    });

    it("should validate inherits string", () => {
      expect(validateBaseConfig({ inherits: "agent" }, "s").inherits).toBe("agent");
    });

    it("should validate inherits array of strings", () => {
      expect(validateBaseConfig({ inherits: ["agent", "complete"] }, "s").inherits).toEqual([
        "agent",
        "complete",
      ]);
    });

    it("should ignore keys not in base config (model, system, temperature, inherits)", () => {
      const result = validateBaseConfig({ other: "ignored" }, "s");
      expect(result).toEqual({});
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // validateSingleSubagentConfig
  // ─────────────────────────────────────────────────────────────────────────────

  describe("validateSingleSubagentConfig", () => {
    it("should accept empty object", () => {
      expect(validateSingleSubagentConfig({}, "MyAgent", "s")).toEqual({});
    });

    it("should validate model string", () => {
      const result = validateSingleSubagentConfig({ model: "inherit" }, "Agent", "s");
      expect(result.model).toBe("inherit");
    });

    it("should validate maxIterations positive integer", () => {
      const result = validateSingleSubagentConfig({ maxIterations: 20 }, "Agent", "s");
      expect(result.maxIterations).toBe(20);
    });

    it("should validate budget non-negative number", () => {
      const result = validateSingleSubagentConfig({ budget: 0 }, "Agent", "s");
      expect(result.budget).toBe(0);
    });

    it("should validate timeoutMs non-negative integer", () => {
      const result = validateSingleSubagentConfig({ timeoutMs: 60000 }, "Agent", "s");
      expect(result.timeoutMs).toBe(60000);
    });

    it("should validate maxConcurrent non-negative integer", () => {
      const result = validateSingleSubagentConfig({ maxConcurrent: 2 }, "Agent", "s");
      expect(result.maxConcurrent).toBe(2);
    });

    it("should allow arbitrary additional fields", () => {
      const result = validateSingleSubagentConfig({ headless: true }, "Agent", "s");
      expect(result.headless).toBe(true);
    });

    it("should throw when value is not an object", () => {
      expect(() => validateSingleSubagentConfig("bad", "Agent", "s")).toThrow(ConfigError);
      expect(() => validateSingleSubagentConfig("bad", "Agent", "s")).toThrow(
        "[s].Agent must be a table",
      );
    });

    it("should throw when model is not a string", () => {
      expect(() => validateSingleSubagentConfig({ model: 123 }, "Agent", "s")).toThrow(ConfigError);
      expect(() => validateSingleSubagentConfig({ model: 123 }, "Agent", "s")).toThrow(
        "[s].Agent.model must be a string",
      );
    });

    it("should throw when maxIterations is not a positive integer", () => {
      expect(() => validateSingleSubagentConfig({ maxIterations: 0 }, "Agent", "s")).toThrow(
        ConfigError,
      );
      expect(() => validateSingleSubagentConfig({ maxIterations: 1.5 }, "Agent", "s")).toThrow(
        ConfigError,
      );
    });

    it("should throw when budget is negative", () => {
      expect(() => validateSingleSubagentConfig({ budget: -1 }, "Agent", "s")).toThrow(ConfigError);
    });

    it("should throw when timeoutMs is negative", () => {
      expect(() => validateSingleSubagentConfig({ timeoutMs: -100 }, "Agent", "s")).toThrow(
        ConfigError,
      );
    });

    it("should throw when maxConcurrent is negative", () => {
      expect(() => validateSingleSubagentConfig({ maxConcurrent: -1 }, "Agent", "s")).toThrow(
        ConfigError,
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // validateSubagentConfigMap
  // ─────────────────────────────────────────────────────────────────────────────

  describe("validateSubagentConfigMap", () => {
    it("should accept empty object", () => {
      expect(validateSubagentConfigMap({}, "s")).toEqual({});
    });

    it("should validate a single subagent entry", () => {
      const result = validateSubagentConfigMap(
        { BrowseWeb: { model: "inherit", maxIterations: 10 } },
        "s",
      );
      expect(result.BrowseWeb?.model).toBe("inherit");
      expect(result.BrowseWeb?.maxIterations).toBe(10);
    });

    it("should validate multiple subagent entries", () => {
      const result = validateSubagentConfigMap(
        { AgentA: { model: "gpt-4o" }, AgentB: { maxIterations: 5 } },
        "s",
      );
      expect(result.AgentA?.model).toBe("gpt-4o");
      expect(result.AgentB?.maxIterations).toBe(5);
    });

    it("should throw when value is not an object", () => {
      expect(() => validateSubagentConfigMap("bad", "s")).toThrow(ConfigError);
      expect(() => validateSubagentConfigMap("bad", "s")).toThrow("[s].subagents must be a table");
    });

    it("should throw when a subagent entry is not an object", () => {
      expect(() => validateSubagentConfigMap({ BrowseWeb: "bad" }, "s")).toThrow(ConfigError);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // validateGlobalSubagentConfig
  // ─────────────────────────────────────────────────────────────────────────────

  describe("validateGlobalSubagentConfig", () => {
    it("should accept empty object", () => {
      expect(validateGlobalSubagentConfig({}, "s")).toEqual({});
    });

    it("should validate default-model string", () => {
      const result = validateGlobalSubagentConfig({ "default-model": "gpt-4o" }, "s");
      expect(result["default-model"]).toBe("gpt-4o");
    });

    it("should validate per-subagent configs alongside default-model", () => {
      const result = validateGlobalSubagentConfig(
        { "default-model": "inherit", BrowseWeb: { model: "gpt-4o" } },
        "s",
      );
      expect(result["default-model"]).toBe("inherit");
      expect(result.BrowseWeb?.model).toBe("gpt-4o");
    });

    it("should throw when default-model is not a string", () => {
      expect(() => validateGlobalSubagentConfig({ "default-model": 123 }, "s")).toThrow(
        ConfigError,
      );
      expect(() => validateGlobalSubagentConfig({ "default-model": 123 }, "s")).toThrow(
        "[s].default-model must be a string",
      );
    });

    it("should throw when value is not an object", () => {
      expect(() => validateGlobalSubagentConfig("bad", "s")).toThrow(ConfigError);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // validateAgentConfig
  // ─────────────────────────────────────────────────────────────────────────────

  describe("validateAgentConfig", () => {
    it("should accept empty object", () => {
      expect(validateAgentConfig({}, "agent")).toEqual({});
    });

    it("should validate base fields", () => {
      const result = validateAgentConfig({ model: "gpt-4o", temperature: 0.5 }, "agent");
      expect(result.model).toBe("gpt-4o");
      expect(result.temperature).toBe(0.5);
    });

    it("should validate max-iterations positive integer", () => {
      const result = validateAgentConfig({ "max-iterations": 10 }, "agent");
      expect(result["max-iterations"]).toBe(10);
    });

    it("should validate budget >= 0", () => {
      expect(validateAgentConfig({ budget: 0 }, "agent").budget).toBe(0);
      expect(validateAgentConfig({ budget: 1.5 }, "agent").budget).toBe(1.5);
    });

    it("should validate gadgets string array", () => {
      const result = validateAgentConfig({ gadgets: ["ReadFile", "WriteFile"] }, "agent");
      expect(result.gadgets).toEqual(["ReadFile", "WriteFile"]);
    });

    it("should validate gadget-add string array", () => {
      expect(validateAgentConfig({ "gadget-add": ["WriteFile"] }, "agent")["gadget-add"]).toEqual([
        "WriteFile",
      ]);
    });

    it("should validate gadget-remove string array", () => {
      expect(
        validateAgentConfig({ "gadget-remove": ["RunCommand"] }, "agent")["gadget-remove"],
      ).toEqual(["RunCommand"]);
    });

    it("should validate builtins boolean", () => {
      expect(validateAgentConfig({ builtins: true }, "agent").builtins).toBe(true);
    });

    it("should validate builtin-interaction boolean", () => {
      expect(
        validateAgentConfig({ "builtin-interaction": false }, "agent")["builtin-interaction"],
      ).toBe(false);
    });

    it("should validate gadget-start-prefix string", () => {
      expect(
        validateAgentConfig({ "gadget-start-prefix": "<tool>" }, "agent")["gadget-start-prefix"],
      ).toBe("<tool>");
    });

    it("should validate gadget-end-prefix string", () => {
      expect(
        validateAgentConfig({ "gadget-end-prefix": "</tool>" }, "agent")["gadget-end-prefix"],
      ).toBe("</tool>");
    });

    it("should validate gadget-arg-prefix string", () => {
      expect(
        validateAgentConfig({ "gadget-arg-prefix": "arg:" }, "agent")["gadget-arg-prefix"],
      ).toBe("arg:");
    });

    it("should validate gadget-approval object", () => {
      const result = validateAgentConfig({ "gadget-approval": { WriteFile: "allowed" } }, "agent");
      expect(result["gadget-approval"]?.WriteFile).toBe("allowed");
    });

    it("should validate rate-limits sub-config", () => {
      const result = validateAgentConfig({ "rate-limits": { "requests-per-minute": 60 } }, "agent");
      expect(result["rate-limits"]?.["requests-per-minute"]).toBe(60);
    });

    it("should validate retry sub-config", () => {
      const result = validateAgentConfig({ retry: { retries: 3 } }, "agent");
      expect(result.retry?.retries).toBe(3);
    });

    it("should validate reasoning sub-config", () => {
      const result = validateAgentConfig({ reasoning: { enabled: true, effort: "high" } }, "agent");
      expect(result.reasoning?.enabled).toBe(true);
      expect(result.reasoning?.effort).toBe("high");
    });

    it("should validate quiet boolean", () => {
      expect(validateAgentConfig({ quiet: true }, "agent").quiet).toBe(true);
    });

    it("should validate log-level", () => {
      expect(validateAgentConfig({ "log-level": "debug" }, "agent")["log-level"]).toBe("debug");
    });

    it("should validate log-llm-requests boolean", () => {
      expect(validateAgentConfig({ "log-llm-requests": true }, "agent")["log-llm-requests"]).toBe(
        true,
      );
    });

    it("should validate initial-gadgets array", () => {
      const result = validateAgentConfig(
        {
          "initial-gadgets": [{ gadget: "ListDirectory", parameters: {}, result: "output" }],
        },
        "agent",
      );
      expect(result["initial-gadgets"]).toHaveLength(1);
      expect(result["initial-gadgets"]?.[0].gadget).toBe("ListDirectory");
    });

    it("should throw when max-iterations is not an integer", () => {
      expect(() => validateAgentConfig({ "max-iterations": 5.5 }, "agent")).toThrow(ConfigError);
    });

    it("should throw when budget is negative", () => {
      expect(() => validateAgentConfig({ budget: -1 }, "agent")).toThrow(ConfigError);
    });

    it("should throw when an unknown key is provided", () => {
      expect(() => validateAgentConfig({ "unknown-key": "value" }, "agent")).toThrow(ConfigError);
      expect(() => validateAgentConfig({ "unknown-key": "value" }, "agent")).toThrow(
        "[agent].unknown-key is not a valid option",
      );
    });

    it("should throw when value is not an object", () => {
      expect(() => validateAgentConfig("bad", "agent")).toThrow(ConfigError);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // validateCompleteConfig
  // ─────────────────────────────────────────────────────────────────────────────

  describe("validateCompleteConfig", () => {
    it("should accept empty object", () => {
      expect(validateCompleteConfig({}, "complete")).toEqual({});
    });

    it("should validate base fields", () => {
      const result = validateCompleteConfig(
        { model: "gpt-4o", system: "You are helpful.", temperature: 0.3 },
        "complete",
      );
      expect(result.model).toBe("gpt-4o");
      expect(result.system).toBe("You are helpful.");
      expect(result.temperature).toBe(0.3);
    });

    it("should validate max-tokens positive integer", () => {
      const result = validateCompleteConfig({ "max-tokens": 1000 }, "complete");
      expect(result["max-tokens"]).toBe(1000);
    });

    it("should validate quiet boolean", () => {
      expect(validateCompleteConfig({ quiet: true }, "complete").quiet).toBe(true);
    });

    it("should validate log-llm-requests boolean", () => {
      expect(
        validateCompleteConfig({ "log-llm-requests": true }, "complete")["log-llm-requests"],
      ).toBe(true);
    });

    it("should validate log-level", () => {
      expect(validateCompleteConfig({ "log-level": "info" }, "complete")["log-level"]).toBe("info");
    });

    it("should validate rate-limits sub-config", () => {
      const result = validateCompleteConfig(
        { "rate-limits": { "tokens-per-minute": 500000 } },
        "complete",
      );
      expect(result["rate-limits"]?.["tokens-per-minute"]).toBe(500000);
    });

    it("should validate retry sub-config", () => {
      const result = validateCompleteConfig({ retry: { enabled: true } }, "complete");
      expect(result.retry?.enabled).toBe(true);
    });

    it("should validate reasoning sub-config", () => {
      const result = validateCompleteConfig(
        { reasoning: { enabled: false, effort: "low" } },
        "complete",
      );
      expect(result.reasoning?.effort).toBe("low");
    });

    it("should validate inherits string", () => {
      const result = validateCompleteConfig({ inherits: "agent" }, "complete");
      expect(result.inherits).toBe("agent");
    });

    it("should throw when max-tokens is not an integer", () => {
      expect(() => validateCompleteConfig({ "max-tokens": 100.5 }, "complete")).toThrow(
        ConfigError,
      );
    });

    it("should throw when max-tokens is less than 1", () => {
      expect(() => validateCompleteConfig({ "max-tokens": 0 }, "complete")).toThrow(ConfigError);
    });

    it("should throw when an unknown key is provided", () => {
      expect(() => validateCompleteConfig({ "bad-key": "value" }, "complete")).toThrow(ConfigError);
      expect(() => validateCompleteConfig({ "bad-key": "value" }, "complete")).toThrow(
        "[complete].bad-key is not a valid option",
      );
    });

    it("should throw when value is not an object", () => {
      expect(() => validateCompleteConfig(42, "complete")).toThrow(ConfigError);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // validateCustomConfig
  // ─────────────────────────────────────────────────────────────────────────────

  describe("validateCustomConfig", () => {
    it("should default type to agent when not specified", () => {
      const result = validateCustomConfig({}, "my-cmd");
      expect(result.type).toBe("agent");
    });

    it("should accept type=agent explicitly", () => {
      expect(validateCustomConfig({ type: "agent" }, "my-cmd").type).toBe("agent");
    });

    it("should accept type=complete", () => {
      expect(validateCustomConfig({ type: "complete" }, "my-cmd").type).toBe("complete");
    });

    it("should validate description string", () => {
      const result = validateCustomConfig({ description: "Does cool stuff" }, "my-cmd");
      expect(result.description).toBe("Does cool stuff");
    });

    it("should validate base fields (model, system, temperature)", () => {
      const result = validateCustomConfig(
        { model: "gpt-4o", system: "system prompt", temperature: 0.5 },
        "my-cmd",
      );
      expect(result.model).toBe("gpt-4o");
      expect(result.system).toBe("system prompt");
      expect(result.temperature).toBe(0.5);
    });

    it("should validate agent-specific fields", () => {
      const result = validateCustomConfig(
        {
          type: "agent",
          "max-iterations": 5,
          gadgets: ["ReadFile"],
          builtins: true,
        },
        "my-cmd",
      );
      expect(result["max-iterations"]).toBe(5);
      expect(result.gadgets).toEqual(["ReadFile"]);
      expect(result.builtins).toBe(true);
    });

    it("should validate max-tokens for complete type", () => {
      const result = validateCustomConfig({ type: "complete", "max-tokens": 500 }, "my-cmd");
      expect(result["max-tokens"]).toBe(500);
    });

    it("should validate log-level", () => {
      expect(validateCustomConfig({ "log-level": "warn" }, "my-cmd")["log-level"]).toBe("warn");
    });

    it("should validate gadget-approval", () => {
      const result = validateCustomConfig(
        { "gadget-approval": { RunCommand: "denied" } },
        "my-cmd",
      );
      expect(result["gadget-approval"]?.RunCommand).toBe("denied");
    });

    it("should validate inherits field", () => {
      const result = validateCustomConfig({ inherits: "agent" }, "my-cmd");
      expect(result.inherits).toBe("agent");
    });

    it("should validate initial-gadgets", () => {
      const result = validateCustomConfig(
        {
          "initial-gadgets": [
            { gadget: "ListDirectory", parameters: { path: "." }, result: "files" },
          ],
        },
        "my-cmd",
      );
      expect(result["initial-gadgets"]).toHaveLength(1);
    });

    it("should throw when type is invalid", () => {
      expect(() => validateCustomConfig({ type: "task" }, "my-cmd")).toThrow(ConfigError);
      expect(() => validateCustomConfig({ type: "task" }, "my-cmd")).toThrow(
        '[my-cmd].type must be "agent" or "complete"',
      );
    });

    it("should throw when type is not a string", () => {
      expect(() => validateCustomConfig({ type: 42 }, "my-cmd")).toThrow(ConfigError);
    });

    it("should throw when an unknown key is provided", () => {
      expect(() => validateCustomConfig({ "totally-unknown": "val" }, "my-cmd")).toThrow(
        ConfigError,
      );
      expect(() => validateCustomConfig({ "totally-unknown": "val" }, "my-cmd")).toThrow(
        "[my-cmd].totally-unknown is not a valid option",
      );
    });

    it("should throw when value is not an object", () => {
      expect(() => validateCustomConfig("bad", "my-cmd")).toThrow(ConfigError);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // validateGlobalConfig
  // ─────────────────────────────────────────────────────────────────────────────

  describe("validateGlobalConfig", () => {
    it("should accept empty object", () => {
      expect(validateGlobalConfig({}, "global")).toEqual({});
    });

    it("should validate log-level", () => {
      const result = validateGlobalConfig({ "log-level": "debug" }, "global");
      expect(result["log-level"]).toBe("debug");
    });

    it("should accept all valid log levels", () => {
      for (const level of ["silly", "trace", "debug", "info", "warn", "error", "fatal"]) {
        const result = validateGlobalConfig({ "log-level": level }, "global");
        expect(result["log-level"]).toBe(level);
      }
    });

    it("should throw when log-level is invalid", () => {
      expect(() => validateGlobalConfig({ "log-level": "verbose" }, "global")).toThrow(ConfigError);
    });

    it("should throw when an unknown key is provided", () => {
      expect(() => validateGlobalConfig({ "unknown-key": "value" }, "global")).toThrow(ConfigError);
      expect(() => validateGlobalConfig({ "unknown-key": "value" }, "global")).toThrow(
        "[global].unknown-key is not a valid option",
      );
    });

    it("should throw when value is not an object", () => {
      expect(() => validateGlobalConfig("bad", "global")).toThrow(ConfigError);
    });

    it("should throw when value is null", () => {
      expect(() => validateGlobalConfig(null, "global")).toThrow(ConfigError);
    });

    it("should throw when value is an array", () => {
      expect(() => validateGlobalConfig([], "global")).toThrow(ConfigError);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // validateImageConfig
  // ─────────────────────────────────────────────────────────────────────────────

  describe("validateImageConfig", () => {
    it("should accept empty object", () => {
      expect(validateImageConfig({}, "image")).toEqual({});
    });

    it("should validate model string", () => {
      expect(validateImageConfig({ model: "dall-e-3" }, "image").model).toBe("dall-e-3");
    });

    it("should validate size string", () => {
      expect(validateImageConfig({ size: "1024x1024" }, "image").size).toBe("1024x1024");
    });

    it("should validate quality string", () => {
      expect(validateImageConfig({ quality: "hd" }, "image").quality).toBe("hd");
    });

    it("should validate count integer (1–10)", () => {
      expect(validateImageConfig({ count: 1 }, "image").count).toBe(1);
      expect(validateImageConfig({ count: 10 }, "image").count).toBe(10);
      expect(validateImageConfig({ count: 3 }, "image").count).toBe(3);
    });

    it("should validate output path string with tilde expansion", () => {
      const result = validateImageConfig({ output: "~/images/out.png" }, "image");
      expect(result.output).toBe(`${homedir()}/images/out.png`);
    });

    it("should validate output path string without tilde", () => {
      expect(validateImageConfig({ output: "/tmp/out.png" }, "image").output).toBe("/tmp/out.png");
    });

    it("should validate quiet boolean", () => {
      expect(validateImageConfig({ quiet: true }, "image").quiet).toBe(true);
      expect(validateImageConfig({ quiet: false }, "image").quiet).toBe(false);
    });

    it("should accept all fields together", () => {
      const result = validateImageConfig(
        {
          model: "dall-e-3",
          size: "1024x1024",
          quality: "hd",
          count: 2,
          output: "/tmp/out.png",
          quiet: true,
        },
        "image",
      );
      expect(result.model).toBe("dall-e-3");
      expect(result.size).toBe("1024x1024");
      expect(result.quality).toBe("hd");
      expect(result.count).toBe(2);
      expect(result.output).toBe("/tmp/out.png");
      expect(result.quiet).toBe(true);
    });

    it("should throw when count is not an integer", () => {
      expect(() => validateImageConfig({ count: 1.5 }, "image")).toThrow(ConfigError);
    });

    it("should throw when count is less than 1", () => {
      expect(() => validateImageConfig({ count: 0 }, "image")).toThrow(ConfigError);
    });

    it("should throw when count exceeds 10", () => {
      expect(() => validateImageConfig({ count: 11 }, "image")).toThrow(ConfigError);
    });

    it("should throw when model is not a string", () => {
      expect(() => validateImageConfig({ model: 123 }, "image")).toThrow(ConfigError);
    });

    it("should throw when quiet is not a boolean", () => {
      expect(() => validateImageConfig({ quiet: "yes" }, "image")).toThrow(ConfigError);
    });

    it("should throw when an unknown key is provided", () => {
      expect(() => validateImageConfig({ "unknown-key": "value" }, "image")).toThrow(ConfigError);
      expect(() => validateImageConfig({ "unknown-key": "value" }, "image")).toThrow(
        "[image].unknown-key is not a valid option",
      );
    });

    it("should throw when value is not an object", () => {
      expect(() => validateImageConfig("bad", "image")).toThrow(ConfigError);
    });

    it("should throw when value is null", () => {
      expect(() => validateImageConfig(null, "image")).toThrow(ConfigError);
    });

    it("should throw when value is an array", () => {
      expect(() => validateImageConfig([], "image")).toThrow(ConfigError);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // validateSpeechConfig
  // ─────────────────────────────────────────────────────────────────────────────

  describe("validateSpeechConfig", () => {
    it("should accept empty object", () => {
      expect(validateSpeechConfig({}, "speech")).toEqual({});
    });

    it("should validate model string", () => {
      expect(validateSpeechConfig({ model: "tts-1" }, "speech").model).toBe("tts-1");
    });

    it("should validate voice string", () => {
      expect(validateSpeechConfig({ voice: "alloy" }, "speech").voice).toBe("alloy");
    });

    it("should validate format string", () => {
      expect(validateSpeechConfig({ format: "mp3" }, "speech").format).toBe("mp3");
    });

    it("should validate speed number (0.25–4.0)", () => {
      expect(validateSpeechConfig({ speed: 1.0 }, "speech").speed).toBe(1.0);
      expect(validateSpeechConfig({ speed: 0.25 }, "speech").speed).toBe(0.25);
      expect(validateSpeechConfig({ speed: 4.0 }, "speech").speed).toBe(4.0);
    });

    it("should validate output path string with tilde expansion", () => {
      const result = validateSpeechConfig({ output: "~/audio/out.mp3" }, "speech");
      expect(result.output).toBe(`${homedir()}/audio/out.mp3`);
    });

    it("should validate output path string without tilde", () => {
      expect(validateSpeechConfig({ output: "/tmp/out.mp3" }, "speech").output).toBe(
        "/tmp/out.mp3",
      );
    });

    it("should validate quiet boolean", () => {
      expect(validateSpeechConfig({ quiet: true }, "speech").quiet).toBe(true);
      expect(validateSpeechConfig({ quiet: false }, "speech").quiet).toBe(false);
    });

    it("should accept all fields together", () => {
      const result = validateSpeechConfig(
        {
          model: "tts-1",
          voice: "nova",
          format: "opus",
          speed: 1.5,
          output: "/tmp/out.mp3",
          quiet: false,
        },
        "speech",
      );
      expect(result.model).toBe("tts-1");
      expect(result.voice).toBe("nova");
      expect(result.format).toBe("opus");
      expect(result.speed).toBe(1.5);
      expect(result.output).toBe("/tmp/out.mp3");
      expect(result.quiet).toBe(false);
    });

    it("should throw when speed is below 0.25", () => {
      expect(() => validateSpeechConfig({ speed: 0.1 }, "speech")).toThrow(ConfigError);
    });

    it("should throw when speed exceeds 4.0", () => {
      expect(() => validateSpeechConfig({ speed: 4.1 }, "speech")).toThrow(ConfigError);
    });

    it("should throw when model is not a string", () => {
      expect(() => validateSpeechConfig({ model: 42 }, "speech")).toThrow(ConfigError);
    });

    it("should throw when speed is not a number", () => {
      expect(() => validateSpeechConfig({ speed: "fast" }, "speech")).toThrow(ConfigError);
    });

    it("should throw when quiet is not a boolean", () => {
      expect(() => validateSpeechConfig({ quiet: 1 }, "speech")).toThrow(ConfigError);
    });

    it("should throw when an unknown key is provided", () => {
      expect(() => validateSpeechConfig({ "unknown-key": "value" }, "speech")).toThrow(ConfigError);
      expect(() => validateSpeechConfig({ "unknown-key": "value" }, "speech")).toThrow(
        "[speech].unknown-key is not a valid option",
      );
    });

    it("should throw when value is not an object", () => {
      expect(() => validateSpeechConfig("bad", "speech")).toThrow(ConfigError);
    });

    it("should throw when value is null", () => {
      expect(() => validateSpeechConfig(null, "speech")).toThrow(ConfigError);
    });

    it("should throw when value is an array", () => {
      expect(() => validateSpeechConfig([], "speech")).toThrow(ConfigError);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // validatePromptsConfig
  // ─────────────────────────────────────────────────────────────────────────────

  describe("validatePromptsConfig", () => {
    it("should accept empty object", () => {
      expect(validatePromptsConfig({}, "prompts")).toEqual({});
    });

    it("should accept a single string-valued key", () => {
      const result = validatePromptsConfig({ greeting: "Hello, {{name}}!" }, "prompts");
      expect(result.greeting).toBe("Hello, {{name}}!");
    });

    it("should accept multiple string-valued keys", () => {
      const result = validatePromptsConfig(
        {
          intro: "You are a helpful assistant.",
          summary: "Summarize the following text:",
        },
        "prompts",
      );
      expect(result.intro).toBe("You are a helpful assistant.");
      expect(result.summary).toBe("Summarize the following text:");
    });

    it("should accept empty string values", () => {
      const result = validatePromptsConfig({ empty: "" }, "prompts");
      expect(result.empty).toBe("");
    });

    it("should throw when a value is a number (not string)", () => {
      expect(() => validatePromptsConfig({ greeting: 42 }, "prompts")).toThrow(ConfigError);
      expect(() => validatePromptsConfig({ greeting: 42 }, "prompts")).toThrow(
        "[prompts].greeting must be a string",
      );
    });

    it("should throw when a value is boolean", () => {
      expect(() => validatePromptsConfig({ flag: true }, "prompts")).toThrow(ConfigError);
    });

    it("should throw when a value is null", () => {
      expect(() => validatePromptsConfig({ key: null }, "prompts")).toThrow(ConfigError);
    });

    it("should throw when a value is an object", () => {
      expect(() => validatePromptsConfig({ nested: {} }, "prompts")).toThrow(ConfigError);
    });

    it("should throw when a value is an array", () => {
      expect(() => validatePromptsConfig({ list: ["a", "b"] }, "prompts")).toThrow(ConfigError);
    });

    it("should throw when value is not an object", () => {
      expect(() => validatePromptsConfig("bad", "prompts")).toThrow(ConfigError);
      expect(() => validatePromptsConfig("bad", "prompts")).toThrow("[prompts] must be a table");
    });

    it("should throw when value is null", () => {
      expect(() => validatePromptsConfig(null, "prompts")).toThrow(ConfigError);
    });
  });
});
