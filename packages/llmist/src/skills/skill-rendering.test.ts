import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockClient } from "../../../testing/src/index.js";
import { AgentBuilder } from "../agent/builder.js";
import { renderSkillForMcpPrompt } from "../mcp/skill-exporter.js";
import { resolveInstructions } from "./activation.js";
import { createLoadSkillGadget } from "./load-skill-gadget.js";
import { SkillRegistry } from "./registry.js";
import { Skill } from "./skill.js";

vi.mock("node:child_process", () => ({ execSync: vi.fn() }));

const skillContent = [
  "---",
  "name: review",
  "description: Review text",
  "shell: powershell",
  "---",
  "Review $ARGUMENTS with !`template-marker`",
].join("\n");
const skill = Skill.fromContent(skillContent, "/fixture/SKILL.md");
const input = "!`argument-marker`";
const expectedText = "Review !`argument-marker` with !`template-marker`";

describe("skill rendering at the shell boundary", () => {
  beforeEach(() => {
    vi.mocked(execSync).mockReset().mockReturnValue("mock stdout");
  });

  it("preserves text from callers, including positional arguments and variables", () => {
    const result = resolveInstructions("$0 / $ARGUMENTS[1] / $ARGUMENTS / ${VALUE}", {
      arguments: `${input} $&`,
      variables: { VALUE: "!`variable-marker` $0" },
      enableShellPreprocessing: true,
    });
    expect(result).toBe([input, "$&", `${input} $&`, "!`variable-marker` $0"].join(" / "));
    expect(execSync).not.toHaveBeenCalled();
  });

  it("runs only the command written in the trusted template and preserves its stdout", () => {
    vi.mocked(execSync).mockReturnValue("$ARGUMENTS !`output-marker`\n");
    const result = resolveInstructions("!`template-marker $0 ${VALUE}` / $ARGUMENTS", {
      enableShellPreprocessing: true,
      arguments: "description",
      variables: { VALUE: "metadata" },
    });
    expect(execSync).toHaveBeenCalledExactlyOnceWith(
      "template-marker $0 ${VALUE}",
      expect.anything(),
    );
    expect(result).toBe("$ARGUMENTS !`output-marker` / description");
  });

  it("renders pre-activated skills for CLI slash commands as text", () => {
    const dir = mkdtempSync(join(tmpdir(), "llmist-skill-"));
    try {
      const file = join(dir, "SKILL.md");
      writeFileSync(file, skillContent);
      const registry = SkillRegistry.from([Skill.fromContent(skillContent, file)]);
      const agent = new AgentBuilder(createMockClient())
        .withSkills(registry)
        .withSkill(skill.name, input)
        .build();
      expect(agent.getConversation().getBaseMessages()).toContainEqual(
        expect.objectContaining({ role: "system", content: expect.stringContaining(expectedText) }),
      );
      expect(execSync).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns model-supplied arguments as text from LoadSkill", async () => {
    const gadget = createLoadSkillGadget(SkillRegistry.from([skill]));
    const result = await gadget.execute({ skills: [skill.name], arguments: input });
    expect(result).toContain(expectedText);
    expect(execSync).not.toHaveBeenCalled();
  });

  it("returns MCP prompt arguments as text", async () => {
    const result = await renderSkillForMcpPrompt(skill, { arguments: input });
    expect(result.messages[0]?.content).toEqual({ type: "text", text: expectedText });
    expect(execSync).not.toHaveBeenCalled();
  });
});
