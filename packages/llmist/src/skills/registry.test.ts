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
    it.each([
      { name: "matches a top-level file", patterns: ["*.ts"], yes: ["main.ts"], no: [] },
      {
        name: "matches nested globstar paths",
        patterns: ["src/**/*.ts"],
        yes: ["src/main.ts", "src/a/b.ts"],
        no: [],
      },
      {
        name: "rejects a nonmatching extension",
        patterns: ["**/*.ts"],
        yes: [],
        no: ["readme.md"],
      },
      {
        name: "selects when only a later pattern matches",
        patterns: ["**/*.css", "**/*.ts"],
        yes: ["src/a.ts"],
        no: [],
      },
      {
        name: "returns a skill once when multiple patterns match",
        patterns: ["**/*.ts", "src/**"],
        yes: ["src/a.ts"],
        no: [],
      },
      {
        name: "preserves default dotfile handling",
        patterns: ["**/*.ts", "explicit/.*.ts"],
        yes: ["explicit/.hidden.ts"],
        no: ["src/.hidden.ts"],
      },
      {
        name: "preserves brace alternatives",
        patterns: ["src/*.{ts,tsx}"],
        yes: ["src/a.tsx", "src/a.ts"],
        no: ["src/a.js"],
      },
      {
        name: "preserves extglob alternatives",
        patterns: ["src/@(a|b).ts"],
        yes: ["src/b.ts"],
        no: ["src/c.ts"],
      },
      {
        name: "preserves case-sensitive matching",
        patterns: ["src/*.ts"],
        yes: [],
        no: ["SRC/a.TS"],
      },
      {
        name: "preserves segment boundaries",
        patterns: ["src/*.ts"],
        yes: [],
        no: ["src/nested/a.ts"],
      },
      {
        name: "preserves default negation",
        patterns: ["!**/*.test.ts"],
        yes: ["src/a.ts"],
        no: ["src/a.test.ts"],
      },
      {
        name: "preserves character classes",
        patterns: ["src/[ab]?.ts"],
        yes: ["src/a1.ts", "src/b2.ts"],
        no: ["src/c1.ts", "src/a.ts"],
      },
      {
        name: "preserves escaped metacharacters",
        patterns: [String.raw`src/\[draft\].ts`],
        yes: ["src/[draft].ts"],
        no: ["src/d.ts"],
      },
      {
        name: "preserves literal Unicode without normalization",
        patterns: ["src/café.ts"],
        yes: ["src/café.ts"],
        no: ["src/cafe\u0301.ts"],
      },
      {
        name: "preserves default level-one path optimization",
        patterns: ["src/temp/../**/**/a.ts"],
        yes: ["src/a.ts", "src/nested/a.ts"],
        no: ["src/nested/b.ts"],
      },
      { name: "preserves comment patterns", patterns: ["#*.ts"], yes: [], no: ["#main.ts"] },
      {
        name: "accepts owner-approved negative extglob suffix matching",
        patterns: ["src/!(a)*.ts"],
        yes: ["src/ab.ts"],
        no: [],
      },
      {
        name: "accepts owner-approved astral character wildcard matching",
        patterns: ["src/?.ts"],
        yes: ["src/😀.ts"],
        no: [],
      },
    ])("$name", ({ patterns, yes, no }) => {
      // JSON arrays are also YAML arrays and preserve backslash escapes in patterns.
      const skill = Skill.fromContent(
        `---\nname: selected\ndescription: File selection\npaths: ${JSON.stringify(patterns)}\n---\nInstructions.`,
        "/fake/selected/SKILL.md",
      );
      const registry = SkillRegistry.from([skill]);
      for (const filePath of yes) {
        expect(registry.findByFilePath(filePath).map((s) => s.name)).toEqual(["selected"]);
      }
      for (const filePath of no) {
        expect(registry.findByFilePath(filePath).map((s) => s.name)).toEqual([]);
      }
    });

    it("excludes absent paths", () => {
      const skill = makeSkill("absent", "No paths");
      expect(skill.metadata.paths).toBeUndefined();
      expect(SkillRegistry.from([skill]).findByFilePath("src/a.ts")).toEqual([]);
    });

    it("excludes empty paths", () => {
      const skill = Skill.fromContent(
        "---\nname: empty\ndescription: Empty paths\npaths: []\n---\nInstructions.",
        "/fake/empty/SKILL.md",
      );
      expect(skill.metadata.paths).toEqual([]);
      expect(SkillRegistry.from([skill]).findByFilePath("src/a.ts")).toEqual([]);
    });

    it("excludes model-disabled matching skills", () => {
      const skill = makeSkill("disabled", "Disabled", {
        paths: ["**/*.ts"],
        "disable-model-invocation": true,
      });
      expect(SkillRegistry.from([skill]).findByFilePath("src/a.ts")).toEqual([]);
    });

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
