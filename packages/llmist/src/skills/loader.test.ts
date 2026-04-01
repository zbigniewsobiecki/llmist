import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverSkills, loadSkillsFromDirectory } from "./loader.js";

describe("loadSkillsFromDirectory", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-loader-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads skills from flat directory structure", () => {
    // skill-a/SKILL.md
    const skillADir = path.join(tmpDir, "skill-a");
    fs.mkdirSync(skillADir);
    fs.writeFileSync(
      path.join(skillADir, "SKILL.md"),
      `---
name: skill-a
description: First skill
---
Instructions A.`,
    );

    // skill-b/SKILL.md
    const skillBDir = path.join(tmpDir, "skill-b");
    fs.mkdirSync(skillBDir);
    fs.writeFileSync(
      path.join(skillBDir, "SKILL.md"),
      `---
name: skill-b
description: Second skill
---
Instructions B.`,
    );

    const skills = loadSkillsFromDirectory(tmpDir, { type: "directory", path: tmpDir });
    expect(skills).toHaveLength(2);
    expect(skills.map((s) => s.name).sort()).toEqual(["skill-a", "skill-b"]);
  });

  it("loads skills from nested directory structure (like Google Workspace CLI)", () => {
    // service/gmail-read/SKILL.md
    fs.mkdirSync(path.join(tmpDir, "service", "gmail-read"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "service", "gmail-read", "SKILL.md"),
      `---
name: gmail-read
description: Read Gmail messages
---
Instructions.`,
    );

    // persona/admin/SKILL.md
    fs.mkdirSync(path.join(tmpDir, "persona", "admin"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "persona", "admin", "SKILL.md"),
      `---
name: admin
description: Admin persona
---
Instructions.`,
    );

    const skills = loadSkillsFromDirectory(tmpDir, { type: "directory", path: tmpDir });
    expect(skills).toHaveLength(2);
    expect(skills.map((s) => s.name).sort()).toEqual(["admin", "gmail-read"]);
  });

  it("returns empty array for non-existent directory", () => {
    const skills = loadSkillsFromDirectory("/nonexistent", {
      type: "directory",
      path: "/nonexistent",
    });
    expect(skills).toEqual([]);
  });

  it("returns empty array for empty directory", () => {
    const skills = loadSkillsFromDirectory(tmpDir, { type: "directory", path: tmpDir });
    expect(skills).toEqual([]);
  });

  it("skips hidden directories", () => {
    fs.mkdirSync(path.join(tmpDir, ".hidden", "skill"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".hidden", "skill", "SKILL.md"),
      `---
name: hidden
description: Should be skipped
---
Body.`,
    );

    const skills = loadSkillsFromDirectory(tmpDir, { type: "directory", path: tmpDir });
    expect(skills).toHaveLength(0);
  });

  it("does not recurse into skill directories", () => {
    // A skill with a scripts/ subdirectory (should not be treated as a nested skill)
    const skillDir = path.join(tmpDir, "my-skill");
    fs.mkdirSync(path.join(skillDir, "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---
name: my-skill
description: Has scripts
---
Body.`,
    );
    fs.writeFileSync(path.join(skillDir, "scripts", "run.sh"), "#!/bin/bash");

    const skills = loadSkillsFromDirectory(tmpDir, { type: "directory", path: tmpDir });
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("my-skill");
  });

  it("discovers resources within skill directories", () => {
    const skillDir = path.join(tmpDir, "with-resources");
    fs.mkdirSync(path.join(skillDir, "references"), { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---
name: with-resources
description: Has resources
---
Body.`,
    );
    fs.writeFileSync(path.join(skillDir, "references", "api.md"), "# API docs");

    const skills = loadSkillsFromDirectory(tmpDir, { type: "directory", path: tmpDir });
    expect(skills).toHaveLength(1);
    expect(skills[0].getResources()).toHaveLength(1);
  });

  it("skips malformed SKILL.md and reports warning", () => {
    const skillDir = path.join(tmpDir, "broken-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    // Write a SKILL.md that will fail YAML parsing (unclosed bracket)
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: [unclosed\n---\nBody.");

    const warnings: string[] = [];
    const skills = loadSkillsFromDirectory(tmpDir, { type: "directory", path: tmpDir }, (msg) =>
      warnings.push(msg),
    );

    expect(skills).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("broken-skill");
  });

  it("loads valid skills alongside malformed ones", () => {
    // Valid skill
    const validDir = path.join(tmpDir, "valid-skill");
    fs.mkdirSync(validDir, { recursive: true });
    fs.writeFileSync(
      path.join(validDir, "SKILL.md"),
      "---\nname: valid\ndescription: Valid skill\n---\nBody.",
    );

    // Broken skill
    const brokenDir = path.join(tmpDir, "broken-skill");
    fs.mkdirSync(brokenDir, { recursive: true });
    fs.writeFileSync(path.join(brokenDir, "SKILL.md"), "---\nname: [bad\n---\nBody.");

    const skills = loadSkillsFromDirectory(tmpDir, { type: "directory", path: tmpDir });
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("valid");
  });
});

describe("discoverSkills", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-discover-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("discovers project skills from .llmist/skills/", () => {
    const projectSkillsDir = path.join(tmpDir, ".llmist", "skills", "my-skill");
    fs.mkdirSync(projectSkillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectSkillsDir, "SKILL.md"),
      `---
name: project-skill
description: Project-level skill
---
Body.`,
    );

    const registry = discoverSkills({
      projectDir: tmpDir,
      userDir: "/nonexistent-user-dir",
    });

    expect(registry.size).toBe(1);
    expect(registry.has("project-skill")).toBe(true);
  });

  it("discovers from additional directories", () => {
    const extraDir = path.join(tmpDir, "extra");
    fs.mkdirSync(path.join(extraDir, "extra-skill"), { recursive: true });
    fs.writeFileSync(
      path.join(extraDir, "extra-skill", "SKILL.md"),
      `---
name: extra-skill
description: From additional dir
---
Body.`,
    );

    const registry = discoverSkills({
      userDir: "/nonexistent-user-dir",
      additionalDirs: [extraDir],
    });

    expect(registry.has("extra-skill")).toBe(true);
  });

  it("project skills override user skills on name collision", () => {
    // User skill
    const userDir = path.join(tmpDir, "user-skills");
    fs.mkdirSync(path.join(userDir, "shared"), { recursive: true });
    fs.writeFileSync(
      path.join(userDir, "shared", "SKILL.md"),
      `---
name: shared
description: From user
---
User instructions.`,
    );

    // Project skill with same name
    const projectDir = path.join(tmpDir, "project");
    fs.mkdirSync(path.join(projectDir, ".llmist", "skills", "shared"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, ".llmist", "skills", "shared", "SKILL.md"),
      `---
name: shared
description: From project
---
Project instructions.`,
    );

    const registry = discoverSkills({
      projectDir,
      userDir,
    });

    expect(registry.size).toBe(1);
    expect(registry.get("shared")?.description).toBe("From project");
  });
});
