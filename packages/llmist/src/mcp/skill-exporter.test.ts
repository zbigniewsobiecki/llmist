/**
 * Tests for the native llmist Skill → MCP prompt exporter.
 */

import { describe, expect, it } from "vitest";
import { Skill } from "../skills/skill.js";
import type { ParsedSkill } from "../skills/types.js";
import {
  renderSkillForMcpPrompt,
  skillToMcpPrompt,
} from "./skill-exporter.js";

function buildSkill(opts: {
  name: string;
  description?: string;
  argumentHint?: string;
  body: string;
}): Skill {
  return new Skill({
    metadata: {
      name: opts.name,
      description: opts.description ?? "",
      ...(opts.argumentHint ? { argumentHint: opts.argumentHint } : {}),
    },
    instructions: opts.body,
    resources: [],
    sourcePath: "/fixture/SKILL.md",
    sourceDir: "/fixture",
    source: { type: "directory", path: "/fixture" },
  });
}

describe("skillToMcpPrompt", () => {
  it("maps name and description", () => {
    const skill = buildSkill({
      name: "code-review",
      description: "Reviews code",
      body: "Review the changes carefully.",
    });
    const prompt = skillToMcpPrompt(skill);
    expect(prompt.name).toBe("code-review");
    expect(prompt.description).toBe("Reviews code");
  });

  it("derives a single argument from argumentHint when present", () => {
    const skill = buildSkill({
      name: "review-pr",
      description: "Review a PR",
      argumentHint: "<pr-number>",
      body: "Review PR $ARGUMENTS",
    });
    const prompt = skillToMcpPrompt(skill);
    expect(prompt.arguments).toBeDefined();
    expect(prompt.arguments).toHaveLength(1);
    expect(prompt.arguments?.[0]).toMatchObject({
      name: "arguments",
      required: false,
    });
  });

  it("emits no arguments when there is no argumentHint", () => {
    const skill = buildSkill({
      name: "explain",
      description: "explain a concept",
      body: "Explain in plain language.",
    });
    const prompt = skillToMcpPrompt(skill);
    expect(prompt.arguments ?? []).toHaveLength(0);
  });
});

describe("renderSkillForMcpPrompt", () => {
  it("returns a single user-role message containing the skill body", async () => {
    const skill = buildSkill({
      name: "review",
      description: "review",
      body: "Review the code:\n$ARGUMENTS",
    });
    const result = await renderSkillForMcpPrompt(skill, { arguments: "<diff>" });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.role).toBe("user");
    expect(
      (result.messages[0]?.content as { type: "text"; text: string }).text,
    ).toContain("<diff>");
    expect(
      (result.messages[0]?.content as { type: "text"; text: string }).text,
    ).toContain("Review the code:");
  });

  it("substitutes $0 etc. positional arguments", async () => {
    const skill = buildSkill({
      name: "fix",
      description: "fix",
      body: "Fix issue #$0 in $1.",
    });
    const result = await renderSkillForMcpPrompt(skill, {
      arguments: "1234 src/foo.ts",
    });
    const text = (result.messages[0]?.content as { type: "text"; text: string }).text;
    expect(text).toContain("Fix issue #1234 in src/foo.ts.");
  });

  it("works with no arguments", async () => {
    const skill = buildSkill({
      name: "ping",
      description: "ping",
      body: "say pong",
    });
    const result = await renderSkillForMcpPrompt(skill, {});
    expect(
      (result.messages[0]?.content as { type: "text"; text: string }).text,
    ).toContain("pong");
  });
});
