import { describe, expect, it } from "vitest";
import chalk from "chalk";
import { formatNewFileDiff, renderColoredDiff } from "./diff-renderer.js";

describe("renderColoredDiff", () => {
  it("colors added lines with green", () => {
    const diff = "+added line";
    const result = renderColoredDiff(diff);

    expect(result).toBe(chalk.green("+added line"));
  });

  it("colors removed lines with red", () => {
    const diff = "-removed line";
    const result = renderColoredDiff(diff);

    expect(result).toBe(chalk.red("-removed line"));
  });

  it("colors hunk headers with cyan", () => {
    const diff = "@@ -1,3 +1,4 @@";
    const result = renderColoredDiff(diff);

    expect(result).toBe(chalk.cyan("@@ -1,3 +1,4 @@"));
  });

  it("makes file headers bold", () => {
    const diffOld = "--- file.txt";
    const diffNew = "+++ file.txt";

    expect(renderColoredDiff(diffOld)).toBe(chalk.bold("--- file.txt"));
    expect(renderColoredDiff(diffNew)).toBe(chalk.bold("+++ file.txt"));
  });

  it("dims context lines", () => {
    const diff = " context line";
    const result = renderColoredDiff(diff);

    expect(result).toBe(chalk.dim(" context line"));
  });

  it("handles complete unified diff", () => {
    const diff = `--- original.txt
+++ modified.txt
@@ -1,3 +1,4 @@
 line 1
-line 2
+line 2 modified
+line 2.5
 line 3`;

    const result = renderColoredDiff(diff);

    expect(result).toContain(chalk.bold("--- original.txt"));
    expect(result).toContain(chalk.bold("+++ modified.txt"));
    expect(result).toContain(chalk.cyan("@@ -1,3 +1,4 @@"));
    expect(result).toContain(chalk.dim(" line 1"));
    expect(result).toContain(chalk.red("-line 2"));
    expect(result).toContain(chalk.green("+line 2 modified"));
    expect(result).toContain(chalk.green("+line 2.5"));
    expect(result).toContain(chalk.dim(" line 3"));
  });

  it("handles empty diff", () => {
    const result = renderColoredDiff("");
    expect(result).toBe(chalk.dim(""));
  });

  it("handles diff with only additions", () => {
    const diff = `+++ new.txt
+line 1
+line 2`;

    const result = renderColoredDiff(diff);

    expect(result).toContain(chalk.bold("+++ new.txt"));
    expect(result).toContain(chalk.green("+line 1"));
    expect(result).toContain(chalk.green("+line 2"));
  });
});

describe("formatNewFileDiff", () => {
  it("generates header with (new file) label", () => {
    const result = formatNewFileDiff("test.txt", "content");

    expect(result).toContain("+++ test.txt (new file)");
  });

  it("prefixes all content lines with + ", () => {
    const content = "line 1\nline 2\nline 3";
    const result = formatNewFileDiff("test.txt", content);

    expect(result).toContain("+ line 1");
    expect(result).toContain("+ line 2");
    expect(result).toContain("+ line 3");
  });

  it("handles empty content", () => {
    const result = formatNewFileDiff("empty.txt", "");

    expect(result).toBe("+++ empty.txt (new file)\n+ ");
  });

  it("handles single line content", () => {
    const result = formatNewFileDiff("single.txt", "only line");

    expect(result).toBe("+++ single.txt (new file)\n+ only line");
  });

  it("handles content with special characters", () => {
    const content = "const x = 'hello';\nconsole.log(x);";
    const result = formatNewFileDiff("code.js", content);

    expect(result).toContain("+ const x = 'hello';");
    expect(result).toContain("+ console.log(x);");
  });

  it("preserves indentation in content", () => {
    const content = "function foo() {\n  return bar;\n}";
    const result = formatNewFileDiff("indent.js", content);

    expect(result).toContain("+ function foo() {");
    expect(result).toContain("+   return bar;");
    expect(result).toContain("+ }");
  });
});
