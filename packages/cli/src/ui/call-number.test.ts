import { describe, expect, it } from "vitest";
import { formatCallNumber } from "./call-number.js";

describe("formatCallNumber", () => {
  it("formats main agent call number", () => {
    expect(formatCallNumber(1)).toBe("#1");
  });

  it("formats subagent without gadget ID", () => {
    expect(formatCallNumber(2, 1)).toBe("#1.2");
  });

  it("formats subagent with gadget ID", () => {
    expect(formatCallNumber(2, 6, "browse_web_1")).toBe("#6.browse_web_1.2");
  });

  it("formats main agent with iteration > 1", () => {
    expect(formatCallNumber(5)).toBe("#5");
  });

  it("formats subagent with parent call number and higher iteration", () => {
    expect(formatCallNumber(3, 2)).toBe("#2.3");
  });

  it("ignores gadgetInvocationId when parentCallNumber is undefined", () => {
    // When parentCallNumber is not provided, only iteration matters
    expect(formatCallNumber(1, undefined, "some_gadget_1")).toBe("#1");
  });
});
