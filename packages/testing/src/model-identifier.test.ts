import { describe, expect, it } from "bun:test";

import { ModelIdentifierParser } from "llmist";

describe("ModelIdentifierParser", () => {
  it("parses provider prefixes", () => {
    const parser = new ModelIdentifierParser();
    expect(parser.parse("openai:gpt-5-nano")).toEqual({ provider: "openai", name: "gpt-5-nano" });
  });

  it("uses default provider when missing prefix", () => {
    const parser = new ModelIdentifierParser("anthropic");
    expect(parser.parse("claude-3")).toEqual({ provider: "anthropic", name: "claude-3" });
  });

  it("throws on empty identifier", () => {
    const parser = new ModelIdentifierParser();
    expect(() => parser.parse("  ")).toThrowError("Model identifier cannot be empty");
  });

  it("parses any provider (extensible)", () => {
    const parser = new ModelIdentifierParser();
    expect(parser.parse("foo:bar")).toEqual({ provider: "foo", name: "bar" });
  });
});
