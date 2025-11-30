import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  ConfigError,
  validateConfig,
  getCustomCommandNames,
  resolveInheritance,
  resolveTemplatesInConfig,
  type CLIConfig,
} from "./config.js";

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
          builtins: true,
          "builtin-interaction": false,
        },
      };

      const result = validateConfig(raw);

      expect(result.agent).toBeDefined();
      expect(result.agent?.model).toBe("anthropic:claude-sonnet-4-5");
      expect(result.agent?.["max-iterations"]).toBe(10);
      expect(result.agent?.gadget).toEqual(["~/gadgets/tools.ts", "./local-gadget.ts"]);
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

      expect(result.develop).toBeDefined();
      const cmd = result.develop as { "log-level"?: string; "log-file"?: string; "log-reset"?: boolean };
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

  describe("resolveInheritance", () => {
    it("should pass through config with no inheritance", () => {
      const config: CLIConfig = {
        agent: { model: "test-model", temperature: 0.5 },
        complete: { model: "other-model" },
      };

      const result = resolveInheritance(config);

      expect(result.agent?.model).toBe("test-model");
      expect(result.agent?.temperature).toBe(0.5);
      expect(result.complete?.model).toBe("other-model");
    });

    it("should resolve single inheritance from agent", () => {
      const config: CLIConfig = {
        agent: { model: "base-model", temperature: 0.7 },
        "my-command": { inherits: "agent", system: "custom system" },
      };

      const result = resolveInheritance(config);
      const cmd = result["my-command"] as Record<string, unknown>;

      expect(cmd.model).toBe("base-model");
      expect(cmd.temperature).toBe(0.7);
      expect(cmd.system).toBe("custom system");
      expect(cmd.inherits).toBeUndefined(); // inherits key should be stripped
    });

    it("should resolve single inheritance from complete", () => {
      const config: CLIConfig = {
        complete: { model: "complete-model", "max-tokens": 1000 },
        translate: { inherits: "complete", type: "complete", system: "Translate text" },
      };

      const result = resolveInheritance(config);
      const cmd = result.translate as Record<string, unknown>;

      expect(cmd.model).toBe("complete-model");
      expect(cmd["max-tokens"]).toBe(1000);
      expect(cmd.type).toBe("complete");
      expect(cmd.system).toBe("Translate text");
    });

    it("should override inherited values with own values", () => {
      const config: CLIConfig = {
        agent: { model: "base-model", temperature: 0.7, "max-iterations": 10 },
        "my-command": { inherits: "agent", model: "override-model", temperature: 0.3 },
      };

      const result = resolveInheritance(config);
      const cmd = result["my-command"] as Record<string, unknown>;

      expect(cmd.model).toBe("override-model"); // overridden
      expect(cmd.temperature).toBe(0.3); // overridden
      expect(cmd["max-iterations"]).toBe(10); // inherited
    });

    it("should resolve chain inheritance (a → b → c)", () => {
      const config: CLIConfig = {
        agent: { model: "base-model", temperature: 0.5 },
        "review-base": { inherits: "agent", system: "review system", "max-iterations": 5 },
        "code-review": { inherits: "review-base", system: "code review system" },
      };

      const result = resolveInheritance(config);
      const cmd = result["code-review"] as Record<string, unknown>;

      expect(cmd.model).toBe("base-model"); // from agent
      expect(cmd.temperature).toBe(0.5); // from agent
      expect(cmd["max-iterations"]).toBe(5); // from review-base
      expect(cmd.system).toBe("code review system"); // own value overrides review-base
    });

    it("should resolve multiple inheritance with last-wins", () => {
      const config: CLIConfig = {
        agent: { model: "agent-model", temperature: 0.5 },
        "profile-a": { model: "profile-a-model", system: "system A" },
        "my-command": { inherits: ["agent", "profile-a"], temperature: 0.9 },
      };

      const result = resolveInheritance(config);
      const cmd = result["my-command"] as Record<string, unknown>;

      expect(cmd.model).toBe("profile-a-model"); // profile-a wins (last in list)
      expect(cmd.system).toBe("system A"); // from profile-a
      expect(cmd.temperature).toBe(0.9); // own value overrides all
    });

    it("should replace arrays, not merge them", () => {
      const config: CLIConfig = {
        agent: { gadget: ["base-gadget.ts", "common.ts"] },
        "my-command": { inherits: "agent", gadget: ["my-gadget.ts"] },
      };

      const result = resolveInheritance(config);
      const cmd = result["my-command"] as Record<string, unknown>;

      expect(cmd.gadget).toEqual(["my-gadget.ts"]); // replaced, not merged
    });

    it("should handle inherits as array with single element", () => {
      const config: CLIConfig = {
        agent: { model: "base-model" },
        "my-command": { inherits: ["agent"], system: "test" },
      };

      const result = resolveInheritance(config);
      const cmd = result["my-command"] as Record<string, unknown>;

      expect(cmd.model).toBe("base-model");
      expect(cmd.system).toBe("test");
    });

    it("should handle empty inherits array", () => {
      const config = {
        agent: { model: "base-model" },
        "my-command": { inherits: [], model: "own-model" },
      } as unknown as CLIConfig;

      const result = resolveInheritance(config);
      const cmd = result["my-command"] as Record<string, unknown>;

      expect(cmd.model).toBe("own-model");
    });

    it("should allow inheritance from custom sections", () => {
      const config: CLIConfig = {
        "base-profile": { model: "profile-model", temperature: 0.3 },
        "derived-command": { inherits: "base-profile", system: "derived system" },
      };

      const result = resolveInheritance(config);
      const cmd = result["derived-command"] as Record<string, unknown>;

      expect(cmd.model).toBe("profile-model");
      expect(cmd.temperature).toBe(0.3);
      expect(cmd.system).toBe("derived system");
    });

    it("should allow inheritance from global for logging settings", () => {
      const config: CLIConfig = {
        global: { "log-level": "debug", "log-file": "/tmp/test.log" },
        "my-command": { inherits: "global", model: "test-model" },
      };

      const result = resolveInheritance(config);
      const cmd = result["my-command"] as Record<string, unknown>;

      expect(cmd["log-level"]).toBe("debug");
      expect(cmd["log-file"]).toBe("/tmp/test.log");
      expect(cmd.model).toBe("test-model");
    });

    describe("error handling", () => {
      it("should detect circular inheritance (self-reference)", () => {
        const config = {
          "my-command": { inherits: "my-command", model: "test" },
        } as unknown as CLIConfig;

        expect(() => resolveInheritance(config)).toThrow(ConfigError);
        expect(() => resolveInheritance(config)).toThrow("Circular inheritance detected");
      });

      it("should detect circular inheritance (a → b → a)", () => {
        const config = {
          "command-a": { inherits: "command-b", model: "a" },
          "command-b": { inherits: "command-a", model: "b" },
        } as unknown as CLIConfig;

        expect(() => resolveInheritance(config)).toThrow(ConfigError);
        expect(() => resolveInheritance(config)).toThrow("Circular inheritance detected");
      });

      it("should detect circular inheritance in longer chains", () => {
        const config = {
          "a": { inherits: "b" },
          "b": { inherits: "c" },
          "c": { inherits: "a" },
        } as unknown as CLIConfig;

        expect(() => resolveInheritance(config)).toThrow(ConfigError);
        expect(() => resolveInheritance(config)).toThrow("Circular inheritance detected");
      });

      it("should error on unknown parent section", () => {
        const config = {
          "my-command": { inherits: "nonexistent", model: "test" },
        } as unknown as CLIConfig;

        expect(() => resolveInheritance(config)).toThrow(ConfigError);
        expect(() => resolveInheritance(config)).toThrow("Cannot inherit from unknown section");
      });

      it("should include config path in error message", () => {
        const config = {
          "my-command": { inherits: "nonexistent" },
        } as unknown as CLIConfig;

        try {
          resolveInheritance(config, "/path/to/config.toml");
          expect.unreachable("Should have thrown");
        } catch (error) {
          expect(error).toBeInstanceOf(ConfigError);
          expect((error as ConfigError).message).toContain("/path/to/config.toml");
        }
      });
    });
  });

  describe("validateConfig with inherits", () => {
    it("should accept inherits as string", () => {
      const raw = {
        agent: { model: "test" },
        "my-command": { inherits: "agent" },
      };

      const result = validateConfig(raw);
      const cmd = result["my-command"] as Record<string, unknown>;
      expect(cmd.inherits).toBe("agent");
    });

    it("should accept inherits as array of strings", () => {
      const raw = {
        agent: { model: "test" },
        complete: { model: "test" },
        "my-command": { inherits: ["agent", "complete"] },
      };

      const result = validateConfig(raw);
      const cmd = result["my-command"] as Record<string, unknown>;
      expect(cmd.inherits).toEqual(["agent", "complete"]);
    });

    it("should reject inherits with non-string values", () => {
      const raw = {
        "my-command": { inherits: 123 },
      };

      expect(() => validateConfig(raw)).toThrow(ConfigError);
      expect(() => validateConfig(raw)).toThrow("inherits must be a string or array of strings");
    });

    it("should reject inherits array with non-string elements", () => {
      const raw = {
        "my-command": { inherits: ["valid", 123] },
      };

      expect(() => validateConfig(raw)).toThrow(ConfigError);
      expect(() => validateConfig(raw)).toThrow("[my-command].inherits[1] must be a string");
    });

    it("should accept inherits in agent section", () => {
      const raw = {
        complete: { model: "base" },
        agent: { inherits: "complete", "max-iterations": 10 },
      };

      const result = validateConfig(raw);
      expect(result.agent?.inherits).toBe("complete");
    });

    it("should accept inherits in complete section", () => {
      const raw = {
        agent: { model: "base" },
        complete: { inherits: "agent", "max-tokens": 1000 },
      };

      const result = validateConfig(raw);
      expect(result.complete?.inherits).toBe("agent");
    });
  });

  describe("validateConfig with prompts", () => {
    it("should accept prompts section with string values", () => {
      const raw = {
        prompts: {
          greeting: "Hello, I am an assistant.",
          expert: "I am an expert in <%= it.field %>.",
        },
      };

      const result = validateConfig(raw);
      expect(result.prompts).toBeDefined();
      expect(result.prompts?.greeting).toBe("Hello, I am an assistant.");
      expect(result.prompts?.expert).toBe("I am an expert in <%= it.field %>.");
    });

    it("should reject prompts with non-string values", () => {
      const raw = {
        prompts: {
          valid: "This is valid",
          invalid: 123,
        },
      };

      expect(() => validateConfig(raw)).toThrow(ConfigError);
      expect(() => validateConfig(raw)).toThrow("[prompts].invalid must be a string");
    });

    it("should reject prompts section that is not a table", () => {
      const raw = {
        prompts: "not a table",
      };

      expect(() => validateConfig(raw)).toThrow(ConfigError);
      expect(() => validateConfig(raw)).toThrow("[prompts] must be a table");
    });
  });

  describe("getCustomCommandNames with prompts", () => {
    it("should exclude prompts section", () => {
      const config: CLIConfig = {
        complete: { model: "test" },
        agent: { model: "test" },
        prompts: { greeting: "Hello" },
        "code-review": { model: "test" },
      };

      const result = getCustomCommandNames(config);
      expect(result).toContain("code-review");
      expect(result).not.toContain("prompts");
      expect(result).not.toContain("complete");
      expect(result).not.toContain("agent");
    });
  });

  describe("resolveTemplatesInConfig", () => {
    it("should pass through config without templates", () => {
      const config: CLIConfig = {
        agent: { model: "test", system: "Plain system prompt" },
        complete: { model: "other" },
      };

      const result = resolveTemplatesInConfig(config);
      expect(result.agent?.system).toBe("Plain system prompt");
    });

    it("should resolve simple variable in system prompt", () => {
      const config: CLIConfig = {
        prompts: {
          greeting: "Hello, I am <%= it.name %>.",
        },
        "my-command": {
          model: "test",
          system: '<%~ include("@greeting", {name: "Assistant"}) %>',
        },
      };

      const result = resolveTemplatesInConfig(config);
      const cmd = result["my-command"] as { system?: string };
      expect(cmd.system).toBe("Hello, I am Assistant.");
    });

    it("should resolve include without params", () => {
      const config: CLIConfig = {
        prompts: {
          base: "You are a helpful assistant.",
        },
        agent: {
          model: "test",
          system: '<%~ include("@base") %> Be concise.',
        },
      };

      const result = resolveTemplatesInConfig(config);
      expect(result.agent?.system).toBe("You are a helpful assistant. Be concise.");
    });

    it("should resolve nested includes", () => {
      const config: CLIConfig = {
        prompts: {
          base: "Base prompt.",
          middle: '<%~ include("@base") %> Middle.',
          top: '<%~ include("@middle") %> Top.',
        },
        "my-command": {
          model: "test",
          system: '<%~ include("@top") %>',
        },
      };

      const result = resolveTemplatesInConfig(config);
      const cmd = result["my-command"] as { system?: string };
      expect(cmd.system).toBe("Base prompt. Middle. Top.");
    });

    it("should preserve non-template system prompts", () => {
      const config: CLIConfig = {
        prompts: {
          base: "Base prompt.",
        },
        agent: {
          model: "test",
          system: "Plain prompt without templates",
        },
        "my-command": {
          model: "test",
          system: '<%~ include("@base") %>',
        },
      };

      const result = resolveTemplatesInConfig(config);
      expect(result.agent?.system).toBe("Plain prompt without templates");
      const cmd = result["my-command"] as { system?: string };
      expect(cmd.system).toBe("Base prompt.");
    });

    it("should handle config with no prompts section but template syntax", () => {
      const config: CLIConfig = {
        agent: {
          model: "test",
          system: "Hello <%= it.name %>",
        },
      };

      // Should work - just renders the template with empty context
      const result = resolveTemplatesInConfig(config);
      expect(result.agent?.system).toBe("Hello undefined");
    });

    describe("environment variables", () => {
      const originalEnv = { ...process.env };

      beforeEach(() => {
        process.env.TEST_USER = "TestUser";
        process.env.TEST_ROLE = "Developer";
      });

      afterEach(() => {
        process.env = { ...originalEnv };
      });

      it("should resolve environment variables in prompts", () => {
        const config: CLIConfig = {
          prompts: {
            greeting: "Hello <%= it.env.TEST_USER %>!",
          },
          "my-command": {
            model: "test",
            system: '<%~ include("@greeting") %>',
          },
        };

        const result = resolveTemplatesInConfig(config);
        const cmd = result["my-command"] as { system?: string };
        expect(cmd.system).toBe("Hello TestUser!");
      });

      it("should resolve environment variables in system prompts directly", () => {
        const config: CLIConfig = {
          prompts: {},
          agent: {
            model: "test",
            system: "Welcome <%= it.env.TEST_USER %>, role: <%= it.env.TEST_ROLE %>",
          },
        };

        const result = resolveTemplatesInConfig(config);
        expect(result.agent?.system).toBe("Welcome TestUser, role: Developer");
      });

      it("should error on missing environment variable in prompts", () => {
        const config: CLIConfig = {
          prompts: {
            greeting: "Hello <%= it.env.NONEXISTENT_VAR %>!",
          },
          "my-command": {
            model: "test",
            system: '<%~ include("@greeting") %>',
          },
        };

        expect(() => resolveTemplatesInConfig(config, "/test/config.toml")).toThrow(ConfigError);
        expect(() => resolveTemplatesInConfig(config)).toThrow("NONEXISTENT_VAR");
      });

      it("should error on missing environment variable in system prompt", () => {
        const config: CLIConfig = {
          prompts: {},
          agent: {
            model: "test",
            system: "Hello <%= it.env.NONEXISTENT_VAR %>!",
          },
        };

        expect(() => resolveTemplatesInConfig(config)).toThrow(ConfigError);
        expect(() => resolveTemplatesInConfig(config)).toThrow("NONEXISTENT_VAR");
      });
    });

    describe("error handling", () => {
      it("should error on invalid template syntax in prompts", () => {
        const config: CLIConfig = {
          prompts: {
            bad: "<% if (true { %>",
          },
        };

        expect(() => resolveTemplatesInConfig(config)).toThrow(ConfigError);
      });

      it("should error on missing include reference", () => {
        const config: CLIConfig = {
          prompts: {
            base: '<%~ include("@nonexistent") %>',
          },
        };

        expect(() => resolveTemplatesInConfig(config)).toThrow(ConfigError);
      });

      it("should error on missing include in system prompt", () => {
        const config: CLIConfig = {
          prompts: {},
          agent: {
            model: "test",
            system: '<%~ include("@nonexistent") %>',
          },
        };

        expect(() => resolveTemplatesInConfig(config)).toThrow(ConfigError);
      });

      it("should include section name in error for system prompt issues", () => {
        const config: CLIConfig = {
          prompts: {},
          "my-bad-command": {
            model: "test",
            system: '<%~ include("@missing") %>',
          },
        };

        try {
          resolveTemplatesInConfig(config, "/test/config.toml");
          expect.unreachable("Should have thrown");
        } catch (error) {
          expect(error).toBeInstanceOf(ConfigError);
          expect((error as ConfigError).message).toContain("my-bad-command");
        }
      });
    });
  });
});
