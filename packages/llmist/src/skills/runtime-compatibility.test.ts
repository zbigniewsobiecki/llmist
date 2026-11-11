import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageDir = fileURLToPath(new URL("../../", import.meta.url));
const content =
  '---\nname: consumer-skill\ndescription: Consumer fixture\npaths: ["src/**/*.ts"]\n---\nExact consumer instructions.';

describe("built library skill consumers", () => {
  it.each([
    { format: "ESM", load: 'await import("llmist")', inputType: "module" },
    { format: "CommonJS", load: 'require("llmist")', inputType: "commonjs" },
  ])("built $format consumer selects and activates a skill", ({ load, inputType }) => {
    // A real Node process resolves package exports, bypassing Vitest's source alias.
    const child = spawnSync(
      process.execPath,
      [
        `--input-type=${inputType}`,
        "-e",
        `
          const { Skill, SkillRegistry } = ${load};
          (async () => {
            const skill = Skill.fromContent(
              ${JSON.stringify(content)},
              '/fixture/SKILL.md'
            );
            const selected = SkillRegistry.from([skill]).findByFilePath('src/nested/a.ts');
            const instructions = await selected[0].getInstructions();
            const activation = await selected[0].activate({ enableShellPreprocessing: false });
            console.log(JSON.stringify({
              names: selected.map(s => s.name), instructions,
              skillName: activation.skillName, activated: activation.resolvedInstructions
            }));
          })().catch(error => { console.error(error); process.exitCode = 1; });
        `,
      ],
      { cwd: packageDir, encoding: "utf8", timeout: 5_000 },
    );
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    expect(child.stderr).toBe("");
    expect(JSON.parse(child.stdout)).toEqual({
      names: ["consumer-skill"],
      instructions: "Exact consumer instructions.",
      skillName: "consumer-skill",
      activated: "Exact consumer instructions.",
    });
  });
});
