import { describe, expect, it } from "vitest";
import { formatExecutionTime } from "./format-time.js";

describe("formatExecutionTime", () => {
  it("formats below threshold as milliseconds", () => {
    expect(formatExecutionTime(123)).toBe("123ms");
  });

  it("formats at threshold (1000ms) as seconds", () => {
    expect(formatExecutionTime(1000)).toBe("1.0s");
  });

  it("formats above threshold as seconds", () => {
    expect(formatExecutionTime(1500)).toBe("1.5s");
  });

  it("formats zero as milliseconds", () => {
    expect(formatExecutionTime(0)).toBe("0ms");
  });

  it("formats values just below threshold as milliseconds", () => {
    expect(formatExecutionTime(999)).toBe("999ms");
  });

  it("formats large values as seconds", () => {
    expect(formatExecutionTime(2500)).toBe("2.5s");
  });
});
