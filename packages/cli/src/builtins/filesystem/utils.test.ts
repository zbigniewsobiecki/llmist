import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PathSandboxException, validatePathIsWithinCwd } from "./utils.js";

describe("validatePathIsWithinCwd", () => {
  const cwd = process.cwd();

  it("resolves a valid relative path within CWD", () => {
    const result = validatePathIsWithinCwd(".test-temp/some-file.txt");
    expect(result).toBe(resolve(cwd, ".test-temp/some-file.txt"));
  });

  it("resolves a valid absolute path within CWD", () => {
    const absPath = join(cwd, ".test-temp", "another-file.txt");
    const result = validatePathIsWithinCwd(absPath);
    expect(result).toBe(absPath);
  });

  it("throws PathSandboxException for ../ traversal outside CWD", () => {
    expect(() => validatePathIsWithinCwd("../../etc/passwd")).toThrow(PathSandboxException);
  });

  it("throws PathSandboxException for absolute path outside CWD", () => {
    expect(() => validatePathIsWithinCwd("/tmp/outside")).toThrow(PathSandboxException);
  });

  it("accepts an ENOENT path (file doesn't exist yet) that is within CWD", () => {
    const nonExistentPath = join(cwd, "nonexistent-dir-xyz", "file.txt");
    const result = validatePathIsWithinCwd(nonExistentPath);
    expect(result).toBe(nonExistentPath);
  });

  it("accepts CWD itself as the path", () => {
    const result = validatePathIsWithinCwd(cwd);
    // realpathSync resolves symlinks in cwd, so compare against real cwd
    expect(result).toBe(realpathSync(cwd));
  });

  it("PathSandboxException has correct name and message", () => {
    let caught: unknown;
    try {
      validatePathIsWithinCwd("/etc/passwd");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PathSandboxException);
    expect(caught).toBeInstanceOf(Error);
    const ex = caught as PathSandboxException;
    expect(ex.name).toBe("PathSandboxException");
    expect(ex.message).toContain("/etc/passwd");
    expect(ex.message).toContain("Path access denied");
  });
});
