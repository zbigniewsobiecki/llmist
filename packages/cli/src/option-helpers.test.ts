import { describe, expect, it } from "vitest";
import type { CustomCommandConfig } from "./config-types.js";
import { configToAgentOptions, configToCompleteOptions } from "./option-helpers.js";

// ─────────────────────────────────────────────────────────────────────────────
// configToCompleteOptions
// ─────────────────────────────────────────────────────────────────────────────

describe("configToCompleteOptions", () => {
  describe("kebab-case → camelCase mapping", () => {
    it("maps model as-is (no transformation needed)", () => {
      const config: CustomCommandConfig = { model: "claude-3-5-sonnet-20241022" };
      const result = configToCompleteOptions(config);
      expect(result.model).toBe("claude-3-5-sonnet-20241022");
    });

    it("maps system as-is", () => {
      const config: CustomCommandConfig = { system: "You are a helpful assistant." };
      const result = configToCompleteOptions(config);
      expect(result.system).toBe("You are a helpful assistant.");
    });

    it("maps temperature as-is", () => {
      const config: CustomCommandConfig = { temperature: 0.7 };
      const result = configToCompleteOptions(config);
      expect(result.temperature).toBe(0.7);
    });

    it("maps max-tokens (kebab) → maxTokens (camel)", () => {
      const config: CustomCommandConfig = { "max-tokens": 2048 };
      const result = configToCompleteOptions(config);
      expect(result.maxTokens).toBe(2048);
    });

    it("maps quiet as-is", () => {
      const config: CustomCommandConfig = { quiet: true };
      const result = configToCompleteOptions(config);
      expect(result.quiet).toBe(true);
    });

    it("maps log-llm-requests (kebab) → logLlmRequests (camel)", () => {
      const config: CustomCommandConfig = { "log-llm-requests": true };
      const result = configToCompleteOptions(config);
      expect(result.logLlmRequests).toBe(true);
    });

    it("returns empty object when config has no relevant keys", () => {
      const config: CustomCommandConfig = {};
      const result = configToCompleteOptions(config);
      expect(result).toEqual({});
    });

    it("maps multiple fields simultaneously", () => {
      const config: CustomCommandConfig = {
        model: "gpt-4o",
        temperature: 0.5,
        "max-tokens": 1024,
        quiet: true,
      };
      const result = configToCompleteOptions(config);
      expect(result.model).toBe("gpt-4o");
      expect(result.temperature).toBe(0.5);
      expect(result.maxTokens).toBe(1024);
      expect(result.quiet).toBe(true);
    });
  });

  describe("rate-limit config mapping", () => {
    it("maps requests-per-minute → rateLimitRpm", () => {
      const config: CustomCommandConfig = {
        "rate-limits": { "requests-per-minute": 60 },
      };
      const result = configToCompleteOptions(config);
      expect(result.rateLimitRpm).toBe(60);
    });

    it("maps tokens-per-minute → rateLimitTpm", () => {
      const config: CustomCommandConfig = {
        "rate-limits": { "tokens-per-minute": 100000 },
      };
      const result = configToCompleteOptions(config);
      expect(result.rateLimitTpm).toBe(100000);
    });

    it("maps tokens-per-day → rateLimitDaily", () => {
      const config: CustomCommandConfig = {
        "rate-limits": { "tokens-per-day": 1000000 },
      };
      const result = configToCompleteOptions(config);
      expect(result.rateLimitDaily).toBe(1000000);
    });

    it("maps safety-margin → rateLimitSafetyMargin", () => {
      const config: CustomCommandConfig = {
        "rate-limits": { "safety-margin": 0.1 },
      };
      const result = configToCompleteOptions(config);
      expect(result.rateLimitSafetyMargin).toBe(0.1);
    });

    it("sets rateLimit=false when enabled=false", () => {
      const config: CustomCommandConfig = {
        "rate-limits": { enabled: false },
      };
      const result = configToCompleteOptions(config);
      expect(result.rateLimit).toBe(false);
    });

    it("does not set rateLimit when enabled=true", () => {
      const config: CustomCommandConfig = {
        "rate-limits": { enabled: true },
      };
      const result = configToCompleteOptions(config);
      expect(result.rateLimit).toBeUndefined();
    });

    it("maps all rate-limit fields together", () => {
      const config: CustomCommandConfig = {
        "rate-limits": {
          "requests-per-minute": 30,
          "tokens-per-minute": 50000,
          "tokens-per-day": 500000,
          "safety-margin": 0.05,
        },
      };
      const result = configToCompleteOptions(config);
      expect(result.rateLimitRpm).toBe(30);
      expect(result.rateLimitTpm).toBe(50000);
      expect(result.rateLimitDaily).toBe(500000);
      expect(result.rateLimitSafetyMargin).toBe(0.05);
    });
  });

  describe("retry config mapping", () => {
    it("maps retries → maxRetries", () => {
      const config: CustomCommandConfig = { retry: { retries: 5 } };
      const result = configToCompleteOptions(config);
      expect(result.maxRetries).toBe(5);
    });

    it("maps min-timeout → retryMinTimeout", () => {
      const config: CustomCommandConfig = { retry: { "min-timeout": 1000 } };
      const result = configToCompleteOptions(config);
      expect(result.retryMinTimeout).toBe(1000);
    });

    it("maps max-timeout → retryMaxTimeout", () => {
      const config: CustomCommandConfig = { retry: { "max-timeout": 30000 } };
      const result = configToCompleteOptions(config);
      expect(result.retryMaxTimeout).toBe(30000);
    });

    it("sets retry=false when enabled=false", () => {
      const config: CustomCommandConfig = { retry: { enabled: false } };
      const result = configToCompleteOptions(config);
      expect(result.retry).toBe(false);
    });

    it("does not set retry when enabled=true", () => {
      const config: CustomCommandConfig = { retry: { enabled: true } };
      const result = configToCompleteOptions(config);
      expect(result.retry).toBeUndefined();
    });

    it("maps all retry fields together", () => {
      const config: CustomCommandConfig = {
        retry: { retries: 3, "min-timeout": 500, "max-timeout": 10000 },
      };
      const result = configToCompleteOptions(config);
      expect(result.maxRetries).toBe(3);
      expect(result.retryMinTimeout).toBe(500);
      expect(result.retryMaxTimeout).toBe(10000);
    });
  });

  describe("reasoning config mapping", () => {
    it("passes reasoning config through as profileReasoning", () => {
      const config: CustomCommandConfig = {
        reasoning: { effort: "high" },
      };
      const result = configToCompleteOptions(config);
      expect(result.profileReasoning).toEqual({ effort: "high" });
    });

    it("passes reasoning with budget-tokens as profileReasoning", () => {
      const config: CustomCommandConfig = {
        reasoning: { "budget-tokens": 5000 },
      };
      const result = configToCompleteOptions(config);
      expect(result.profileReasoning).toEqual({ "budget-tokens": 5000 });
    });

    it("passes reasoning enabled=true as profileReasoning", () => {
      const config: CustomCommandConfig = {
        reasoning: { enabled: true },
      };
      const result = configToCompleteOptions(config);
      expect(result.profileReasoning).toEqual({ enabled: true });
    });

    it("passes reasoning enabled=false as profileReasoning", () => {
      const config: CustomCommandConfig = {
        reasoning: { enabled: false },
      };
      const result = configToCompleteOptions(config);
      expect(result.profileReasoning).toEqual({ enabled: false });
    });

    it("does not set profileReasoning when reasoning config is absent", () => {
      const config: CustomCommandConfig = { model: "gpt-4o" };
      const result = configToCompleteOptions(config);
      expect(result.profileReasoning).toBeUndefined();
    });
  });

  describe("undefined fields don't appear in result", () => {
    it("does not include model in result when config.model is undefined", () => {
      const config: CustomCommandConfig = { quiet: true };
      const result = configToCompleteOptions(config);
      expect(Object.hasOwn(result, "model")).toBe(false);
    });

    it("does not include maxTokens in result when config['max-tokens'] is undefined", () => {
      const config: CustomCommandConfig = { model: "gpt-4o" };
      const result = configToCompleteOptions(config);
      expect(Object.hasOwn(result, "maxTokens")).toBe(false);
    });

    it("does not include rateLimitRpm when requests-per-minute is undefined", () => {
      const config: CustomCommandConfig = {
        "rate-limits": { "tokens-per-minute": 1000 },
      };
      const result = configToCompleteOptions(config);
      expect(Object.hasOwn(result, "rateLimitRpm")).toBe(false);
    });

    it("does not include rate-limit fields when rate-limits section is absent", () => {
      const config: CustomCommandConfig = { model: "gpt-4o" };
      const result = configToCompleteOptions(config);
      expect(result.rateLimitRpm).toBeUndefined();
      expect(result.rateLimitTpm).toBeUndefined();
      expect(result.rateLimitDaily).toBeUndefined();
      expect(result.rateLimitSafetyMargin).toBeUndefined();
      expect(result.rateLimit).toBeUndefined();
    });

    it("does not include retry fields when retry section is absent", () => {
      const config: CustomCommandConfig = { model: "gpt-4o" };
      const result = configToCompleteOptions(config);
      expect(result.maxRetries).toBeUndefined();
      expect(result.retryMinTimeout).toBeUndefined();
      expect(result.retryMaxTimeout).toBeUndefined();
      expect(result.retry).toBeUndefined();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// configToAgentOptions
// ─────────────────────────────────────────────────────────────────────────────

describe("configToAgentOptions", () => {
  describe("agent-specific keys", () => {
    it("maps max-iterations (kebab) → maxIterations (camel)", () => {
      const config: CustomCommandConfig = { "max-iterations": 10 };
      const result = configToAgentOptions(config);
      expect(result.maxIterations).toBe(10);
    });

    it("maps budget as-is", () => {
      const config: CustomCommandConfig = { budget: 1.5 };
      const result = configToAgentOptions(config);
      expect(result.budget).toBe(1.5);
    });

    it("maps gadgets (plural) → gadget option", () => {
      const config: CustomCommandConfig = { gadgets: ["ReadFile", "ListDirectory"] };
      const result = configToAgentOptions(config);
      expect(result.gadget).toEqual(["ReadFile", "ListDirectory"]);
    });

    it("maps builtins as-is", () => {
      const config: CustomCommandConfig = { builtins: false };
      const result = configToAgentOptions(config);
      expect(result.builtins).toBe(false);
    });

    it("maps builtin-interaction (kebab) → builtinInteraction (camel)", () => {
      const config: CustomCommandConfig = { "builtin-interaction": false };
      const result = configToAgentOptions(config);
      expect(result.builtinInteraction).toBe(false);
    });

    it("maps gadget-start-prefix (kebab) → gadgetStartPrefix (camel)", () => {
      const config: CustomCommandConfig = { "gadget-start-prefix": "<<<" };
      const result = configToAgentOptions(config);
      expect(result.gadgetStartPrefix).toBe("<<<");
    });

    it("maps gadget-end-prefix (kebab) → gadgetEndPrefix (camel)", () => {
      const config: CustomCommandConfig = { "gadget-end-prefix": ">>>" };
      const result = configToAgentOptions(config);
      expect(result.gadgetEndPrefix).toBe(">>>");
    });

    it("maps gadget-arg-prefix (kebab) → gadgetArgPrefix (camel)", () => {
      const config: CustomCommandConfig = { "gadget-arg-prefix": "--" };
      const result = configToAgentOptions(config);
      expect(result.gadgetArgPrefix).toBe("--");
    });

    it("maps gadget-approval (kebab) → gadgetApproval (camel)", () => {
      const config: CustomCommandConfig = {
        "gadget-approval": { "*": "approval-required" },
      };
      const result = configToAgentOptions(config);
      expect(result.gadgetApproval).toEqual({ "*": "approval-required" });
    });

    it("maps subagents as-is", () => {
      const subagents = { myAgent: { model: "gpt-4o" } };
      const config: CustomCommandConfig = {
        subagents: subagents as CustomCommandConfig["subagents"],
      };
      const result = configToAgentOptions(config);
      expect(result.subagents).toEqual(subagents);
    });

    it("maps initial-gadgets (kebab) → initialGadgets (camel)", () => {
      const initialGadgets = [
        { gadget: "ReadFile", parameters: { path: "/foo.txt" }, result: "content" },
      ];
      const config: CustomCommandConfig = { "initial-gadgets": initialGadgets };
      const result = configToAgentOptions(config);
      expect(result.initialGadgets).toEqual(initialGadgets);
    });

    it("maps show-hints (kebab) → showHints (camel)", () => {
      const config: CustomCommandConfig = { "show-hints": false };
      const result = configToAgentOptions(config);
      expect(result.showHints).toBe(false);
    });
  });

  describe("shared fields (also present in complete options)", () => {
    it("maps model as-is", () => {
      const config: CustomCommandConfig = { model: "claude-3-5-sonnet-20241022" };
      const result = configToAgentOptions(config);
      expect(result.model).toBe("claude-3-5-sonnet-20241022");
    });

    it("maps system as-is", () => {
      const config: CustomCommandConfig = { system: "Be concise." };
      const result = configToAgentOptions(config);
      expect(result.system).toBe("Be concise.");
    });

    it("maps temperature as-is", () => {
      const config: CustomCommandConfig = { temperature: 0.3 };
      const result = configToAgentOptions(config);
      expect(result.temperature).toBe(0.3);
    });

    it("maps quiet as-is", () => {
      const config: CustomCommandConfig = { quiet: true };
      const result = configToAgentOptions(config);
      expect(result.quiet).toBe(true);
    });

    it("maps log-llm-requests (kebab) → logLlmRequests (camel)", () => {
      const config: CustomCommandConfig = { "log-llm-requests": true };
      const result = configToAgentOptions(config);
      expect(result.logLlmRequests).toBe(true);
    });
  });

  describe("rate-limit config mapping", () => {
    it("maps requests-per-minute → rateLimitRpm", () => {
      const config: CustomCommandConfig = {
        "rate-limits": { "requests-per-minute": 120 },
      };
      const result = configToAgentOptions(config);
      expect(result.rateLimitRpm).toBe(120);
    });

    it("maps tokens-per-minute → rateLimitTpm", () => {
      const config: CustomCommandConfig = {
        "rate-limits": { "tokens-per-minute": 200000 },
      };
      const result = configToAgentOptions(config);
      expect(result.rateLimitTpm).toBe(200000);
    });

    it("maps tokens-per-day → rateLimitDaily", () => {
      const config: CustomCommandConfig = {
        "rate-limits": { "tokens-per-day": 2000000 },
      };
      const result = configToAgentOptions(config);
      expect(result.rateLimitDaily).toBe(2000000);
    });

    it("maps safety-margin → rateLimitSafetyMargin", () => {
      const config: CustomCommandConfig = {
        "rate-limits": { "safety-margin": 0.2 },
      };
      const result = configToAgentOptions(config);
      expect(result.rateLimitSafetyMargin).toBe(0.2);
    });

    it("sets rateLimit=false when enabled=false", () => {
      const config: CustomCommandConfig = {
        "rate-limits": { enabled: false },
      };
      const result = configToAgentOptions(config);
      expect(result.rateLimit).toBe(false);
    });

    it("does not set rateLimit when enabled=true", () => {
      const config: CustomCommandConfig = {
        "rate-limits": { enabled: true },
      };
      const result = configToAgentOptions(config);
      expect(result.rateLimit).toBeUndefined();
    });
  });

  describe("retry config mapping", () => {
    it("maps retries → maxRetries", () => {
      const config: CustomCommandConfig = { retry: { retries: 4 } };
      const result = configToAgentOptions(config);
      expect(result.maxRetries).toBe(4);
    });

    it("maps min-timeout → retryMinTimeout", () => {
      const config: CustomCommandConfig = { retry: { "min-timeout": 2000 } };
      const result = configToAgentOptions(config);
      expect(result.retryMinTimeout).toBe(2000);
    });

    it("maps max-timeout → retryMaxTimeout", () => {
      const config: CustomCommandConfig = { retry: { "max-timeout": 60000 } };
      const result = configToAgentOptions(config);
      expect(result.retryMaxTimeout).toBe(60000);
    });

    it("sets retry=false when enabled=false", () => {
      const config: CustomCommandConfig = { retry: { enabled: false } };
      const result = configToAgentOptions(config);
      expect(result.retry).toBe(false);
    });

    it("does not set retry when enabled=true", () => {
      const config: CustomCommandConfig = { retry: { enabled: true } };
      const result = configToAgentOptions(config);
      expect(result.retry).toBeUndefined();
    });

    it("maps all retry fields together", () => {
      const config: CustomCommandConfig = {
        retry: { retries: 3, "min-timeout": 500, "max-timeout": 10000 },
      };
      const result = configToAgentOptions(config);
      expect(result.maxRetries).toBe(3);
      expect(result.retryMinTimeout).toBe(500);
      expect(result.retryMaxTimeout).toBe(10000);
    });
  });

  describe("reasoning config mapping", () => {
    it("passes reasoning effort string as profileReasoning", () => {
      const config: CustomCommandConfig = { reasoning: { effort: "medium" } };
      const result = configToAgentOptions(config);
      expect(result.profileReasoning).toEqual({ effort: "medium" });
    });

    it("passes reasoning enabled boolean as profileReasoning", () => {
      const config: CustomCommandConfig = { reasoning: { enabled: true } };
      const result = configToAgentOptions(config);
      expect(result.profileReasoning).toEqual({ enabled: true });
    });

    it("passes reasoning enabled=false as profileReasoning", () => {
      const config: CustomCommandConfig = { reasoning: { enabled: false } };
      const result = configToAgentOptions(config);
      expect(result.profileReasoning).toEqual({ enabled: false });
    });

    it("passes reasoning with budget-tokens as profileReasoning", () => {
      const config: CustomCommandConfig = {
        reasoning: { effort: "high", "budget-tokens": 8000 },
      };
      const result = configToAgentOptions(config);
      expect(result.profileReasoning).toEqual({ effort: "high", "budget-tokens": 8000 });
    });

    it("does not set profileReasoning when reasoning config is absent", () => {
      const config: CustomCommandConfig = { model: "gpt-4o" };
      const result = configToAgentOptions(config);
      expect(result.profileReasoning).toBeUndefined();
    });
  });

  describe("undefined fields don't appear in result", () => {
    it("does not include maxIterations when config['max-iterations'] is undefined", () => {
      const config: CustomCommandConfig = { model: "gpt-4o" };
      const result = configToAgentOptions(config);
      expect(Object.hasOwn(result, "maxIterations")).toBe(false);
    });

    it("does not include gadget when neither gadgets nor gadget is defined", () => {
      const config: CustomCommandConfig = { model: "gpt-4o" };
      const result = configToAgentOptions(config);
      expect(Object.hasOwn(result, "gadget")).toBe(false);
    });

    it("does not include builtins when config.builtins is undefined", () => {
      const config: CustomCommandConfig = { model: "gpt-4o" };
      const result = configToAgentOptions(config);
      expect(Object.hasOwn(result, "builtins")).toBe(false);
    });

    it("does not include showHints when show-hints is undefined", () => {
      const config: CustomCommandConfig = { model: "gpt-4o" };
      const result = configToAgentOptions(config);
      expect(Object.hasOwn(result, "showHints")).toBe(false);
    });

    it("does not include rate-limit fields when rate-limits section is absent", () => {
      const config: CustomCommandConfig = { model: "gpt-4o" };
      const result = configToAgentOptions(config);
      expect(result.rateLimitRpm).toBeUndefined();
      expect(result.rateLimitTpm).toBeUndefined();
      expect(result.rateLimitDaily).toBeUndefined();
      expect(result.rateLimitSafetyMargin).toBeUndefined();
      expect(result.rateLimit).toBeUndefined();
    });

    it("does not include retry fields when retry section is absent", () => {
      const config: CustomCommandConfig = { model: "gpt-4o" };
      const result = configToAgentOptions(config);
      expect(result.maxRetries).toBeUndefined();
      expect(result.retryMinTimeout).toBeUndefined();
      expect(result.retryMaxTimeout).toBeUndefined();
      expect(result.retry).toBeUndefined();
    });

    it("returns empty object when config has no relevant keys", () => {
      const config: CustomCommandConfig = {};
      const result = configToAgentOptions(config);
      expect(result).toEqual({});
    });
  });
});
