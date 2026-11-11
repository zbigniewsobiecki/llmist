import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const cli = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));

it("built CLI lists and describes a project skill", () => {
  const project = mkdtempSync(join(tmpdir(), "llmist-runtime-"));
  const name = basename(project).toLowerCase();
  const skillDir = join(project, ".llmist", "skills", name);
  const instructions = "Exact project skill instructions.";
  try {
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---\nname: ${name}\ndescription: Runtime project fixture\npaths: ["src/**/*.ts"]\n---\n${instructions}`,
    );
    const run = (...args: string[]) => {
      const child = spawnSync(process.execPath, [cli, "skill", ...args], {
        cwd: project,
        encoding: "utf8",
        timeout: 5_000,
      });
      expect(child.error).toBeUndefined();
      expect(child.status, child.stderr).toBe(0);
      expect(child.stderr).toBe("");
      return child.stdout;
    };
    expect(run("list")).toContain(`/${name}`);
    const info = run("info", name);
    expect(info).toContain(`Skill: ${name}\n`);
    expect(info).toContain("Paths: src/**/*.ts\n");
    expect(info).toContain(`Source: ${join(skillDir, "SKILL.md")}\n`);
    expect(info.split("--- Instructions ---\n\n")[1]).toBe(`${instructions}\n`);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
