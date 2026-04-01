import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseFrontmatter,
  parseMetadata,
  parseSkillContent,
  parseSkillFile,
  scanResources,
  validateMetadata,
} from "./parser.js";
import type { SkillSource } from "./types.js";

const testSource: SkillSource = { type: "project", path: "/test" };

describe("parseFrontmatter", () => {
  it("parses valid frontmatter with body", () => {
    const content = `---
name: my-skill
description: Does something useful
---

Instructions for the LLM.

More instructions.`;

    const { frontmatter, body } = parseFrontmatter(content);
    expect(frontmatter.name).toBe("my-skill");
    expect(frontmatter.description).toBe("Does something useful");
    expect(body).toBe("Instructions for the LLM.\n\nMore instructions.");
  });

  it("handles content with no frontmatter", () => {
    const content = "Just instructions, no frontmatter.";
    const { frontmatter, body } = parseFrontmatter(content);
    expect(frontmatter).toEqual({});
    expect(body).toBe(content);
  });

  it("handles frontmatter with no body", () => {
    const content = `---
name: solo
description: No body
---`;

    const { frontmatter, body } = parseFrontmatter(content);
    expect(frontmatter.name).toBe("solo");
    expect(body).toBe("");
  });

  it("handles unclosed frontmatter as no frontmatter", () => {
    const content = `---
name: broken
description: Missing closing`;

    const { frontmatter, body } = parseFrontmatter(content);
    expect(frontmatter).toEqual({});
    expect(body).toBe(content);
  });

  it("parses array values", () => {
    const content = `---
name: with-arrays
description: Has arrays
allowed-tools:
  - Bash
  - ReadFile
paths:
  - "src/**/*.ts"
---

Body.`;

    const { frontmatter } = parseFrontmatter(content);
    expect(frontmatter["allowed-tools"]).toEqual(["Bash", "ReadFile"]);
    expect(frontmatter.paths).toEqual(["src/**/*.ts"]);
  });

  it("handles leading whitespace before frontmatter", () => {
    const content = `
---
name: whitespace
description: Leading whitespace
---

Body.`;

    const { frontmatter } = parseFrontmatter(content);
    expect(frontmatter.name).toBe("whitespace");
  });
});

describe("parseMetadata", () => {
  it("maps kebab-case to camelCase", () => {
    const fm = {
      name: "my-skill",
      description: "A test skill",
      "argument-hint": "[file]",
      "allowed-tools": ["Bash", "ReadFile"],
      "disable-model-invocation": true,
      "user-invocable": false,
    };

    const meta = parseMetadata(fm);
    expect(meta.name).toBe("my-skill");
    expect(meta.argumentHint).toBe("[file]");
    expect(meta.allowedTools).toEqual(["Bash", "ReadFile"]);
    expect(meta.disableModelInvocation).toBe(true);
    expect(meta.userInvocable).toBe(false);
  });

  it("uses fallback name when name is missing", () => {
    const meta = parseMetadata({}, "fallback-name");
    expect(meta.name).toBe("fallback-name");
  });

  it("parses context field", () => {
    expect(parseMetadata({ context: "fork" }).context).toBe("fork");
    expect(parseMetadata({ context: "inline" }).context).toBe("inline");
    expect(parseMetadata({ context: "invalid" }).context).toBeUndefined();
  });

  it("parses shell field", () => {
    expect(parseMetadata({ shell: "bash" }).shell).toBe("bash");
    expect(parseMetadata({ shell: "powershell" }).shell).toBe("powershell");
    expect(parseMetadata({ shell: "zsh" }).shell).toBeUndefined();
  });

  it("handles string booleans", () => {
    const meta = parseMetadata({
      "disable-model-invocation": "true",
      "user-invocable": "false",
    });
    expect(meta.disableModelInvocation).toBe(true);
    expect(meta.userInvocable).toBe(false);
  });

  it("coerces single string to array for allowed-tools", () => {
    const meta = parseMetadata({ "allowed-tools": "Bash" });
    expect(meta.allowedTools).toEqual(["Bash"]);
  });
});

describe("validateMetadata", () => {
  it("returns no issues for valid metadata", () => {
    const issues = validateMetadata({
      name: "valid-skill",
      description: "A valid skill description",
    });
    expect(issues).toEqual([]);
  });

  it("reports missing name", () => {
    const issues = validateMetadata({ name: "", description: "desc" });
    expect(issues).toContainEqual(expect.stringContaining("name is required"));
  });

  it("reports name too long", () => {
    const issues = validateMetadata({
      name: "a".repeat(65),
      description: "desc",
    });
    expect(issues).toContainEqual(expect.stringContaining("exceeds 64"));
  });

  it("reports invalid name characters", () => {
    const issues = validateMetadata({
      name: "Invalid_Name",
      description: "desc",
    });
    expect(issues).toContainEqual(expect.stringContaining("lowercase"));
  });

  it("reports missing description", () => {
    const issues = validateMetadata({ name: "valid", description: "" });
    expect(issues).toContainEqual(expect.stringContaining("description is required"));
  });

  it("reports description too long", () => {
    const issues = validateMetadata({
      name: "valid",
      description: "x".repeat(1025),
    });
    expect(issues).toContainEqual(expect.stringContaining("exceeds 1024"));
  });

  it("reports name starting with hyphen", () => {
    const issues = validateMetadata({ name: "-invalid", description: "desc" });
    expect(issues).toContainEqual(expect.stringContaining("lowercase"));
  });
});

describe("parseMetadata type safety", () => {
  it("handles object values in name gracefully (not [object Object])", () => {
    const meta = parseMetadata({ name: { nested: true }, description: "test" } as any);
    // Should use fallback, not "[object Object]"
    expect(meta.name).not.toBe("[object Object]");
  });

  it("handles null values in frontmatter", () => {
    const meta = parseMetadata({ name: null, description: null } as any, "fallback");
    expect(meta.name).toBe("fallback");
    expect(meta.description).toBe("");
  });

  it("filters non-string array items in allowed-tools", () => {
    const meta = parseMetadata({
      name: "test",
      description: "test",
      "allowed-tools": ["Bash", 42, { obj: true }, "ReadFile"],
    } as any);
    expect(meta.allowedTools).toEqual(["Bash", "42", "ReadFile"]);
  });
});

describe("scanResources", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("discovers resources in scripts/, references/, assets/", () => {
    fs.mkdirSync(path.join(tmpDir, "scripts"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "references"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "assets"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "scripts", "validate.sh"), "#!/bin/bash");
    fs.writeFileSync(path.join(tmpDir, "references", "docs.md"), "# Docs");
    fs.writeFileSync(path.join(tmpDir, "assets", "template.txt"), "template");

    const resources = scanResources(tmpDir);
    expect(resources).toHaveLength(3);
    expect(resources.map((r) => r.category).sort()).toEqual(["assets", "references", "scripts"]);
    expect(resources.find((r) => r.category === "scripts")?.relativePath).toBe(
      path.join("scripts", "validate.sh"),
    );
  });

  it("handles nested resource directories", () => {
    fs.mkdirSync(path.join(tmpDir, "references", "api"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "references", "api", "auth.md"), "# Auth");

    const resources = scanResources(tmpDir);
    expect(resources).toHaveLength(1);
    expect(resources[0].relativePath).toBe(path.join("references", "api", "auth.md"));
  });

  it("returns empty array when no resource directories exist", () => {
    const resources = scanResources(tmpDir);
    expect(resources).toEqual([]);
  });
});

describe("parseSkillContent", () => {
  it("parses a full SKILL.md string", () => {
    const content = `---
name: explain-code
description: Explains code with visual diagrams
model: sonnet
---

When explaining code, always include:
1. Start with an analogy
2. Draw an ASCII diagram`;

    const skill = parseSkillContent(content, "/fake/explain-code/SKILL.md", testSource, true);

    expect(skill.metadata.name).toBe("explain-code");
    expect(skill.metadata.description).toBe("Explains code with visual diagrams");
    expect(skill.metadata.model).toBe("sonnet");
    expect(skill.instructions).toContain("Start with an analogy");
    expect(skill.sourcePath).toBe("/fake/explain-code/SKILL.md");
    expect(skill.sourceDir).toBe("/fake/explain-code");
  });

  it("uses directory name as fallback name", () => {
    const content = `---
description: No name field
---

Instructions.`;

    const skill = parseSkillContent(content, "/fake/my-skill-dir/SKILL.md", testSource, true);
    expect(skill.metadata.name).toBe("my-skill-dir");
  });

  it("leaves instructions null when loadInstructions is false", () => {
    const content = `---
name: lazy
description: Lazy loading test
---

These instructions should not be loaded.`;

    const skill = parseSkillContent(content, "/fake/lazy/SKILL.md", testSource, false);
    expect(skill.instructions).toBeNull();
  });
});

describe("parseSkillFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-file-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads and parses a SKILL.md file from disk", () => {
    const skillDir = path.join(tmpDir, "test-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.mkdirSync(path.join(skillDir, "scripts"));
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---
name: test-skill
description: A test skill from disk
---

File-based instructions.`,
    );
    fs.writeFileSync(path.join(skillDir, "scripts", "run.sh"), "#!/bin/bash");

    const skill = parseSkillFile(path.join(skillDir, "SKILL.md"), testSource, true);

    expect(skill.metadata.name).toBe("test-skill");
    expect(skill.instructions).toBe("File-based instructions.");
    expect(skill.resources).toHaveLength(1);
    expect(skill.resources[0].category).toBe("scripts");
  });
});
