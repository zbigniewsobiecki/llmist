import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseSkillFile } from "./parser.js";
import { Skill } from "./skill.js";
import type { SkillSource } from "./types.js";

const testSource: SkillSource = { type: "project", path: "/test" };

describe("Skill", () => {
  describe("static properties", () => {
    it("exposes name and description from metadata", () => {
      const skill = Skill.fromContent(
        `---
name: test-skill
description: A test skill
---
Instructions.`,
        "/fake/test-skill/SKILL.md",
      );

      expect(skill.name).toBe("test-skill");
      expect(skill.description).toBe("A test skill");
    });

    it("isModelInvocable defaults to true", () => {
      const skill = Skill.fromContent(
        `---
name: invocable
description: Default
---
Body.`,
        "/fake/SKILL.md",
      );
      expect(skill.isModelInvocable).toBe(true);
    });

    it("isModelInvocable is false when disable-model-invocation is true", () => {
      const skill = Skill.fromContent(
        `---
name: no-auto
description: No auto trigger
disable-model-invocation: true
---
Body.`,
        "/fake/SKILL.md",
      );
      expect(skill.isModelInvocable).toBe(false);
    });

    it("isUserInvocable defaults to true", () => {
      const skill = Skill.fromContent(
        `---
name: user-ok
description: Default
---
Body.`,
        "/fake/SKILL.md",
      );
      expect(skill.isUserInvocable).toBe(true);
    });

    it("isUserInvocable is false when user-invocable is false", () => {
      const skill = Skill.fromContent(
        `---
name: background
description: Background only
user-invocable: false
---
Body.`,
        "/fake/SKILL.md",
      );
      expect(skill.isUserInvocable).toBe(false);
    });
  });

  describe("getInstructions", () => {
    it("returns instructions loaded at construction time", async () => {
      const skill = Skill.fromContent(
        `---
name: eager
description: Eager loading
---
Eager instructions here.`,
        "/fake/SKILL.md",
      );

      const instructions = await skill.getInstructions();
      expect(instructions).toBe("Eager instructions here.");
    });

    it("lazy-loads instructions from disk when not pre-loaded", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-lazy-"));
      try {
        const skillDir = path.join(tmpDir, "lazy-skill");
        fs.mkdirSync(skillDir, { recursive: true });
        const skillPath = path.join(skillDir, "SKILL.md");
        fs.writeFileSync(
          skillPath,
          `---
name: lazy
description: Lazy test
---
Lazy-loaded instructions.`,
        );

        // Parse with loadInstructions=false
        const parsed = parseSkillFile(skillPath, testSource, false);
        const skill = new Skill(parsed);
        expect(parsed.instructions).toBeNull();

        // Lazy load should read from disk
        const instructions = await skill.getInstructions();
        expect(instructions).toBe("Lazy-loaded instructions.");

        // Second call returns cached value
        const cached = await skill.getInstructions();
        expect(cached).toBe("Lazy-loaded instructions.");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("activate", () => {
    it("substitutes $ARGUMENTS", async () => {
      const skill = Skill.fromContent(
        `---
name: with-args
description: Uses arguments
---
Check this file: $ARGUMENTS`,
        "/fake/SKILL.md",
      );

      const activation = await skill.activate({ arguments: "readme.md" });
      expect(activation.resolvedInstructions).toContain("readme.md");
      expect(activation.skillName).toBe("with-args");
    });

    it("substitutes ${SKILL_DIR}", async () => {
      const skill = Skill.fromContent(
        "---\nname: with-vars\ndescription: Uses variables\n---\nLook in ${SKILL_DIR}/scripts for helpers.",
        "/fake/with-vars/SKILL.md",
      );

      const activation = await skill.activate();
      expect(activation.resolvedInstructions).toContain("/fake/with-vars/scripts");
    });

    it("returns empty gadgets array", async () => {
      const skill = Skill.fromContent(
        `---
name: no-gadgets
description: No gadgets
---
Body.`,
        "/fake/SKILL.md",
      );

      const activation = await skill.activate();
      expect(activation.gadgets).toEqual([]);
    });

    it("loads resources eagerly when requested", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-eager-"));
      try {
        const skillDir = path.join(tmpDir, "eager-skill");
        fs.mkdirSync(path.join(skillDir, "references"), { recursive: true });
        fs.writeFileSync(
          path.join(skillDir, "SKILL.md"),
          `---
name: eager-resources
description: Eager resource loading
---
Check references.`,
        );
        fs.writeFileSync(
          path.join(skillDir, "references", "docs.md"),
          "# Documentation\nHelpful content.",
        );

        const parsed = parseSkillFile(path.join(skillDir, "SKILL.md"), testSource, true);
        const skill = new Skill(parsed);

        const activation = await skill.activate({ eagerResources: true });
        expect(activation.loadedResources.size).toBe(1);
        expect(activation.loadedResources.get(path.join("references", "docs.md"))).toContain(
          "Helpful content",
        );
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("getResource", () => {
    it("loads and caches a resource", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-resource-"));
      try {
        const skillDir = path.join(tmpDir, "res-skill");
        fs.mkdirSync(path.join(skillDir, "scripts"), { recursive: true });
        fs.writeFileSync(
          path.join(skillDir, "SKILL.md"),
          `---
name: res-skill
description: Resource test
---
Body.`,
        );
        fs.writeFileSync(path.join(skillDir, "scripts", "helper.sh"), "#!/bin/bash\necho hello");

        const parsed = parseSkillFile(path.join(skillDir, "SKILL.md"), testSource, true);
        const skill = new Skill(parsed);

        const content = await skill.getResource(path.join("scripts", "helper.sh"));
        expect(content).toContain("echo hello");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("throws for unknown resource path", async () => {
      const skill = Skill.fromContent(
        `---
name: no-res
description: No resources
---
Body.`,
        "/fake/SKILL.md",
      );

      await expect(skill.getResource("nonexistent.txt")).rejects.toThrow("Resource not found");
    });

    it("rejects path traversal attempts", async () => {
      const skill = Skill.fromContent(
        `---
name: traversal
description: Path traversal test
---
Body.`,
        "/fake/SKILL.md",
      );

      await expect(skill.getResource("../../etc/passwd")).rejects.toThrow("path traversal");
    });

    it("deduplicates concurrent loads for the same resource", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-concurrent-"));
      try {
        const skillDir = path.join(tmpDir, "concurrent-skill");
        fs.mkdirSync(path.join(skillDir, "references"), { recursive: true });
        fs.writeFileSync(
          path.join(skillDir, "SKILL.md"),
          "---\nname: concurrent\ndescription: Concurrent test\n---\nBody.",
        );
        fs.writeFileSync(path.join(skillDir, "references", "data.md"), "# Concurrent Data");

        const parsed = parseSkillFile(path.join(skillDir, "SKILL.md"), testSource, true);
        const skill = new Skill(parsed);

        // Fire two loads concurrently — should not error or duplicate
        const [a, b] = await Promise.all([
          skill.getResource(path.join("references", "data.md")),
          skill.getResource(path.join("references", "data.md")),
        ]);
        expect(a).toBe(b);
        expect(a).toContain("Concurrent Data");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("fromContent", () => {
    it("creates a Skill from string content", () => {
      const skill = Skill.fromContent(
        `---
name: from-string
description: Created from string
model: flash
---
String-based instructions.`,
        "/fake/from-string/SKILL.md",
      );

      expect(skill.name).toBe("from-string");
      expect(skill.metadata.model).toBe("flash");
    });
  });
});
