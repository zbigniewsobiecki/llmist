import { describe, expect, it } from "vitest";
import { createMockClient } from "../../../testing/src/index.js";
import type { CachingConfig } from "../core/options.js";
import { AgentBuilder } from "./builder.js";

describe("AgentBuilder caching API", () => {
  describe("withCaching", () => {
    it("returns this for chaining", () => {
      const builder = new AgentBuilder();
      const result = builder.withCaching();

      expect(result).toBe(builder);
    });

    it("defaults to enabled when called with no args", () => {
      const builder = new AgentBuilder();
      builder.withCaching();

      const config = (builder as unknown as { cachingConfig: CachingConfig }).cachingConfig;

      expect(config.enabled).toBe(true);
    });

    it("accepts a full CachingConfig object", () => {
      const builder = new AgentBuilder();
      builder.withCaching({ enabled: true, scope: "system", ttl: "7200s" });

      const config = (builder as unknown as { cachingConfig: CachingConfig }).cachingConfig;

      expect(config.enabled).toBe(true);
      expect(config.scope).toBe("system");
      expect(config.ttl).toBe("7200s");
    });

    it("accepts config with minTokenThreshold", () => {
      const builder = new AgentBuilder();
      builder.withCaching({ enabled: true, minTokenThreshold: 16384 });

      const config = (builder as unknown as { cachingConfig: CachingConfig }).cachingConfig;

      expect(config.enabled).toBe(true);
      expect(config.minTokenThreshold).toBe(16384);
    });

    it("chains correctly with other builder methods", () => {
      const builder = new AgentBuilder();
      const result = builder
        .withModel("gemini:gemini-2.5-flash")
        .withCaching({ enabled: true, scope: "conversation" })
        .withSystem("You are helpful")
        .withMaxIterations(10);

      expect(result).toBe(builder);
    });

    it("overrides previous withCaching call", () => {
      const builder = new AgentBuilder();
      builder.withCaching({ enabled: true, scope: "system" });
      builder.withCaching({ enabled: true, scope: "conversation" });

      const config = (builder as unknown as { cachingConfig: CachingConfig }).cachingConfig;

      expect(config.scope).toBe("conversation");
    });
  });

  describe("withoutCaching", () => {
    it("returns this for chaining", () => {
      const builder = new AgentBuilder();
      const result = builder.withoutCaching();

      expect(result).toBe(builder);
    });

    it("disables caching", () => {
      const builder = new AgentBuilder();
      builder.withoutCaching();

      const config = (builder as unknown as { cachingConfig: CachingConfig }).cachingConfig;

      expect(config.enabled).toBe(false);
    });

    it("overrides previous withCaching call", () => {
      const builder = new AgentBuilder();
      builder.withCaching({ enabled: true, scope: "system" });
      builder.withoutCaching();

      const config = (builder as unknown as { cachingConfig: CachingConfig }).cachingConfig;

      expect(config.enabled).toBe(false);
    });

    it("chains correctly with other builder methods", () => {
      const builder = new AgentBuilder();
      const result = builder.withModel("sonnet").withoutCaching().withMaxIterations(5);

      expect(result).toBe(builder);
    });
  });

  describe("caching config wiring to AgentOptions", () => {
    it("passes caching config through to the agent via build()", () => {
      const mockClient = createMockClient();
      const builder = new AgentBuilder(mockClient);
      builder.withModel("mock:test").withCaching({ enabled: true, scope: "system" });

      const agent = builder.build();
      expect(agent).toBeDefined();
    });

    it("passes caching config through to the agent via ask()", () => {
      const mockClient = createMockClient();
      const builder = new AgentBuilder(mockClient);
      const agent = builder
        .withModel("mock:test")
        .withCaching({ enabled: true, scope: "conversation" })
        .ask("Test");

      expect(agent).toBeDefined();
    });

    it("passes withoutCaching config through build()", () => {
      const mockClient = createMockClient();
      const builder = new AgentBuilder(mockClient);
      builder.withModel("mock:test").withoutCaching();

      const agent = builder.build();
      expect(agent).toBeDefined();
    });
  });

  describe("full integration", () => {
    it("builds a complete configuration chain with caching", () => {
      const builder = new AgentBuilder();

      const result = builder
        .withModel("gemini:gemini-2.5-pro")
        .withSystem("You are a code analyzer")
        .withCaching({ enabled: true, scope: "system", ttl: "3600s" })
        .withReasoning("high")
        .withMaxIterations(20)
        .withRetry({ retries: 3 });

      expect(result).toBe(builder);
    });

    it("builds config with withoutCaching in chain", () => {
      const builder = new AgentBuilder();

      const result = builder
        .withModel("sonnet")
        .withSystem("You are helpful")
        .withoutCaching()
        .withTemperature(0.7)
        .withMaxIterations(10);

      expect(result).toBe(builder);
    });

    it("caching and reasoning can be combined", () => {
      const builder = new AgentBuilder();

      const result = builder
        .withModel("gemini:gemini-2.5-flash")
        .withCaching({ enabled: true, scope: "conversation" })
        .withReasoning("medium")
        .withCompaction({ enabled: true });

      expect(result).toBe(builder);
    });
  });
});
