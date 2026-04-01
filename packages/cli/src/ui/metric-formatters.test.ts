import { describe, expect, it } from "vitest";
import {
  formatCost,
  formatTokens,
  formatTokensLong,
  stripProviderPrefix,
} from "./metric-formatters.js";

describe("formatTokens", () => {
  it("returns number as-is for values below 1000", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(1)).toBe("1");
    expect(formatTokens(500)).toBe("500");
    expect(formatTokens(999)).toBe("999");
  });

  it("formats values >= 1000 with 'k' suffix and 1 decimal", () => {
    expect(formatTokens(1000)).toBe("1.0k");
    expect(formatTokens(1001)).toBe("1.0k");
    expect(formatTokens(1500)).toBe("1.5k");
    expect(formatTokens(11500)).toBe("11.5k");
    expect(formatTokens(100000)).toBe("100.0k");
  });

  it("handles boundary value 999 (no suffix)", () => {
    expect(formatTokens(999)).toBe("999");
  });

  it("handles boundary value 1000 (k suffix)", () => {
    expect(formatTokens(1000)).toBe("1.0k");
  });

  it("handles boundary value 1001 (k suffix)", () => {
    expect(formatTokens(1001)).toBe("1.0k");
  });
});

describe("formatTokensLong", () => {
  it("returns small counts with 'tokens' suffix", () => {
    expect(formatTokensLong(0)).toBe("0 tokens");
    expect(formatTokensLong(1)).toBe("1 tokens");
    expect(formatTokensLong(500)).toBe("500 tokens");
    expect(formatTokensLong(999)).toBe("999 tokens");
  });

  it("formats values >= 1K with uppercase 'K tokens' suffix", () => {
    expect(formatTokensLong(1000)).toBe("1K tokens");
    expect(formatTokensLong(1500)).toBe("1K tokens");
    expect(formatTokensLong(11500)).toBe("11K tokens");
    expect(formatTokensLong(128000)).toBe("128K tokens");
    expect(formatTokensLong(999999)).toBe("999K tokens");
  });

  it("formats values >= 1M with 'M tokens' suffix and 1 decimal", () => {
    expect(formatTokensLong(1_000_000)).toBe("1.0M tokens");
    expect(formatTokensLong(1_500_000)).toBe("1.5M tokens");
    expect(formatTokensLong(2_000_000)).toBe("2.0M tokens");
  });

  it("handles boundary value 999 (no suffix)", () => {
    expect(formatTokensLong(999)).toBe("999 tokens");
  });

  it("handles boundary value 1000 (K suffix)", () => {
    expect(formatTokensLong(1000)).toBe("1K tokens");
  });

  it("handles boundary value 1_000_000 (M suffix)", () => {
    expect(formatTokensLong(1_000_000)).toBe("1.0M tokens");
  });
});

describe("formatCost", () => {
  it("formats very small costs < $0.001 with 5 decimal places", () => {
    expect(formatCost(0.00012)).toBe("0.00012");
    expect(formatCost(0.0001)).toBe("0.00010");
    expect(formatCost(0.00099)).toBe("0.00099");
  });

  it("formats small costs < $0.01 with 4 decimal places", () => {
    expect(formatCost(0.001)).toBe("0.0010");
    expect(formatCost(0.0056)).toBe("0.0056");
    expect(formatCost(0.0099)).toBe("0.0099");
  });

  it("formats medium costs < $1 with 3 decimal places", () => {
    expect(formatCost(0.01)).toBe("0.010");
    expect(formatCost(0.123)).toBe("0.123");
    expect(formatCost(0.999)).toBe("0.999");
  });

  it("formats large costs >= $1 with 2 decimal places", () => {
    expect(formatCost(1)).toBe("1.00");
    expect(formatCost(1.5)).toBe("1.50");
    expect(formatCost(10.99)).toBe("10.99");
    expect(formatCost(100)).toBe("100.00");
  });

  it("handles boundary value $0.001 (4 decimal places)", () => {
    expect(formatCost(0.001)).toBe("0.0010");
  });

  it("handles boundary value $0.01 (3 decimal places)", () => {
    expect(formatCost(0.01)).toBe("0.010");
  });

  it("handles boundary value $1 (2 decimal places)", () => {
    expect(formatCost(1)).toBe("1.00");
  });
});

describe("stripProviderPrefix", () => {
  it("strips provider prefix when colon separator is present", () => {
    expect(stripProviderPrefix("openai:gpt-4")).toBe("gpt-4");
    expect(stripProviderPrefix("anthropic:claude-3-5-sonnet-20241022")).toBe(
      "claude-3-5-sonnet-20241022",
    );
    expect(stripProviderPrefix("gemini:gemini-pro")).toBe("gemini-pro");
  });

  it("returns the model unchanged when no prefix is present", () => {
    expect(stripProviderPrefix("gpt-4")).toBe("gpt-4");
    expect(stripProviderPrefix("claude-3-5-sonnet")).toBe("claude-3-5-sonnet");
  });

  it("returns empty string for empty input", () => {
    expect(stripProviderPrefix("")).toBe("");
  });

  it("handles multiple colons by returning just the second segment", () => {
    expect(stripProviderPrefix("provider:model:version")).toBe("model");
    expect(stripProviderPrefix("a:b:c:d")).toBe("b");
  });
});
