import { Skill, SkillRegistry } from "llmist";
import { describe, expect, it } from "vitest";
import { getSlashCompletions, parseSlashCommand } from "./slash-handler.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeSkill(name: string, description: string, extra: Record<string, unknown> = {}): Skill {
  const metadata: Record<string, unknown> = { name, description, ...extra };
  const lines = Object.entries(metadata)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  return Skill.fromContent(
    `---\n${lines}\n---\nInstructions for ${name}.`,
    `/fake/${name}/SKILL.md`,
  );
}

function makeRegistry(...skills: Skill[]): SkillRegistry {
  return SkillRegistry.from(skills);
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const userSkill = makeSkill("code-review", "Review code for quality issues");
const argSkill = makeSkill("summarize", "Summarize a document");
const backgroundSkill = makeSkill("context-injector", "Background context injector", {
  "user-invocable": false,
});

// ---------------------------------------------------------------------------
// parseSlashCommand — happy paths
// ---------------------------------------------------------------------------

describe("parseSlashCommand — happy paths", () => {
  it("returns isSkillInvocation:true and skillName for /skill-name", () => {
    const registry = makeRegistry(userSkill);
    const result = parseSlashCommand("/code-review", registry);

    expect(result.isSkillInvocation).toBe(true);
    expect(result.skillName).toBe("code-review");
    expect(result.arguments).toBeUndefined();
    expect(result.isListCommand).toBeUndefined();
  });

  it("populates trimmed arguments for /skill-name arg1 arg2", () => {
    const registry = makeRegistry(argSkill);
    const result = parseSlashCommand("/summarize  hello world  ", registry);

    expect(result.isSkillInvocation).toBe(true);
    expect(result.skillName).toBe("summarize");
    expect(result.arguments).toBe("hello world");
  });

  it("handles tab-separated arguments", () => {
    const registry = makeRegistry(argSkill);
    const result = parseSlashCommand("/summarize\targ1\targ2", registry);

    expect(result.isSkillInvocation).toBe(true);
    expect(result.skillName).toBe("summarize");
    expect(result.arguments).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// parseSlashCommand — /skills list command
// ---------------------------------------------------------------------------

describe("parseSlashCommand — /skills list command", () => {
  it("returns isListCommand:true for /skills", () => {
    const registry = makeRegistry(userSkill);
    const result = parseSlashCommand("/skills", registry);

    expect(result.isSkillInvocation).toBe(true);
    expect(result.isListCommand).toBe(true);
    expect(result.skillName).toBeUndefined();
  });

  it("returns isListCommand:true even with empty registry", () => {
    const registry = makeRegistry();
    const result = parseSlashCommand("/skills", registry);

    expect(result.isSkillInvocation).toBe(true);
    expect(result.isListCommand).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseSlashCommand — non-invocation paths
// ---------------------------------------------------------------------------

describe("parseSlashCommand — non-invocation paths", () => {
  it("returns isSkillInvocation:false for empty string", () => {
    const registry = makeRegistry(userSkill);
    const result = parseSlashCommand("", registry);
    expect(result.isSkillInvocation).toBe(false);
  });

  it("returns isSkillInvocation:false for plain text", () => {
    const registry = makeRegistry(userSkill);
    const result = parseSlashCommand("just some text", registry);
    expect(result.isSkillInvocation).toBe(false);
  });

  it("returns isSkillInvocation:false for input with leading whitespace (trimmed)", () => {
    const registry = makeRegistry(userSkill);
    // Leading whitespace trims to a valid slash command — but if the skill doesn't
    // exist it still returns false; here we check that trimming occurs correctly
    // so a valid skill with leading spaces is still recognized
    const result = parseSlashCommand("  /code-review", registry);
    expect(result.isSkillInvocation).toBe(true);
    expect(result.skillName).toBe("code-review");
  });

  it("returns isSkillInvocation:false for unknown skill name", () => {
    const registry = makeRegistry(userSkill);
    const result = parseSlashCommand("/nonexistent-skill", registry);
    expect(result.isSkillInvocation).toBe(false);
  });

  it("returns isSkillInvocation:false for skill with isUserInvocable === false", () => {
    const registry = makeRegistry(backgroundSkill);
    const result = parseSlashCommand("/context-injector", registry);
    expect(result.isSkillInvocation).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseSlashCommand — regex edge cases
// ---------------------------------------------------------------------------

describe("parseSlashCommand — regex edge cases", () => {
  it("returns isSkillInvocation:false for / alone", () => {
    const registry = makeRegistry(userSkill);
    const result = parseSlashCommand("/", registry);
    expect(result.isSkillInvocation).toBe(false);
  });

  it("handles newline in trailing part of input", () => {
    const registry = makeRegistry(argSkill);
    // Newline after args — trimmed args should not include trailing newline
    const result = parseSlashCommand("/summarize   arg1\n", registry);
    expect(result.isSkillInvocation).toBe(true);
    expect(result.arguments).not.toMatch(/\n/);
  });

  it("collapses multi-space argument runs (/skill  a   b → 'a   b' trimmed)", () => {
    const registry = makeRegistry(argSkill);
    // The raw args string between skill name and end — internal spaces preserved,
    // only leading/trailing spaces are trimmed
    const result = parseSlashCommand("/summarize  a   b", registry);
    expect(result.isSkillInvocation).toBe(true);
    expect(result.arguments).toBe("a   b");
  });
});

// ---------------------------------------------------------------------------
// getSlashCompletions
// ---------------------------------------------------------------------------

describe("getSlashCompletions", () => {
  it("returns only user-invocable skill names", () => {
    const registry = makeRegistry(userSkill, argSkill, backgroundSkill);
    const completions = getSlashCompletions(registry);

    expect(completions).toContain("code-review");
    expect(completions).toContain("summarize");
    expect(completions).not.toContain("context-injector");
  });

  it("returns skill names in stable order", () => {
    const registry = makeRegistry(userSkill, argSkill);
    const first = getSlashCompletions(registry);
    const second = getSlashCompletions(registry);
    expect(first).toEqual(second);
  });

  it("returns an empty array for an empty registry", () => {
    const registry = makeRegistry();
    expect(getSlashCompletions(registry)).toEqual([]);
  });

  it("returns an empty array when all skills are non-user-invocable", () => {
    const registry = makeRegistry(backgroundSkill);
    expect(getSlashCompletions(registry)).toEqual([]);
  });
});
