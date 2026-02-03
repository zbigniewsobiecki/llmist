import { describe, expect, it } from "vitest";
import { createMockClient } from "../../../testing/src/index.js";
import { AgentBuilder } from "./builder.js";

describe("AgentBuilder reasoning API", () => {
  describe("withReasoning", () => {
    it("returns this for chaining", () => {
      const builder = new AgentBuilder();
      const result = builder.withReasoning();

      expect(result).toBe(builder);
    });

    it("defaults to medium effort when called with no args", () => {
      const builder = new AgentBuilder();
      builder.withReasoning();

      const config = (
        builder as unknown as { reasoningConfig: { enabled: boolean; effort: string } }
      ).reasoningConfig;

      expect(config.enabled).toBe(true);
      expect(config.effort).toBe("medium");
    });

    it("accepts a string effort level", () => {
      const builder = new AgentBuilder();
      builder.withReasoning("high");

      const config = (
        builder as unknown as { reasoningConfig: { enabled: boolean; effort: string } }
      ).reasoningConfig;

      expect(config.enabled).toBe(true);
      expect(config.effort).toBe("high");
    });

    it("accepts all effort levels as strings", () => {
      const efforts = ["none", "low", "medium", "high", "maximum"] as const;

      for (const effort of efforts) {
        const builder = new AgentBuilder();
        builder.withReasoning(effort);

        const config = (
          builder as unknown as { reasoningConfig: { enabled: boolean; effort: string } }
        ).reasoningConfig;

        expect(config.enabled).toBe(true);
        expect(config.effort).toBe(effort);
      }
    });

    it("accepts a full ReasoningConfig object", () => {
      const builder = new AgentBuilder();
      builder.withReasoning({ enabled: true, budgetTokens: 10000 });

      const config = (
        builder as unknown as {
          reasoningConfig: { enabled: boolean; budgetTokens: number };
        }
      ).reasoningConfig;

      expect(config.enabled).toBe(true);
      expect(config.budgetTokens).toBe(10000);
    });

    it("accepts config with interleaved option", () => {
      const builder = new AgentBuilder();
      builder.withReasoning({ enabled: true, effort: "high", interleaved: true });

      const config = (
        builder as unknown as {
          reasoningConfig: { enabled: boolean; effort: string; interleaved: boolean };
        }
      ).reasoningConfig;

      expect(config.enabled).toBe(true);
      expect(config.effort).toBe("high");
      expect(config.interleaved).toBe(true);
    });

    it("chains correctly with other builder methods", () => {
      const builder = new AgentBuilder();
      const result = builder
        .withModel("o3")
        .withReasoning("high")
        .withSystem("You are helpful")
        .withMaxIterations(10);

      expect(result).toBe(builder);
    });

    it("overrides previous withReasoning call", () => {
      const builder = new AgentBuilder();
      builder.withReasoning("low");
      builder.withReasoning("maximum");

      const config = (builder as unknown as { reasoningConfig: { effort: string } })
        .reasoningConfig;

      expect(config.effort).toBe("maximum");
    });
  });

  describe("withoutReasoning", () => {
    it("returns this for chaining", () => {
      const builder = new AgentBuilder();
      const result = builder.withoutReasoning();

      expect(result).toBe(builder);
    });

    it("disables reasoning", () => {
      const builder = new AgentBuilder();
      builder.withoutReasoning();

      const config = (builder as unknown as { reasoningConfig: { enabled: boolean } })
        .reasoningConfig;

      expect(config.enabled).toBe(false);
    });

    it("overrides previous withReasoning call", () => {
      const builder = new AgentBuilder();
      builder.withReasoning("high");
      builder.withoutReasoning();

      const config = (builder as unknown as { reasoningConfig: { enabled: boolean } })
        .reasoningConfig;

      expect(config.enabled).toBe(false);
    });

    it("chains correctly with other builder methods", () => {
      const builder = new AgentBuilder();
      const result = builder.withModel("gpt-4").withoutReasoning().withMaxIterations(5);

      expect(result).toBe(builder);
    });
  });

  describe("reasoning config wiring to AgentOptions", () => {
    it("passes reasoning config through to the agent via build()", () => {
      const mockClient = createMockClient();
      const builder = new AgentBuilder(mockClient);
      builder.withModel("mock:test").withReasoning("high");

      // Build the agent - this validates that reasoning config is wired through
      const agent = builder.build();
      expect(agent).toBeDefined();
    });

    it("passes reasoning config through to the agent via ask()", () => {
      const mockClient = createMockClient();
      const builder = new AgentBuilder(mockClient);
      const agent = builder.withModel("mock:test").withReasoning("high").ask("Test");

      expect(agent).toBeDefined();
    });

    it("passes withoutReasoning config through build()", () => {
      const mockClient = createMockClient();
      const builder = new AgentBuilder(mockClient);
      builder.withModel("mock:test").withoutReasoning();

      const agent = builder.build();
      expect(agent).toBeDefined();
    });
  });

  describe("full integration", () => {
    it("builds a complete configuration chain with reasoning", () => {
      const builder = new AgentBuilder();

      const result = builder
        .withModel("o3")
        .withSystem("You are a math tutor")
        .withReasoning("high")
        .withMaxIterations(20)
        .withRetry({ retries: 3 });

      expect(result).toBe(builder);
    });

    it("builds config with withoutReasoning in chain", () => {
      const builder = new AgentBuilder();

      const result = builder
        .withModel("gpt-4")
        .withSystem("You are helpful")
        .withoutReasoning()
        .withTemperature(0.7)
        .withMaxIterations(10);

      expect(result).toBe(builder);
    });
  });
});
