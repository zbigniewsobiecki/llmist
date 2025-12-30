import { describe, expect, it } from "vitest";
import { ModelIdentifierParser } from "./options.js";

describe("ModelIdentifierParser", () => {
  describe("parse", () => {
    it("should parse provider:model format", () => {
      const parser = new ModelIdentifierParser();
      const result = parser.parse("openai:gpt-4o");

      expect(result.provider).toBe("openai");
      expect(result.name).toBe("gpt-4o");
    });

    it("should use default provider when no separator", () => {
      const parser = new ModelIdentifierParser("openai");
      const result = parser.parse("gpt-4o");

      expect(result.provider).toBe("openai");
      expect(result.name).toBe("gpt-4o");
    });

    it("should use custom default provider", () => {
      const parser = new ModelIdentifierParser("anthropic");
      const result = parser.parse("claude-3-opus");

      expect(result.provider).toBe("anthropic");
      expect(result.name).toBe("claude-3-opus");
    });

    it("should handle multiple colons (provider:model:variant)", () => {
      const parser = new ModelIdentifierParser();
      const result = parser.parse("openai:gpt-4:turbo:latest");

      expect(result.provider).toBe("openai");
      expect(result.name).toBe("gpt-4:turbo:latest");
    });

    it("should handle model names with colons", () => {
      const parser = new ModelIdentifierParser();
      const result = parser.parse("anthropic:claude-3:5-sonnet");

      expect(result.provider).toBe("anthropic");
      expect(result.name).toBe("claude-3:5-sonnet");
    });

    it("should throw for empty identifier", () => {
      const parser = new ModelIdentifierParser();

      expect(() => parser.parse("")).toThrow("cannot be empty");
    });

    it("should throw for whitespace-only identifier", () => {
      const parser = new ModelIdentifierParser();

      expect(() => parser.parse("   ")).toThrow("cannot be empty");
    });

    it("should throw for empty model name after separator", () => {
      const parser = new ModelIdentifierParser();

      expect(() => parser.parse("openai:")).toThrow("Model name cannot be empty");
    });

    it("should trim whitespace", () => {
      const parser = new ModelIdentifierParser();
      const result = parser.parse("  openai:gpt-4o  ");

      expect(result.provider).toBe("openai");
      expect(result.name).toBe("gpt-4o");
    });

    it("should handle provider-only with default", () => {
      const parser = new ModelIdentifierParser("openai");
      const result = parser.parse("claude-3-opus");

      expect(result.provider).toBe("openai");
      expect(result.name).toBe("claude-3-opus");
    });

    it("should handle various provider names", () => {
      const parser = new ModelIdentifierParser();

      expect(parser.parse("anthropic:claude").provider).toBe("anthropic");
      expect(parser.parse("google:gemini").provider).toBe("google");
      expect(parser.parse("mock:test").provider).toBe("mock");
      expect(parser.parse("custom-provider:model").provider).toBe("custom-provider");
    });

    it("should preserve model name case", () => {
      const parser = new ModelIdentifierParser();
      const result = parser.parse("openai:GPT-4o-Mini");

      expect(result.name).toBe("GPT-4o-Mini");
    });

    it("should preserve provider name case", () => {
      const parser = new ModelIdentifierParser();
      const result = parser.parse("OpenAI:gpt-4o");

      expect(result.provider).toBe("OpenAI");
    });
  });
});
