import { describe, expect, it } from "vitest";
import {
  assertSkillContains,
  MockSkillBuilder,
  mockSkill,
  testSkillActivation,
  testSkillParse,
  validateSkill,
} from "./skill-testing.js";

describe("testSkillParse", () => {
  it("parses SKILL.md content", () => {
    const parsed = testSkillParse(`---
name: test-skill
description: A test skill
model: sonnet
---
Do the thing with $ARGUMENTS.`);

    expect(parsed.metadata.name).toBe("test-skill");
    expect(parsed.metadata.description).toBe("A test skill");
    expect(parsed.metadata.model).toBe("sonnet");
    expect(parsed.instructions).toContain("Do the thing");
  });
});

describe("testSkillActivation", () => {
  it("activates a skill with arguments", async () => {
    const skill = mockSkill({ name: "search" }, "Search for: $ARGUMENTS");
    const activation = await testSkillActivation(skill, { arguments: "*.ts" });

    expect(activation.skillName).toBe("search");
    expect(activation.resolvedInstructions).toContain("*.ts");
  });

  it("works without arguments", async () => {
    const skill = mockSkill({ name: "greet" }, "Say hello.");
    const activation = await testSkillActivation(skill);
    expect(activation.resolvedInstructions).toContain("Say hello");
  });
});

describe("assertSkillContains", () => {
  it("passes when all expected strings are present", async () => {
    const skill = mockSkill({}, "Step 1: Read. Step 2: Write. Step 3: Test.");
    const activation = await testSkillActivation(skill);

    expect(() => assertSkillContains(activation, ["Step 1", "Step 2", "Step 3"])).not.toThrow();
  });

  it("throws when an expected string is missing", async () => {
    const skill = mockSkill({}, "Only step 1.");
    const activation = await testSkillActivation(skill);

    expect(() => assertSkillContains(activation, ["step 1", "step 2"])).toThrow("step 2");
  });
});

describe("validateSkill", () => {
  it("returns no issues for valid skill", () => {
    const issues = validateSkill(`---
name: valid
description: A valid skill
---
Body.`);
    expect(issues).toEqual([]);
  });

  it("returns issues for invalid skill", () => {
    const issues = validateSkill(`---
name: Invalid_Name
description: Bad name
---
Body.`);
    expect(issues.length).toBeGreaterThan(0);
  });
});

describe("mockSkill", () => {
  it("creates a skill with defaults", () => {
    const skill = mockSkill();
    expect(skill.name).toBe("mock-skill");
    expect(skill.description).toBe("A mock skill for testing");
  });

  it("applies overrides", () => {
    const skill = mockSkill({ name: "custom", description: "Custom desc" });
    expect(skill.name).toBe("custom");
    expect(skill.description).toBe("Custom desc");
  });
});

describe("MockSkillBuilder", () => {
  it("builds a skill with fluent API", () => {
    const skill = new MockSkillBuilder()
      .withName("gmail-read")
      .withDescription("Read Gmail messages")
      .withInstructions("Use gws to read emails.")
      .withModel("flash")
      .build();

    expect(skill.name).toBe("gmail-read");
    expect(skill.description).toBe("Read Gmail messages");
    expect(skill.metadata.model).toBe("flash");
  });

  it("builds with all options", async () => {
    const skill = new MockSkillBuilder()
      .withName("deploy")
      .withDescription("Deploy to production")
      .withInstructions("Deploy $ARGUMENTS now.")
      .withContext("fork")
      .withPaths(["src/**/*.ts"])
      .build();

    expect(skill.metadata.context).toBe("fork");
    const activation = await testSkillActivation(skill, { arguments: "v2.0" });
    expect(activation.resolvedInstructions).toContain("Deploy v2.0 now.");
  });
});
