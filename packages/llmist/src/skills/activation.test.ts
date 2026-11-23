import { describe, expect, it } from "vitest";
import { resolveInstructions, substituteArguments, substituteVariables } from "./activation.js";

describe("substituteArguments", () => {
  it("replaces $ARGUMENTS with full argument string", () => {
    const result = substituteArguments("Run: $ARGUMENTS", "hello world");
    expect(result).toBe("Run: hello world");
  });

  it("replaces positional $0, $1", () => {
    const result = substituteArguments("File: $0, Format: $1", "readme.md json");
    expect(result).toBe("File: readme.md, Format: json");
  });

  it("replaces $ARGUMENTS[N] syntax", () => {
    const result = substituteArguments("First: $ARGUMENTS[0]", "alpha beta");
    expect(result).toBe("First: alpha");
  });

  it("replaces missing positional args with empty string", () => {
    const result = substituteArguments("A: $0, B: $1, C: $2", "only-one");
    expect(result).toBe("A: only-one, B: , C: ");
  });

  it("clears placeholders when no arguments provided", () => {
    const result = substituteArguments("Task: $ARGUMENTS ($0)");
    expect(result).toBe("Task:  ()");
  });

  it("handles quoted arguments", () => {
    const result = substituteArguments("$0 and $1", '"hello world" single');
    expect(result).toBe("hello world and single");
  });

  it("handles multiple $ARGUMENTS occurrences", () => {
    const result = substituteArguments("$ARGUMENTS then $ARGUMENTS again", "test");
    expect(result).toBe("test then test again");
  });
});

describe("resolveInstructions with shell preprocessing enabled", () => {
  const options = { enableShellPreprocessing: true };

  it("executes !`command` and replaces with output", () => {
    const result = resolveInstructions("Version: !`echo 42`", options);
    expect(result).toBe("Version: 42");
  });

  it("handles multiple commands", () => {
    const result = resolveInstructions("A=!`echo a`, B=!`echo b`", options);
    expect(result).toBe("A=a, B=b");
  });

  it("shows error for failing commands with error message", () => {
    const result = resolveInstructions("Result: !`false`", options);
    expect(result).toContain("[Error executing `false`:");
    expect(result).toContain("Command failed");
  });

  it("leaves text without commands unchanged", () => {
    const input = "No commands here. Regular `code blocks` are fine.";
    expect(resolveInstructions(input, options)).toBe(input);
  });
});

describe("substituteVariables", () => {
  it("replaces ${VAR} with provided values", () => {
    const result = substituteVariables("Dir: ${SKILL_DIR}, Session: ${SESSION_ID}", {
      SKILL_DIR: "/path/to/skill",
      SESSION_ID: "abc123",
    });
    expect(result).toBe("Dir: /path/to/skill, Session: abc123");
  });

  it("replaces unknown variables with empty string", () => {
    const result = substituteVariables("Unknown: ${NOPE}", {});
    expect(result).toBe("Unknown: ");
  });
});

describe("resolveInstructions", () => {
  it("renders placeholders and leaves shell directives as text by default", () => {
    const result = resolveInstructions("${SKILL_DIR}: $ARGUMENTS (!`echo version`)", {
      variables: { SKILL_DIR: "/skills/test" },
      arguments: "check inbox",
    });
    expect(result).toBe("/skills/test: check inbox (!`echo version`)");
  });

  it("skips shell preprocessing when disabled", () => {
    const result = resolveInstructions("!`echo should-not-run`", {
      enableShellPreprocessing: false,
    });
    expect(result).toBe("!`echo should-not-run`");
  });
});
