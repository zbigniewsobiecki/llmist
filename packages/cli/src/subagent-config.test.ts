import type { SubagentConfigMap } from "llmist";
import { describe, expect, it } from "vitest";
import type { GlobalSubagentConfig } from "./subagent-config.js";
import { buildSubagentConfigMap, INHERIT_MODEL, resolveSubagentConfig } from "./subagent-config.js";

// ─────────────────────────────────────────────────────────────────────────────
// resolveSubagentConfig
// ─────────────────────────────────────────────────────────────────────────────

describe("subagent-config", () => {
  describe("resolveSubagentConfig", () => {
    describe("priority chain: profile > global > default-model > inherit", () => {
      it("returns inherited parentModel when no config provided", () => {
        const result = resolveSubagentConfig("BrowseWeb", "gemini-2.5-flash");
        expect(result.model).toBe("gemini-2.5-flash");
      });

      it("uses global default-model when no subagent-specific config exists", () => {
        const globalConfig: GlobalSubagentConfig = { "default-model": "gpt-4o" };
        const result = resolveSubagentConfig(
          "BrowseWeb",
          "gemini-2.5-flash",
          undefined,
          globalConfig,
        );
        expect(result.model).toBe("gpt-4o");
      });

      it("uses global subagent model over global default-model", () => {
        const globalConfig: GlobalSubagentConfig = {
          "default-model": "gpt-4o",
          BrowseWeb: { model: "claude-3-5-haiku-20241022" },
        };
        const result = resolveSubagentConfig(
          "BrowseWeb",
          "gemini-2.5-flash",
          undefined,
          globalConfig,
        );
        expect(result.model).toBe("claude-3-5-haiku-20241022");
      });

      it("uses profile subagent model over global subagent model", () => {
        const globalConfig: GlobalSubagentConfig = {
          BrowseWeb: { model: "gpt-4o" },
        };
        const profileConfig: SubagentConfigMap = {
          BrowseWeb: { model: "claude-3-5-sonnet-20241022" },
        };
        const result = resolveSubagentConfig(
          "BrowseWeb",
          "gemini-2.5-flash",
          profileConfig,
          globalConfig,
        );
        expect(result.model).toBe("claude-3-5-sonnet-20241022");
      });

      it("uses profile subagent model over global default-model", () => {
        const globalConfig: GlobalSubagentConfig = { "default-model": "gpt-4o" };
        const profileConfig: SubagentConfigMap = {
          BrowseWeb: { model: "claude-3-5-haiku-20241022" },
        };
        const result = resolveSubagentConfig(
          "BrowseWeb",
          "gemini-2.5-flash",
          profileConfig,
          globalConfig,
        );
        expect(result.model).toBe("claude-3-5-haiku-20241022");
      });

      it("falls back to INHERIT_MODEL constant (parentModel) when nothing is configured", () => {
        const result = resolveSubagentConfig("BrowseWeb", "claude-opus-4");
        expect(result.model).toBe("claude-opus-4");
      });
    });

    describe("model inheritance with 'inherit' keyword", () => {
      it("resolves 'inherit' in global subagent config to parentModel", () => {
        const globalConfig: GlobalSubagentConfig = {
          BrowseWeb: { model: INHERIT_MODEL },
        };
        const result = resolveSubagentConfig(
          "BrowseWeb",
          "gemini-2.5-flash",
          undefined,
          globalConfig,
        );
        expect(result.model).toBe("gemini-2.5-flash");
      });

      it("resolves 'inherit' in profile subagent config to parentModel", () => {
        const profileConfig: SubagentConfigMap = {
          BrowseWeb: { model: INHERIT_MODEL },
        };
        const result = resolveSubagentConfig("BrowseWeb", "gpt-4o", profileConfig, undefined);
        expect(result.model).toBe("gpt-4o");
      });

      it("resolves 'inherit' in global default-model to parentModel", () => {
        const globalConfig: GlobalSubagentConfig = {
          "default-model": INHERIT_MODEL,
        };
        const result = resolveSubagentConfig(
          "BrowseWeb",
          "claude-3-5-sonnet-20241022",
          undefined,
          globalConfig,
        );
        expect(result.model).toBe("claude-3-5-sonnet-20241022");
      });

      it("does not set 'inherit' literally as the model value", () => {
        const result = resolveSubagentConfig("BrowseWeb", "sonnet");
        expect(result.model).not.toBe(INHERIT_MODEL);
      });
    });

    describe("config merging: profile overrides global", () => {
      it("merges extra options from global config when profile has none", () => {
        const globalConfig: GlobalSubagentConfig = {
          BrowseWeb: { model: "gpt-4o", maxIterations: 20, headless: true },
        };
        const result = resolveSubagentConfig("BrowseWeb", "parent-model", undefined, globalConfig);
        expect(result.maxIterations).toBe(20);
        expect(result.headless).toBe(true);
      });

      it("profile config overrides global config options", () => {
        const globalConfig: GlobalSubagentConfig = {
          BrowseWeb: { model: "gpt-4o", maxIterations: 10 },
        };
        const profileConfig: SubagentConfigMap = {
          BrowseWeb: { maxIterations: 30 },
        };
        const result = resolveSubagentConfig(
          "BrowseWeb",
          "parent-model",
          profileConfig,
          globalConfig,
        );
        expect(result.maxIterations).toBe(30);
      });

      it("merges non-overlapping options from both global and profile", () => {
        const globalConfig: GlobalSubagentConfig = {
          BrowseWeb: { model: "gpt-4o", headless: true },
        };
        const profileConfig: SubagentConfigMap = {
          BrowseWeb: { maxIterations: 30 },
        };
        const result = resolveSubagentConfig(
          "BrowseWeb",
          "parent-model",
          profileConfig,
          globalConfig,
        );
        expect(result.headless).toBe(true);
        expect(result.maxIterations).toBe(30);
      });

      it("profile model overrides global model but all other global options are kept", () => {
        const globalConfig: GlobalSubagentConfig = {
          BrowseWeb: { model: "gpt-4o", maxIterations: 20, headless: true },
        };
        const profileConfig: SubagentConfigMap = {
          BrowseWeb: { maxIterations: 30 },
        };
        const result = resolveSubagentConfig(
          "BrowseWeb",
          "gemini-2.5-flash",
          profileConfig,
          globalConfig,
        );
        // model comes from globalConfig since profile didn't override it
        expect(result.model).toBe("gpt-4o");
        // profile overrides global maxIterations
        expect(result.maxIterations).toBe(30);
        // global headless is retained
        expect(result.headless).toBe(true);
      });

      it("does not include 'model' key again in extra options when it comes from config", () => {
        const globalConfig: GlobalSubagentConfig = {
          BrowseWeb: { model: "gpt-4o" },
        };
        const result = resolveSubagentConfig("BrowseWeb", "parent-model", undefined, globalConfig);
        // model should be resolved exactly once (no duplication)
        expect(result.model).toBe("gpt-4o");
        // count keys named 'model' in the result
        const modelCount = Object.keys(result).filter((k) => k === "model").length;
        expect(modelCount).toBe(1);
      });
    });

    describe("edge cases", () => {
      it("returns empty model resolved to parentModel when both configs are undefined", () => {
        const result = resolveSubagentConfig("MyAgent", "fallback-model", undefined, undefined);
        expect(result.model).toBe("fallback-model");
      });

      it("returns only model field when both configs are empty objects", () => {
        const result = resolveSubagentConfig("MyAgent", "fallback-model", {}, {});
        expect(result.model).toBe("fallback-model");
      });

      it("ignores non-object values in globalConfig (like default-model string)", () => {
        const globalConfig: GlobalSubagentConfig = {
          "default-model": "gpt-4o",
          BrowseWeb: { maxIterations: 5 },
        };
        // Should not throw; the "default-model" string value is handled gracefully
        expect(() =>
          resolveSubagentConfig("BrowseWeb", "parent-model", undefined, globalConfig),
        ).not.toThrow();
      });

      it("handles subagent not present in either config", () => {
        const globalConfig: GlobalSubagentConfig = {
          OtherAgent: { model: "gpt-4o" },
        };
        const profileConfig: SubagentConfigMap = {
          AnotherAgent: { model: "sonnet" },
        };
        const result = resolveSubagentConfig(
          "UnknownAgent",
          "default-model",
          profileConfig,
          globalConfig,
        );
        expect(result.model).toBe("default-model");
      });

      it("handles subagent name matching 'default-model' key — does not extract string", () => {
        // 'default-model' is a string, not an object — extractSubagentConfig should return {}
        const globalConfig: GlobalSubagentConfig = {
          "default-model": "gpt-4o",
        };
        // Requesting config for a subagent that does not exist in globalConfig
        const result = resolveSubagentConfig(
          "default-model",
          "parent-model",
          undefined,
          globalConfig,
        );
        // Since 'default-model' value is a string not an object, subagent config should be empty
        // but the globalDefaultModel "gpt-4o" should be used
        expect(result.model).toBe("gpt-4o");
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // buildSubagentConfigMap
  // ─────────────────────────────────────────────────────────────────────────────

  describe("buildSubagentConfigMap", () => {
    it("returns empty map when both configs are undefined", () => {
      const result = buildSubagentConfigMap("parent-model", undefined, undefined);
      expect(result).toEqual({});
    });

    it("returns empty map when both configs are empty objects", () => {
      const result = buildSubagentConfigMap("parent-model", {}, {});
      expect(result).toEqual({});
    });

    it("collects subagent names from globalConfig", () => {
      const globalConfig: GlobalSubagentConfig = {
        BrowseWeb: { model: "gpt-4o" },
        RunCode: { model: "claude-haiku" },
      };
      const result = buildSubagentConfigMap("parent-model", undefined, globalConfig);
      expect(Object.keys(result)).toContain("BrowseWeb");
      expect(Object.keys(result)).toContain("RunCode");
    });

    it("collects subagent names from profileConfig", () => {
      const profileConfig: SubagentConfigMap = {
        BrowseWeb: { model: "gpt-4o" },
        Summarize: { model: "claude-haiku" },
      };
      const result = buildSubagentConfigMap("parent-model", profileConfig, undefined);
      expect(Object.keys(result)).toContain("BrowseWeb");
      expect(Object.keys(result)).toContain("Summarize");
    });

    it("collects subagent names from both globalConfig and profileConfig (union)", () => {
      const globalConfig: GlobalSubagentConfig = {
        BrowseWeb: { model: "gpt-4o" },
      };
      const profileConfig: SubagentConfigMap = {
        RunCode: { model: "sonnet" },
      };
      const result = buildSubagentConfigMap("parent-model", profileConfig, globalConfig);
      expect(Object.keys(result)).toContain("BrowseWeb");
      expect(Object.keys(result)).toContain("RunCode");
    });

    it("does not include 'default-model' as a subagent name", () => {
      const globalConfig: GlobalSubagentConfig = {
        "default-model": "gpt-4o",
        BrowseWeb: { model: "sonnet" },
      };
      const result = buildSubagentConfigMap("parent-model", undefined, globalConfig);
      expect(Object.keys(result)).not.toContain("default-model");
    });

    it("skips non-object values in globalConfig", () => {
      const globalConfig: GlobalSubagentConfig = {
        "default-model": "gpt-4o",
        // string values (not SubagentConfig objects) should be ignored as subagent names
        BrowseWeb: { model: "sonnet" },
      };
      const result = buildSubagentConfigMap("parent-model", undefined, globalConfig);
      expect(Object.keys(result)).toHaveLength(1);
      expect(Object.keys(result)).toContain("BrowseWeb");
    });

    it("resolves each subagent using resolveSubagentConfig logic", () => {
      const globalConfig: GlobalSubagentConfig = {
        "default-model": "gpt-4o",
        BrowseWeb: { maxIterations: 10 },
      };
      const profileConfig: SubagentConfigMap = {
        BrowseWeb: { maxIterations: 20 },
      };
      const result = buildSubagentConfigMap("parent-model", profileConfig, globalConfig);
      // model comes from globalConfig default-model
      expect(result.BrowseWeb.model).toBe("gpt-4o");
      // maxIterations overridden by profileConfig
      expect(result.BrowseWeb.maxIterations).toBe(20);
    });

    it("deduplicates subagent names that appear in both configs", () => {
      const globalConfig: GlobalSubagentConfig = {
        BrowseWeb: { model: "gpt-4o" },
      };
      const profileConfig: SubagentConfigMap = {
        BrowseWeb: { model: "sonnet" },
      };
      const result = buildSubagentConfigMap("parent-model", profileConfig, globalConfig);
      // Should appear only once in the result
      expect(Object.keys(result).filter((k) => k === "BrowseWeb")).toHaveLength(1);
      // profile model wins
      expect(result.BrowseWeb.model).toBe("sonnet");
    });

    it("resolves 'inherit' model in subagent to parentModel", () => {
      const globalConfig: GlobalSubagentConfig = {
        BrowseWeb: { model: INHERIT_MODEL },
      };
      const result = buildSubagentConfigMap("claude-opus-4", undefined, globalConfig);
      expect(result.BrowseWeb.model).toBe("claude-opus-4");
    });

    it("returns correct model for each subagent independently", () => {
      const globalConfig: GlobalSubagentConfig = {
        BrowseWeb: { model: "gpt-4o" },
        RunCode: { model: INHERIT_MODEL },
      };
      const result = buildSubagentConfigMap("gemini-flash", undefined, globalConfig);
      expect(result.BrowseWeb.model).toBe("gpt-4o");
      expect(result.RunCode.model).toBe("gemini-flash");
    });
  });
});
