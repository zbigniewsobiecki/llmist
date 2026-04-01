import chalk from "chalk";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildTokenMetrics,
  costPart,
  finishReasonPart,
  joinParts,
  timePart,
  tokenPart,
} from "./metric-parts.js";

// Force chalk to output colors even in non-TTY test environments
beforeAll(() => {
  chalk.level = 3;
});

/** Strip all ANSI escape codes from a string for plain-text assertions. */
function stripAnsi(str: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: needed to match ANSI escape sequences
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

// ─────────────────────────────────────────────────────────────────────────────
// tokenPart
// ─────────────────────────────────────────────────────────────────────────────

describe("tokenPart", () => {
  describe("input direction", () => {
    it("renders ↑ icon and yellow count for small numbers", () => {
      const result = tokenPart("input", 49);
      expect(stripAnsi(result)).toBe("↑ 49");
      // Icon is dim, count is yellow
      expect(result).toBe(chalk.dim("↑") + chalk.yellow(" 49"));
    });

    it("renders ↑ with formatted k-suffix for large numbers", () => {
      const result = tokenPart("input", 10400);
      expect(stripAnsi(result)).toBe("↑ 10.4k");
      expect(result).toBe(chalk.dim("↑") + chalk.yellow(" 10.4k"));
    });

    it("renders 0 without k-suffix", () => {
      const result = tokenPart("input", 0);
      expect(stripAnsi(result)).toBe("↑ 0");
    });

    it("prepends ~ tilde when estimated is true", () => {
      const result = tokenPart("input", 5200, { estimated: true });
      expect(stripAnsi(result)).toBe("↑ ~5.2k");
      expect(result).toBe(chalk.dim("↑") + chalk.yellow(" ~5.2k"));
    });

    it("does not prepend ~ when estimated is false", () => {
      const result = tokenPart("input", 100, { estimated: false });
      expect(stripAnsi(result)).toBe("↑ 100");
    });
  });

  describe("cached direction", () => {
    it("renders ⟳ icon and blue count", () => {
      const result = tokenPart("cached", 3000);
      expect(stripAnsi(result)).toBe("⟳ 3.0k");
      expect(result).toBe(chalk.dim("⟳") + chalk.blue(" 3.0k"));
    });

    it("renders small cached count without k-suffix", () => {
      const result = tokenPart("cached", 500);
      expect(stripAnsi(result)).toBe("⟳ 500");
    });

    it("renders 0 cached tokens", () => {
      const result = tokenPart("cached", 0);
      expect(stripAnsi(result)).toBe("⟳ 0");
    });
  });

  describe("output direction", () => {
    it("renders ↓ icon and green count", () => {
      const result = tokenPart("output", 49);
      expect(stripAnsi(result)).toBe("↓ 49");
      expect(result).toBe(chalk.dim("↓") + chalk.green(" 49"));
    });

    it("renders ↓ with k-suffix for large output", () => {
      const result = tokenPart("output", 11500);
      expect(stripAnsi(result)).toBe("↓ 11.5k");
    });

    it("prepends ~ tilde when estimated is true", () => {
      const result = tokenPart("output", 200, { estimated: true });
      expect(stripAnsi(result)).toBe("↓ ~200");
    });
  });

  describe("reasoning direction", () => {
    it("renders 💭 icon and magenta count", () => {
      const result = tokenPart("reasoning", 512);
      expect(stripAnsi(result)).toBe("💭 512");
      expect(result).toBe(chalk.dim("💭") + chalk.magenta(" 512"));
    });

    it("renders 💭 with k-suffix for large reasoning count", () => {
      const result = tokenPart("reasoning", 4096);
      expect(stripAnsi(result)).toBe("💭 4.1k");
    });
  });

  describe("cacheCreation direction", () => {
    it("renders ✎ icon and magenta count", () => {
      const result = tokenPart("cacheCreation", 2048);
      expect(stripAnsi(result)).toBe("✎ 2.0k");
      expect(result).toBe(chalk.dim("✎") + chalk.magenta(" 2.0k"));
    });

    it("renders small cache creation count without k-suffix", () => {
      const result = tokenPart("cacheCreation", 100);
      expect(stripAnsi(result)).toBe("✎ 100");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// costPart
// ─────────────────────────────────────────────────────────────────────────────

describe("costPart", () => {
  it("renders small cost with 5 decimal places, cyan $-prefix", () => {
    const result = costPart(0.0032);
    expect(stripAnsi(result)).toBe("$0.0032");
    expect(result).toBe(chalk.cyan("$0.0032"));
  });

  it("renders very small cost with more decimal places", () => {
    const result = costPart(0.00009);
    expect(stripAnsi(result)).toBe("$0.00009");
  });

  it("renders larger cost with 2 decimal places", () => {
    const result = costPart(1.5);
    expect(stripAnsi(result)).toBe("$1.50");
    expect(result).toBe(chalk.cyan("$1.50"));
  });

  it("renders zero cost as $0.00000", () => {
    const result = costPart(0);
    expect(stripAnsi(result)).toBe("$0.00000");
  });

  it("uses cyan color", () => {
    const result = costPart(0.123);
    expect(result).toBe(chalk.cyan(`$${(0.123).toFixed(3)}`));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// timePart
// ─────────────────────────────────────────────────────────────────────────────

describe("timePart", () => {
  it("renders elapsed seconds with one decimal place, dim", () => {
    const result = timePart(24.8);
    expect(stripAnsi(result)).toBe("24.8s");
    expect(result).toBe(chalk.dim("24.8s"));
  });

  it("renders zero as 0.0s", () => {
    const result = timePart(0);
    expect(stripAnsi(result)).toBe("0.0s");
  });

  it("rounds to one decimal place", () => {
    const result = timePart(3.0);
    expect(stripAnsi(result)).toBe("3.0s");
  });

  it("rounds fractional seconds correctly", () => {
    const result = timePart(1.25);
    expect(stripAnsi(result)).toBe("1.3s");
  });

  it("uses dim color", () => {
    const result = timePart(5.5);
    expect(result).toBe(chalk.dim("5.5s"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// finishReasonPart
// ─────────────────────────────────────────────────────────────────────────────

describe("finishReasonPart", () => {
  it("renders STOP in green uppercase", () => {
    const result = finishReasonPart("stop");
    expect(stripAnsi(result)).toBe("STOP");
    expect(result).toBe(chalk.green("STOP"));
  });

  it("renders END_TURN in green uppercase", () => {
    const result = finishReasonPart("end_turn");
    expect(stripAnsi(result)).toBe("END_TURN");
    expect(result).toBe(chalk.green("END_TURN"));
  });

  it("is case-insensitive for STOP (uppercase input)", () => {
    const result = finishReasonPart("STOP");
    expect(result).toBe(chalk.green("STOP"));
  });

  it("is case-insensitive for END_TURN (uppercase input)", () => {
    const result = finishReasonPart("END_TURN");
    expect(result).toBe(chalk.green("END_TURN"));
  });

  it("renders length in yellow uppercase", () => {
    const result = finishReasonPart("length");
    expect(stripAnsi(result)).toBe("LENGTH");
    expect(result).toBe(chalk.yellow("LENGTH"));
  });

  it("renders max_tokens in yellow uppercase", () => {
    const result = finishReasonPart("max_tokens");
    expect(stripAnsi(result)).toBe("MAX_TOKENS");
    expect(result).toBe(chalk.yellow("MAX_TOKENS"));
  });

  it("renders tool_calls in yellow uppercase", () => {
    const result = finishReasonPart("tool_calls");
    expect(result).toBe(chalk.yellow("TOOL_CALLS"));
  });

  it("renders unknown reason in yellow uppercase", () => {
    const result = finishReasonPart("unknown_reason");
    expect(result).toBe(chalk.yellow("UNKNOWN_REASON"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildTokenMetrics
// ─────────────────────────────────────────────────────────────────────────────

describe("buildTokenMetrics", () => {
  it("returns empty array for empty options", () => {
    expect(buildTokenMetrics({})).toEqual([]);
  });

  it("returns empty array when all counts are 0", () => {
    expect(
      buildTokenMetrics({ input: 0, cached: 0, output: 0, reasoning: 0, cacheCreation: 0 }),
    ).toEqual([]);
  });

  it("returns empty array when all counts are undefined", () => {
    expect(buildTokenMetrics({ input: undefined, output: undefined })).toEqual([]);
  });

  it("includes input part when input > 0", () => {
    const parts = buildTokenMetrics({ input: 1000 });
    expect(parts).toHaveLength(1);
    expect(stripAnsi(parts[0])).toBe("↑ 1.0k");
  });

  it("includes cached part when cached > 0", () => {
    const parts = buildTokenMetrics({ cached: 500 });
    expect(parts).toHaveLength(1);
    expect(stripAnsi(parts[0])).toBe("⟳ 500");
  });

  it("includes output part when output > 0", () => {
    const parts = buildTokenMetrics({ output: 49 });
    expect(parts).toHaveLength(1);
    expect(stripAnsi(parts[0])).toBe("↓ 49");
  });

  it("includes reasoning part when reasoning > 0", () => {
    const parts = buildTokenMetrics({ reasoning: 256 });
    expect(parts).toHaveLength(1);
    expect(stripAnsi(parts[0])).toBe("💭 256");
  });

  it("includes cacheCreation part when cacheCreation > 0", () => {
    const parts = buildTokenMetrics({ cacheCreation: 2048 });
    expect(parts).toHaveLength(1);
    expect(stripAnsi(parts[0])).toBe("✎ 2.0k");
  });

  it("assembles all five parts in canonical order", () => {
    const parts = buildTokenMetrics({
      input: 10400,
      cached: 3000,
      output: 49,
      reasoning: 512,
      cacheCreation: 1024,
    });
    expect(parts).toHaveLength(5);
    expect(stripAnsi(parts[0])).toBe("↑ 10.4k");
    expect(stripAnsi(parts[1])).toBe("⟳ 3.0k");
    expect(stripAnsi(parts[2])).toBe("↓ 49");
    expect(stripAnsi(parts[3])).toBe("💭 512");
    expect(stripAnsi(parts[4])).toBe("✎ 1.0k");
  });

  it("assembles input + cached + output subset correctly", () => {
    const parts = buildTokenMetrics({ input: 896, cached: 500, output: 11500 });
    expect(parts).toHaveLength(3);
    expect(stripAnsi(parts[0])).toBe("↑ 896");
    expect(stripAnsi(parts[1])).toBe("⟳ 500");
    expect(stripAnsi(parts[2])).toBe("↓ 11.5k");
  });

  it("applies estimated flag to input", () => {
    const parts = buildTokenMetrics({ input: 5200, estimated: { input: true } });
    expect(parts).toHaveLength(1);
    expect(stripAnsi(parts[0])).toBe("↑ ~5.2k");
  });

  it("applies estimated flag to output", () => {
    const parts = buildTokenMetrics({ output: 200, estimated: { output: true } });
    expect(parts).toHaveLength(1);
    expect(stripAnsi(parts[0])).toBe("↓ ~200");
  });

  it("applies estimated flags to both input and output", () => {
    const parts = buildTokenMetrics({
      input: 1000,
      output: 500,
      estimated: { input: true, output: true },
    });
    expect(stripAnsi(parts[0])).toBe("↑ ~1.0k");
    expect(stripAnsi(parts[1])).toBe("↓ ~500");
  });

  it("does not mark cached as estimated even when estimated flags are set", () => {
    const parts = buildTokenMetrics({
      cached: 2000,
      estimated: { input: true, output: true },
    });
    expect(stripAnsi(parts[0])).toBe("⟳ 2.0k"); // No ~ prefix
  });

  it("skips zero fields even when other fields are present", () => {
    const parts = buildTokenMetrics({ input: 500, cached: 0, output: 100 });
    expect(parts).toHaveLength(2);
    expect(stripAnsi(parts[0])).toBe("↑ 500");
    expect(stripAnsi(parts[1])).toBe("↓ 100");
  });

  it("handles large token counts", () => {
    const parts = buildTokenMetrics({ input: 128000, output: 4096 });
    expect(stripAnsi(parts[0])).toBe("↑ 128.0k");
    expect(stripAnsi(parts[1])).toBe("↓ 4.1k");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// joinParts
// ─────────────────────────────────────────────────────────────────────────────

describe("joinParts", () => {
  it("returns empty string for empty array", () => {
    expect(joinParts([])).toBe("");
  });

  it("returns single part without separator", () => {
    const result = joinParts(["single"]);
    expect(result).toBe("single");
  });

  it("joins two parts with dim | separator", () => {
    const result = joinParts(["↑ 1.0k", "↓ 49"]);
    expect(result).toBe(`↑ 1.0k${chalk.dim(" | ")}↓ 49`);
  });

  it("joins three parts with dim | separators", () => {
    const result = joinParts(["↑ 10.4k", "↓ 49", "24.8s"]);
    const sep = chalk.dim(" | ");
    expect(result).toBe(`↑ 10.4k${sep}↓ 49${sep}24.8s`);
  });

  it("filters out empty string entries", () => {
    const result = joinParts(["first", "", "third"]);
    expect(result).toBe(`first${chalk.dim(" | ")}third`);
  });

  it("filters out all-empty array", () => {
    const result = joinParts(["", "", ""]);
    expect(result).toBe("");
  });

  it("works with real metric parts", () => {
    const parts = [
      tokenPart("input", 10400),
      tokenPart("cached", 3000),
      tokenPart("output", 49),
      timePart(24.8),
      costPart(0.0032),
    ];
    const result = joinParts(parts);
    const plain = stripAnsi(result);
    expect(plain).toBe("↑ 10.4k | ⟳ 3.0k | ↓ 49 | 24.8s | $0.0032");
  });
});
