import { describe, expect, it } from "vitest";
import { homedir } from "node:os";
import { expandTildePath } from "./paths.js";

describe("expandTildePath", () => {
  const home = homedir();

  it("expands ~ at the start of the path", () => {
    expect(expandTildePath("~/.llmist/logs")).toBe(`${home}/.llmist/logs`);
  });

  it("expands ~/path correctly", () => {
    expect(expandTildePath("~/logs/app.log")).toBe(`${home}/logs/app.log`);
  });

  it("leaves absolute paths unchanged", () => {
    expect(expandTildePath("/var/log/app.log")).toBe("/var/log/app.log");
  });

  it("leaves relative paths unchanged", () => {
    expect(expandTildePath("./relative/path")).toBe("./relative/path");
    expect(expandTildePath("relative/path")).toBe("relative/path");
  });

  it("leaves tilde in middle of path unchanged", () => {
    expect(expandTildePath("/home/user/~backup")).toBe("/home/user/~backup");
    expect(expandTildePath("/path/to/~file")).toBe("/path/to/~file");
  });

  it("handles tilde-only path", () => {
    expect(expandTildePath("~")).toBe(home);
  });

  it("handles empty string", () => {
    expect(expandTildePath("")).toBe("");
  });
});
