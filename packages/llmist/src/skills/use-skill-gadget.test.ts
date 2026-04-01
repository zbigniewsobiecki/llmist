import { describe, expect, it } from "vitest";
import { SkillRegistry } from "./registry.js";
import { Skill } from "./skill.js";
import { createUseSkillGadget, USE_SKILL_GADGET_NAME } from "./use-skill-gadget.js";

function makeSkill(name: string, description: string, instructions: string): Skill {
  return Skill.fromContent(
    `---\nname: ${name}\ndescription: ${description}\n---\n${instructions}`,
    `/fake/${name}/SKILL.md`,
  );
}

describe("createUseSkillGadget", () => {
  it("creates a gadget with UseSkill name", () => {
    const registry = SkillRegistry.from([makeSkill("test-skill", "A test skill", "Do the thing.")]);

    const gadget = createUseSkillGadget(registry);
    expect(gadget.name).toBe(USE_SKILL_GADGET_NAME);
  });

  it("includes skill summaries in description", () => {
    const registry = SkillRegistry.from([
      makeSkill("gmail-read", "Read Gmail messages", "Instructions."),
      makeSkill("deploy", "Deploy to production", "Instructions."),
    ]);

    const gadget = createUseSkillGadget(registry);
    expect(gadget.description).toContain("gmail-read");
    expect(gadget.description).toContain("deploy");
  });

  it("returns skill instructions when executed", async () => {
    const registry = SkillRegistry.from([
      makeSkill("greet", "Greet the user", "Say hello warmly and ask how they are."),
    ]);

    const gadget = createUseSkillGadget(registry);
    const result = await gadget.execute({ skill: "greet" });
    expect(result).toContain("Say hello warmly");
  });

  it("substitutes arguments in skill instructions", async () => {
    const registry = SkillRegistry.from([
      makeSkill("search", "Search for files", "Search for: $ARGUMENTS"),
    ]);

    const gadget = createUseSkillGadget(registry);
    const result = await gadget.execute({ skill: "search", arguments: "*.ts" });
    expect(result).toContain("*.ts");
  });

  it("returns error message for unknown skill", async () => {
    const registry = SkillRegistry.from([makeSkill("real", "A real skill", "Body.")]);

    const gadget = createUseSkillGadget(registry);
    const result = await gadget.execute({ skill: "fake" });
    expect(String(result)).toContain("Unknown skill");
  });

  it("excludes non-model-invocable skills from enum", () => {
    const hidden = Skill.fromContent(
      "---\nname: hidden\ndescription: Hidden\ndisable-model-invocation: true\n---\nBody.",
      "/fake/hidden/SKILL.md",
    );
    const visible = makeSkill("visible", "Visible skill", "Body.");

    const registry = SkillRegistry.from([hidden, visible]);
    const gadget = createUseSkillGadget(registry);

    // Description should only mention the visible skill
    expect(gadget.description).toContain("visible");
    expect(gadget.description).not.toContain("hidden");
  });

  it("full integration: parse -> register -> gadget -> activate", async () => {
    // End-to-end flow that exercises the complete skill pipeline
    const skill = Skill.fromContent(
      `---
name: deploy
description: Deploy to production
argument-hint: "<version>"
---

Deploy version $ARGUMENTS to production.
1. Run tests
2. Build artifacts
3. Push to registry`,
      "/fake/deploy/SKILL.md",
    );

    const registry = SkillRegistry.from([skill]);
    expect(registry.size).toBe(1);
    expect(registry.getModelInvocable()).toHaveLength(1);

    const gadget = createUseSkillGadget(registry);
    expect(gadget.name).toBe("UseSkill");

    const result = await gadget.execute({ skill: "deploy", arguments: "v2.1.0" });
    const text = String(result);
    expect(text).toContain("Deploy version v2.1.0 to production");
    expect(text).toContain("Run tests");
    expect(text).toContain("Push to registry");
  });
});
