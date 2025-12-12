import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DefaultContextProvider,
  EditFileContextProvider,
  formatGadgetSummary,
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

    // Universal format: GadgetName(params...)
    expect(context.summary).toContain("WriteFile(");
    expect(context.summary).toContain("filePath=");
    expect(context.summary).toContain("content=");
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

    expect(context.summary).toContain("WriteFile(");
    expect(context.summary).toContain("filePath=");
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

    expect(context.summary).toContain("WriteFile(");
    expect(context.summary).toContain("path=");
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

    expect(context.summary).toContain("EditFile(");
    expect(context.summary).toContain("filePath=");
    expect(context.details).toContain("+Line 3");
  });

  it("returns new file context when content param provided for non-existing file", async () => {
    const newPath = join(testDir, "edit-new.txt");

    const context = await provider.getContext({
      filePath: newPath,
      content: "New content",
    });

    expect(context.summary).toContain("EditFile(");
    expect(context.details).toContain("(new file)");
  });

  it("shows commands when commands param provided", async () => {
    const filePath = join(testDir, "edit-commands.txt");

    const context = await provider.getContext({
      filePath,
      commands: "1d\n2a\nNew line\n.",
    });

    expect(context.summary).toContain("EditFile(");
    expect(context.summary).toContain("commands=");
    expect(context.details).toContain("Commands:");
    expect(context.details).toContain("1d");
    expect(context.details).toContain("2a");
  });

  it("returns fallback context when neither content nor commands provided", async () => {
    const filePath = join(testDir, "edit-fallback.txt");

    const context = await provider.getContext({
      filePath,
    });

    expect(context.summary).toContain("EditFile(");
    expect(context.details).toBeUndefined();
  });
});

describe("formatGadgetSummary", () => {
  it("formats gadget with no params", () => {
    expect(formatGadgetSummary("TestGadget", {})).toBe("TestGadget()");
  });

  it("formats gadget with simple params", () => {
    expect(formatGadgetSummary("TestGadget", { foo: "bar", count: 42 })).toBe(
      'TestGadget(foo="bar", count=42)',
    );
  });

  it("formats gadget with array params", () => {
    expect(formatGadgetSummary("RunCommand", { argv: ["ls", "-la"], timeout: 30000 })).toBe(
      'RunCommand(argv=["ls","-la"], timeout=30000)',
    );
  });

  it("shows full values without truncation", () => {
    const longValue = "a".repeat(100);
    const summary = formatGadgetSummary("TestGadget", { data: longValue });
    // Full value should be shown - no truncation
    expect(summary).toContain(`"${"a".repeat(100)}"`);
    expect(summary).not.toContain("...");
  });
});

describe("RunCommand via DefaultContextProvider", () => {
  // RunCommand no longer has a custom provider - it uses DefaultContextProvider
  const provider = new DefaultContextProvider("RunCommand");

  it("formats RunCommand with argv array", async () => {
    const context = await provider.getContext({
      argv: ["npx", "create-next-app@latest", "my-app"],
      timeout: 120000,
    });

    expect(context.summary).toContain("RunCommand(");
    expect(context.summary).toContain("argv=");
    expect(context.summary).toContain("timeout=120000");
    expect(context.details).toBeUndefined();
  });

  it("includes cwd in summary when provided", async () => {
    const context = await provider.getContext({
      argv: ["npm", "install"],
      cwd: "/path/to/project",
    });

    expect(context.summary).toContain('cwd="/path/to/project"');
  });
});

describe("DefaultContextProvider", () => {
  it("uses provided gadget name", () => {
    const provider = new DefaultContextProvider("CustomGadget");
    expect(provider.gadgetName).toBe("CustomGadget");
  });

  it("delegates to formatGadgetSummary and returns no details", async () => {
    const provider = new DefaultContextProvider("TestGadget");

    const context = await provider.getContext({ foo: "bar" });

    // Verify it uses the shared formatter
    expect(context.summary).toBe(formatGadgetSummary("TestGadget", { foo: "bar" }));
    expect(context.details).toBeUndefined();
  });
});
