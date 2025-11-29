import { describe, expect, it } from "bun:test";
import { ConfigError, validateConfig, getCustomCommandNames, type CLIConfig } from "./config.js";

describe("config", () => {
  describe("validateConfig", () => {
    it("should accept empty config", () => {
      const result = validateConfig({});
      expect(result).toEqual({});
    });

    it("should validate global section with logging options", () => {
      const raw = {
        global: {
          "log-level": "debug",
          "log-file": "/tmp/test.log",
          "log-reset": true,
        },
      };

      const result = validateConfig(raw);

      expect(result.global).toBeDefined();
      expect(result.global?.["log-level"]).toBe("debug");
      expect(result.global?.["log-file"]).toBe("/tmp/test.log");
      expect(result.global?.["log-reset"]).toBe(true);
    });

    it("should validate complete section", () => {
      const raw = {
        complete: {
          model: "anthropic:claude-sonnet-4-5",
          system: "You are helpful.",
          temperature: 0.7,
          "max-tokens": 1000,
        },
      };

      const result = validateConfig(raw);

      expect(result.complete).toBeDefined();
      expect(result.complete?.model).toBe("anthropic:claude-sonnet-4-5");
      expect(result.complete?.system).toBe("You are helpful.");
      expect(result.complete?.temperature).toBe(0.7);
      expect(result.complete?.["max-tokens"]).toBe(1000);
    });

    it("should validate agent section", () => {
      const raw = {
        agent: {
          model: "anthropic:claude-sonnet-4-5",
          system: "You are helpful.",
          temperature: 0.7,
          "max-iterations": 10,
          gadget: ["~/gadgets/tools.ts", "./local-gadget.ts"],
          "parameter-format": "toml",
          builtins: true,
          "builtin-interaction": false,
        },
      };

      const result = validateConfig(raw);

      expect(result.agent).toBeDefined();
      expect(result.agent?.model).toBe("anthropic:claude-sonnet-4-5");
      expect(result.agent?.["max-iterations"]).toBe(10);
      expect(result.agent?.gadget).toEqual(["~/gadgets/tools.ts", "./local-gadget.ts"]);
      expect(result.agent?.["parameter-format"]).toBe("toml");
      expect(result.agent?.builtins).toBe(true);
      expect(result.agent?.["builtin-interaction"]).toBe(false);
    });

    it("should validate custom command section with type=agent", () => {
      const raw = {
        "code-review": {
          type: "agent",
          description: "Review code for bugs.",
          model: "anthropic:claude-sonnet-4-5",
          system: "You are a code reviewer.",
          gadget: ["~/gadgets/code-tools.ts"],
        },
      };

      const result = validateConfig(raw);

      expect(result["code-review"]).toBeDefined();
      const cmd = result["code-review"] as CLIConfig["agent"];
      expect(cmd?.model).toBe("anthropic:claude-sonnet-4-5");
    });

    it("should validate custom command section with type=complete", () => {
      const raw = {
        "quick-translate": {
          type: "complete",
          description: "Translate text.",
          model: "openai:gpt-4o",
          system: "You are a translator.",
          "max-tokens": 500,
        },
      };

      const result = validateConfig(raw);

      expect(result["quick-translate"]).toBeDefined();
    });

    it("should validate custom command section with logging options", () => {
      const raw = {
        "develop": {
          type: "agent",
          model: "openai:gpt-4o",
          "log-level": "silly",
          "log-file": "/tmp/develop.log",
          "log-reset": true,
        },
      };

      const result = validateConfig(raw);

      expect(result["develop"]).toBeDefined();
      const cmd = result["develop"] as { "log-level"?: string; "log-file"?: string; "log-reset"?: boolean };
      expect(cmd?.["log-level"]).toBe("silly");
      expect(cmd?.["log-file"]).toBe("/tmp/develop.log");
      expect(cmd?.["log-reset"]).toBe(true);
    });

    it("should default custom command type to agent", () => {
      const raw = {
        "my-command": {
          model: "openai:gpt-4o",
        },
      };

      const result = validateConfig(raw);
      const cmd = result["my-command"] as { type?: string };
      expect(cmd?.type).toBe("agent");
    });

    describe("error handling", () => {
      it("should reject non-object config", () => {
        expect(() => validateConfig("not an object")).toThrow(ConfigError);
        expect(() => validateConfig(null)).toThrow(ConfigError);
        expect(() => validateConfig(42)).toThrow(ConfigError);
      });

      it("should reject unknown keys in complete section", () => {
        const raw = {
          complete: {
            model: "test",
            "unknown-key": "value",
          },
        };

        expect(() => validateConfig(raw)).toThrow(ConfigError);
        expect(() => validateConfig(raw)).toThrow("[complete].unknown-key is not a valid option");
      });

      it("should reject unknown keys in agent section", () => {
        const raw = {
          agent: {
            model: "test",
            "unknown-key": "value",
          },
        };

        expect(() => validateConfig(raw)).toThrow(ConfigError);
        expect(() => validateConfig(raw)).toThrow("[agent].unknown-key is not a valid option");
      });

      it("should reject unknown keys in custom section", () => {
        const raw = {
          "my-command": {
            model: "test",
            "unknown-key": "value",
          },
        };

        expect(() => validateConfig(raw)).toThrow(ConfigError);
        expect(() => validateConfig(raw)).toThrow("[my-command].unknown-key is not a valid option");
      });

      it("should reject invalid model type", () => {
        const raw = {
          complete: {
            model: 123,
          },
        };

        expect(() => validateConfig(raw)).toThrow(ConfigError);
        expect(() => validateConfig(raw)).toThrow("[complete].model must be a string");
      });

      it("should reject invalid temperature type", () => {
        const raw = {
          complete: {
            temperature: "hot",
          },
        };

        expect(() => validateConfig(raw)).toThrow(ConfigError);
        expect(() => validateConfig(raw)).toThrow("[complete].temperature must be a number");
      });

      it("should reject temperature out of range", () => {
        expect(() =>
          validateConfig({
            complete: { temperature: -1 },
          }),
        ).toThrow("[complete].temperature must be >= 0");

        expect(() =>
          validateConfig({
            complete: { temperature: 3 },
          }),
        ).toThrow("[complete].temperature must be <= 2");
      });

      it("should reject non-integer max-tokens", () => {
        const raw = {
          complete: {
            "max-tokens": 100.5,
          },
        };

        expect(() => validateConfig(raw)).toThrow(ConfigError);
        expect(() => validateConfig(raw)).toThrow("[complete].max-tokens must be an integer");
      });

      it("should reject max-tokens less than 1", () => {
        const raw = {
          complete: {
            "max-tokens": 0,
          },
        };

        expect(() => validateConfig(raw)).toThrow(ConfigError);
        expect(() => validateConfig(raw)).toThrow("[complete].max-tokens must be >= 1");
      });

      it("should reject non-integer max-iterations", () => {
        const raw = {
          agent: {
            "max-iterations": 5.5,
          },
        };

        expect(() => validateConfig(raw)).toThrow(ConfigError);
        expect(() => validateConfig(raw)).toThrow("[agent].max-iterations must be an integer");
      });

      it("should reject invalid gadget array", () => {
        const raw = {
          agent: {
            gadget: "not-an-array",
          },
        };

        expect(() => validateConfig(raw)).toThrow(ConfigError);
        expect(() => validateConfig(raw)).toThrow("[agent].gadget must be an array");
      });

      it("should reject non-string elements in gadget array", () => {
        const raw = {
          agent: {
            gadget: ["valid", 123],
          },
        };

        expect(() => validateConfig(raw)).toThrow(ConfigError);
        expect(() => validateConfig(raw)).toThrow("[agent].gadget[1] must be a string");
      });

      it("should reject invalid parameter-format", () => {
        const raw = {
          agent: {
            "parameter-format": "xml",
          },
        };

        expect(() => validateConfig(raw)).toThrow(ConfigError);
        expect(() => validateConfig(raw)).toThrow(
          "[agent].parameter-format must be one of: json, yaml, toml, auto",
        );
      });

      it("should reject invalid builtins type", () => {
        const raw = {
          agent: {
            builtins: "yes",
          },
        };

        expect(() => validateConfig(raw)).toThrow(ConfigError);
        expect(() => validateConfig(raw)).toThrow("[agent].builtins must be a boolean");
      });

      it("should reject invalid log-reset type in global", () => {
        const raw = {
          global: {
            "log-reset": "yes",
          },
        };

        expect(() => validateConfig(raw)).toThrow(ConfigError);
        expect(() => validateConfig(raw)).toThrow("[global].log-reset must be a boolean");
      });

      it("should reject invalid log-reset type in custom command", () => {
        const raw = {
          "my-command": {
            "log-reset": "true",
          },
        };

        expect(() => validateConfig(raw)).toThrow(ConfigError);
        expect(() => validateConfig(raw)).toThrow("[my-command].log-reset must be a boolean");
      });

      it("should reject invalid log-level in custom command", () => {
        const raw = {
          "my-command": {
            "log-level": "verbose",
          },
        };

        expect(() => validateConfig(raw)).toThrow(ConfigError);
        expect(() => validateConfig(raw)).toThrow(
          "[my-command].log-level must be one of: silly, trace, debug, info, warn, error, fatal",
        );
      });

      it("should reject invalid custom command type", () => {
        const raw = {
          "my-command": {
            type: "invalid",
          },
        };

        expect(() => validateConfig(raw)).toThrow(ConfigError);
        expect(() => validateConfig(raw)).toThrow(
          '[my-command].type must be "agent" or "complete"',
        );
      });

      it("should include config path in error message", () => {
        const raw = {
          complete: {
            "unknown-key": "value",
          },
        };

        try {
          validateConfig(raw, "/path/to/config.toml");
          expect.unreachable("Should have thrown");
        } catch (error) {
          expect(error).toBeInstanceOf(ConfigError);
          expect((error as ConfigError).message).toContain("/path/to/config.toml");
        }
      });
    });
  });

  describe("getCustomCommandNames", () => {
    it("should return empty array for empty config", () => {
      const result = getCustomCommandNames({});
      expect(result).toEqual([]);
    });

    it("should exclude built-in sections", () => {
      const config: CLIConfig = {
        complete: { model: "test" },
        agent: { model: "test" },
      };

      const result = getCustomCommandNames(config);
      expect(result).toEqual([]);
    });

    it("should return custom command names", () => {
      const config: CLIConfig = {
        complete: { model: "test" },
        agent: { model: "test" },
        "code-review": { model: "test" },
        "translate": { model: "test" },
      };

      const result = getCustomCommandNames(config);
      expect(result).toContain("code-review");
      expect(result).toContain("translate");
      expect(result).not.toContain("complete");
      expect(result).not.toContain("agent");
    });
  });
});
