import { describe, expect, it } from "vitest";
import { SkillRegistry } from "./registry.js";
import { Skill } from "./skill.js";

function makeSkill(name: string, description: string, extra?: Record<string, unknown>): Skill {
  const metadata: Record<string, unknown> = { name, description, ...extra };
  const lines = Object.entries(metadata)
    .map(([k, v]) => {
      if (k === "paths" || k === "allowed-tools" || k === "gadgets") {
        return `${k}:\n${(v as string[]).map((i) => `  - "${i}"`).join("\n")}`;
      }
      return `${k}: ${v}`;
    })
    .join("\n");
  return Skill.fromContent(
    `---\n${lines}\n---\nInstructions for ${name}.`,
    `/fake/${name}/SKILL.md`,
  );
}

describe("SkillRegistry", () => {
  describe("register and get", () => {
    it("registers and retrieves a skill by name", () => {
      const registry = new SkillRegistry();
      const skill = makeSkill("my-skill", "A test skill");
      registry.register(skill);

      expect(registry.get("my-skill")).toBe(skill);
      expect(registry.has("my-skill")).toBe(true);
      expect(registry.size).toBe(1);
    });

    it("lookup is case-insensitive", () => {
      const registry = new SkillRegistry();
      registry.register(makeSkill("my-skill", "Test"));

      expect(registry.get("MY-SKILL")).toBeDefined();
      expect(registry.has("My-Skill")).toBe(true);
    });

    it("overwrites existing skill with same name", () => {
      const registry = new SkillRegistry();
      registry.register(makeSkill("dupe", "First"));
      registry.register(makeSkill("dupe", "Second"));

      expect(registry.size).toBe(1);
      expect(registry.get("dupe")?.description).toBe("Second");
    });
  });

  describe("registerMany", () => {
    it("registers multiple skills at once", () => {
      const registry = new SkillRegistry();
      registry.registerMany([makeSkill("alpha", "First"), makeSkill("beta", "Second")]);
      expect(registry.size).toBe(2);
    });
  });

  describe("getAll and getNames", () => {
    it("returns all skills and names", () => {
      const registry = SkillRegistry.from([
        makeSkill("alpha", "First"),
        makeSkill("beta", "Second"),
      ]);

      expect(registry.getAll()).toHaveLength(2);
      expect(registry.getNames().sort()).toEqual(["alpha", "beta"]);
    });
  });

  describe("getModelInvocable", () => {
    it("excludes skills with disable-model-invocation", () => {
      const registry = SkillRegistry.from([
        makeSkill("visible", "Visible"),
        makeSkill("hidden", "Hidden", { "disable-model-invocation": true }),
      ]);

      const invocable = registry.getModelInvocable();
      expect(invocable).toHaveLength(1);
      expect(invocable[0].name).toBe("visible");
    });
  });

  describe("getUserInvocable", () => {
    it("excludes skills with user-invocable: false", () => {
      const registry = SkillRegistry.from([
        makeSkill("user-ok", "User can invoke"),
        makeSkill("background", "Background only", { "user-invocable": false }),
      ]);

      const invocable = registry.getUserInvocable();
      expect(invocable).toHaveLength(1);
      expect(invocable[0].name).toBe("user-ok");
    });
  });

  describe("getMetadataSummaries", () => {
    it("generates concise summaries", () => {
      const registry = SkillRegistry.from([
        makeSkill("gmail-read", "Read and search Gmail messages"),
        makeSkill("deploy", "Deploy to production"),
      ]);

      const summaries = registry.getMetadataSummaries();
      expect(summaries).toContain("gmail-read: Read and search Gmail");
      expect(summaries).toContain("deploy: Deploy to production");
    });

    it("respects character budget", () => {
      const skills = Array.from({ length: 100 }, (_, i) =>
        makeSkill(`skill-${i}`, `Description for skill number ${i}`),
      );
      const registry = SkillRegistry.from(skills);

      const summaries = registry.getMetadataSummaries(200);
      expect(summaries.length).toBeLessThanOrEqual(200);
    });

    it("truncates long descriptions", () => {
      const registry = SkillRegistry.from([makeSkill("verbose", "x".repeat(300))]);

      const summaries = registry.getMetadataSummaries();
      expect(summaries).toContain("...");
      expect(summaries.length).toBeLessThan(300);
    });

    it("returns empty string when no model-invocable skills", () => {
      const registry = SkillRegistry.from([
        makeSkill("hidden", "Hidden", { "disable-model-invocation": true }),
      ]);

      expect(registry.getMetadataSummaries()).toBe("");
    });
  });

  describe("findByFilePath", () => {
    it("finds skills matching file path patterns", () => {
      const registry = SkillRegistry.from([
        makeSkill("ts-skill", "TypeScript skill", { paths: ["src/**/*.ts"] }),
        makeSkill("css-skill", "CSS skill", { paths: ["**/*.css"] }),
        makeSkill("no-paths", "No path patterns"),
      ]);

      const matches = registry.findByFilePath("src/components/Button.ts");
      expect(matches).toHaveLength(1);
      expect(matches[0].name).toBe("ts-skill");
    });

    it("returns empty array when no patterns match", () => {
      const registry = SkillRegistry.from([
        makeSkill("ts-skill", "TypeScript skill", { paths: ["**/*.ts"] }),
      ]);

      expect(registry.findByFilePath("readme.md")).toEqual([]);
    });
  });

  describe("merge", () => {
    it("merges another registry", () => {
      const a = SkillRegistry.from([makeSkill("alpha", "First")]);
      const b = SkillRegistry.from([makeSkill("beta", "Second")]);

      a.merge(b);
      expect(a.size).toBe(2);
      expect(a.has("beta")).toBe(true);
    });

    it("overwrites on name collision", () => {
      const a = SkillRegistry.from([makeSkill("shared", "From A")]);
      const b = SkillRegistry.from([makeSkill("shared", "From B")]);

      a.merge(b);
      expect(a.get("shared")?.description).toBe("From B");
    });
  });

  describe("remove and clear", () => {
    it("removes a skill by name", () => {
      const registry = SkillRegistry.from([
        makeSkill("alpha", "First"),
        makeSkill("beta", "Second"),
      ]);

      expect(registry.remove("alpha")).toBe(true);
      expect(registry.size).toBe(1);
      expect(registry.has("alpha")).toBe(false);
    });

    it("returns false when removing non-existent skill", () => {
      const registry = new SkillRegistry();
      expect(registry.remove("ghost")).toBe(false);
    });

    it("clears all skills", () => {
      const registry = SkillRegistry.from([
        makeSkill("alpha", "First"),
        makeSkill("beta", "Second"),
      ]);

      registry.clear();
      expect(registry.size).toBe(0);
      expect(registry.getAll()).toEqual([]);
    });
  });

  describe("static from", () => {
    it("creates a registry from an array", () => {
      const registry = SkillRegistry.from([makeSkill("one", "First"), makeSkill("two", "Second")]);
      expect(registry.size).toBe(2);
    });
  });
});
