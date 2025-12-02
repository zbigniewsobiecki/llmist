import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  DefaultContextProvider,
  EditFileContextProvider,
  RunCommandContextProvider,
  WriteFileContextProvider,
} from "./context-providers.js";

// Create a temporary directory for file-based tests
const testDir = join(tmpdir(), `llmist-approval-test-${Date.now()}`);

beforeAll(() => {
  if (!existsSync(testDir)) {
    mkdirSync(testDir, { recursive: true });
  }
});

afterAll(() => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

describe("WriteFileContextProvider", () => {
  const provider = new WriteFileContextProvider();

  it('has gadgetName "WriteFile"', () => {
    expect(provider.gadgetName).toBe("WriteFile");
  });

  it("returns new file context when file does not exist", async () => {
    const nonExistentPath = join(testDir, "new-file.txt");
    const content = "Hello, World!";

    const context = await provider.getContext({
      filePath: nonExistentPath,
      content,
    });

    expect(context.summary).toBe(`Create new file: ${nonExistentPath}`);
    expect(context.details).toContain("+++ ");
    expect(context.details).toContain("(new file)");
    expect(context.details).toContain("+ Hello, World!");
  });

  it("returns diff context when modifying existing file", async () => {
    const existingPath = join(testDir, "existing-file.txt");
    writeFileSync(existingPath, "Original content\n");

    const context = await provider.getContext({
      filePath: existingPath,
      content: "Modified content\n",
    });

    expect(context.summary).toBe(`Modify: ${existingPath}`);
    expect(context.details).toContain("---");
    expect(context.details).toContain("+++");
    expect(context.details).toContain("-Original content");
    expect(context.details).toContain("+Modified content");
  });

  it("handles path parameter as alternative to filePath", async () => {
    const nonExistentPath = join(testDir, "alt-path-file.txt");

    const context = await provider.getContext({
      path: nonExistentPath,
      content: "Content",
    });

    expect(context.summary).toBe(`Create new file: ${nonExistentPath}`);
  });
});

describe("EditFileContextProvider", () => {
  const provider = new EditFileContextProvider();

  it('has gadgetName "EditFile"', () => {
    expect(provider.gadgetName).toBe("EditFile");
  });

  it("returns diff context when content param provided for existing file", async () => {
    const existingPath = join(testDir, "edit-existing.txt");
    writeFileSync(existingPath, "Line 1\nLine 2\n");

    const context = await provider.getContext({
      filePath: existingPath,
      content: "Line 1\nLine 2\nLine 3\n",
    });

    expect(context.summary).toBe(`Modify: ${existingPath}`);
    expect(context.details).toContain("+Line 3");
  });

  it("returns new file context when content param provided for non-existing file", async () => {
    const newPath = join(testDir, "edit-new.txt");

    const context = await provider.getContext({
      filePath: newPath,
      content: "New content",
    });

    expect(context.summary).toBe(`Create new file: ${newPath}`);
    expect(context.details).toContain("(new file)");
  });

  it("shows commands when commands param provided", async () => {
    const filePath = join(testDir, "edit-commands.txt");

    const context = await provider.getContext({
      filePath,
      commands: "1d\n2a\nNew line\n.",
    });

    expect(context.summary).toBe(`Edit: ${filePath}`);
    expect(context.details).toContain("Commands:");
    expect(context.details).toContain("1d");
    expect(context.details).toContain("2a");
  });

  it("returns fallback context when neither content nor commands provided", async () => {
    const filePath = join(testDir, "edit-fallback.txt");

    const context = await provider.getContext({
      filePath,
    });

    expect(context.summary).toBe(`Edit: ${filePath}`);
    expect(context.details).toBeUndefined();
  });
});

describe("RunCommandContextProvider", () => {
  const provider = new RunCommandContextProvider();

  it('has gadgetName "RunCommand"', () => {
    expect(provider.gadgetName).toBe("RunCommand");
  });

  it("returns command in summary", async () => {
    const context = await provider.getContext({
      command: "ls -la",
    });

    expect(context.summary).toBe("Execute: ls -la");
    expect(context.details).toBeUndefined();
  });

  it("includes cwd in summary when provided", async () => {
    const context = await provider.getContext({
      command: "npm install",
      cwd: "/path/to/project",
    });

    expect(context.summary).toBe("Execute: npm install (in /path/to/project)");
  });

  it("handles empty command", async () => {
    const context = await provider.getContext({});

    expect(context.summary).toBe("Execute: ");
  });
});

describe("DefaultContextProvider", () => {
  it("uses provided gadget name", () => {
    const provider = new DefaultContextProvider("CustomGadget");
    expect(provider.gadgetName).toBe("CustomGadget");
  });

  it("returns gadget name with empty parens when no params", async () => {
    const provider = new DefaultContextProvider("TestGadget");

    const context = await provider.getContext({});

    expect(context.summary).toBe("TestGadget()");
    expect(context.details).toBeUndefined();
  });

  it("returns formatted params in summary", async () => {
    const provider = new DefaultContextProvider("TestGadget");

    const context = await provider.getContext({
      foo: "bar",
      count: 42,
    });

    expect(context.summary).toBe('TestGadget(foo="bar", count=42)');
  });

  it("truncates long parameter values at 50 characters", async () => {
    const provider = new DefaultContextProvider("TestGadget");
    const longValue = "a".repeat(100);

    const context = await provider.getContext({
      data: longValue,
    });

    // Should be truncated to 47 chars + "..."
    expect(context.summary).toContain("...");
    expect(context.summary.length).toBeLessThan(100);
  });

  it("handles nested objects in params", async () => {
    const provider = new DefaultContextProvider("TestGadget");

    const context = await provider.getContext({
      nested: { a: 1, b: 2 },
    });

    expect(context.summary).toContain("nested=");
    expect(context.summary).toContain('"a"');
  });

  it("handles arrays in params", async () => {
    const provider = new DefaultContextProvider("TestGadget");

    const context = await provider.getContext({
      items: [1, 2, 3],
    });

    expect(context.summary).toBe("TestGadget(items=[1,2,3])");
  });
});
