import { describe, expect, it } from "vitest";
import { estimateResearchCost } from "./cost.js";

describe("estimateResearchCost", () => {
  it("computes token-only pricing", () => {
    const cost = estimateResearchCost(
      { input: 10, output: 40 },
      { inputTokens: 2_000_000, outputTokens: 500_000, totalTokens: 2_500_000 },
    );
    // 2M * $10/M + 0.5M * $40/M = 20 + 20
    expect(cost).toBe(40);
  });

  it("bills cached input at the cached rate", () => {
    const cost = estimateResearchCost(
      { input: 10, output: 40, cachedInput: 2.5 },
      {
        inputTokens: 1_000_000,
        cachedInputTokens: 400_000,
        outputTokens: 0,
        totalTokens: 1_000_000,
      },
    );
    // 600k * $10/M + 400k * $2.50/M = 6 + 1
    expect(cost).toBeCloseTo(7, 6);
  });

  it("bills cached input at the input rate when no cached rate is set", () => {
    const cost = estimateResearchCost(
      { input: 10, output: 40 },
      {
        inputTokens: 1_000_000,
        cachedInputTokens: 400_000,
        outputTokens: 0,
        totalTokens: 1_000_000,
      },
    );
    expect(cost).toBe(10);
  });

  it("prices internal reasoning separately and excludes it from output", () => {
    const cost = estimateResearchCost(
      { input: 2, output: 8, internalReasoning: 3 },
      {
        inputTokens: 0,
        outputTokens: 400_000,
        reasoningTokens: 350_000,
        totalTokens: 400_000,
      },
    );
    // (400k - 350k) * $8/M + 350k * $3/M = 0.4 + 1.05
    expect(cost).toBeCloseTo(1.45, 6);
  });

  it("keeps reasoning tokens in output when internalReasoning is not priced", () => {
    const cost = estimateResearchCost(
      { input: 2, output: 8 },
      {
        inputTokens: 0,
        outputTokens: 400_000,
        reasoningTokens: 350_000,
        totalTokens: 400_000,
      },
    );
    expect(cost).toBeCloseTo(3.2, 6);
  });

  it("adds per-search fees", () => {
    const cost = estimateResearchCost(
      { input: 2, output: 8, perThousandSearches: 5 },
      { inputTokens: 0, outputTokens: 0, totalTokens: 0, searches: 40 },
    );
    expect(cost).toBeCloseTo(0.2, 6);
  });

  it("combines all dimensions and rounds to 6 decimals", () => {
    const cost = estimateResearchCost(
      { input: 2, output: 8, cachedInput: 0.5, internalReasoning: 3, perThousandSearches: 5 },
      {
        inputTokens: 123_456,
        cachedInputTokens: 23_456,
        outputTokens: 78_901,
        reasoningTokens: 45_678,
        totalTokens: 202_357,
        searches: 17,
      },
    );
    const expected =
      ((123_456 - 23_456) * 2) / 1e6 +
      (23_456 * 0.5) / 1e6 +
      ((78_901 - 45_678) * 8) / 1e6 +
      (45_678 * 3) / 1e6 +
      (17 * 5) / 1000;
    expect(cost).toBeCloseTo(expected, 6);
    expect(cost).toBe(Number(expected.toFixed(6)));
  });

  it("ignores undefined usage fields", () => {
    const cost = estimateResearchCost(
      { input: 2, output: 8, perThousandSearches: 5 },
      { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    );
    expect(cost).toBe(0);
  });
});
