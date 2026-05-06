import { Readable, Writable } from "node:stream";
import { createLogger, Skill, SkillRegistry } from "llmist";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CLIEnvironment } from "../environment.js";
import { runCLI } from "../program.js";
import { CLISkillManager } from "./skill-manager.js";

// Isolate from developer's actual config file
vi.mock("../config.js", () => ({
  loadConfig: vi.fn(() => {
    throw new Error("Config not available in tests");
  }),
  getCustomCommandNames: vi.fn(() => []),
}));

/**
 * Helper to create a readable stream.
 */
function createReadable(content: string, { isTTY = false } = {}): Readable & { isTTY?: boolean } {
  const stream = Readable.from([content]) as Readable & { isTTY?: boolean };
  stream.isTTY = isTTY;
  return stream;
}

/**
 * Helper to create a writable stream that captures output.
 */
function createWritable(isTTY = false) {
  let data = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      data += chunk.toString();
      callback();
    },
  });
  (stream as NodeJS.WriteStream & { isTTY: boolean }).isTTY = isTTY;
  return { stream, read: () => data };
}

/**
 * Helper to create a minimal CLIEnvironment for testing.
 */
function createEnv(overrides: Partial<CLIEnvironment> = {}): CLIEnvironment {
  const stdin = createReadable("", { isTTY: false });
  const stdout = createWritable();
  const stderr = createWritable();

  return {
    argv: ["node", "llmist"],
    stdin,
    stdout: stdout.stream,
    stderr: stderr.stream,
    createClient: () => {
      throw new Error("Client not provided");
    },
    setExitCode: () => {},
    createLogger: (name: string) => createLogger({ type: "hidden", name }),
    isTTY: false,
    prompt: async () => {
      throw new Error("Cannot prompt in test environment");
    },
    ...overrides,
  };
}

/**
 * Create a fake Skill instance from inline content.
 */
function createFakeSkill(
  name: string,
  description: string,
  options: {
    model?: string;
    context?: "fork" | "inline";
    agent?: string;
    allowedTools?: string[];
    paths?: string[];
    disableModelInvocation?: boolean;
    userInvocable?: boolean;
    instructions?: string;
    resources?: Array<{ category: "scripts" | "references" | "assets"; relativePath: string }>;
  } = {},
): Skill {
  const frontmatter = [
    `name: ${name}`,
    `description: "${description}"`,
    options.model ? `model: ${options.model}` : null,
    options.context ? `context: ${options.context}` : null,
    options.agent ? `agent: ${options.agent}` : null,
    options.allowedTools
      ? `allowed-tools:\n${options.allowedTools.map((t) => `  - ${t}`).join("\n")}`
      : null,
    options.paths ? `paths:\n${options.paths.map((p) => `  - "${p}"`).join("\n")}` : null,
    options.disableModelInvocation ? "disable-model-invocation: true" : null,
    options.userInvocable === false ? "user-invocable: false" : null,
  ]
    .filter(Boolean)
    .join("\n");

  const content = `---\n${frontmatter}\n---\n${options.instructions ?? "## Instructions\n\nDo the thing."}`;

  const skill = Skill.fromContent(content, `/fake/skills/${name}/SKILL.md`);

  // Spy on getInstructions to avoid file system reads
  const instructionsResult = options.instructions ?? "## Instructions\n\nDo the thing.";
  vi.spyOn(skill, "getInstructions").mockResolvedValue(instructionsResult);

  // Spy on getResources to return fake resources
  if (options.resources) {
    vi.spyOn(skill, "getResources").mockReturnValue(
      options.resources.map((r) => ({
        ...r,
        absolutePath: `/fake/skills/${name}/${r.relativePath}`,
      })),
    );
  }

  return skill;
}

/**
 * Create a fake SkillRegistry populated with the given skills.
 */
function createFakeRegistry(skills: Skill[]): SkillRegistry {
  const registry = new SkillRegistry();
  for (const skill of skills) {
    registry.register(skill);
  }
  return registry;
}

describe("skill command", () => {
  afterEach(() => {
    process.exitCode = 0;
    vi.restoreAllMocks();
  });

  describe("skill list", () => {
    it("should print 'No skills found' message when registry is empty", async () => {
      const stdout = createWritable();
      const stderr = createWritable();

      vi.spyOn(CLISkillManager.prototype, "loadAll").mockResolvedValue(createFakeRegistry([]));

      const env = createEnv({
        argv: ["node", "llmist", "skill", "list"],
        stdout: stdout.stream,
        stderr: stderr.stream,
      });

      await runCLI({ config: {}, env });

      const output = stdout.read();
      expect(output).toContain("No skills found.\n");
      expect(output).toContain("~/.llmist/skills/");
    });

    it("should list skill names prefixed with / when skills exist", async () => {
      const stdout = createWritable();
      const stderr = createWritable();

      const skills = [
        createFakeSkill("code-review", "Review code for bugs and best practices"),
        createFakeSkill("refactor", "Refactor code to improve readability"),
      ];

      vi.spyOn(CLISkillManager.prototype, "loadAll").mockResolvedValue(createFakeRegistry(skills));

      const env = createEnv({
        argv: ["node", "llmist", "skill", "list"],
        stdout: stdout.stream,
        stderr: stderr.stream,
      });

      await runCLI({ config: {}, env });

      const output = stdout.read();
      expect(output).toContain("/code-review");
      expect(output).toContain("/refactor");
      expect(output).toContain("Review code for bugs and best practices");
      expect(output).toContain("Refactor code to improve readability");
    });

    it("should show [user-only] flag when disableModelInvocation is true", async () => {
      const stdout = createWritable();
      const stderr = createWritable();

      const skills = [
        createFakeSkill("secret-skill", "A skill only users can invoke", {
          disableModelInvocation: true,
        }),
      ];

      vi.spyOn(CLISkillManager.prototype, "loadAll").mockResolvedValue(createFakeRegistry(skills));

      const env = createEnv({
        argv: ["node", "llmist", "skill", "list"],
        stdout: stdout.stream,
        stderr: stderr.stream,
      });

      await runCLI({ config: {}, env });

      const output = stdout.read();
      expect(output).toContain("[user-only]");
    });

    it("should show [background] flag when userInvocable is false", async () => {
      const stdout = createWritable();
      const stderr = createWritable();

      const skills = [
        createFakeSkill("background-skill", "A background only skill", {
          userInvocable: false,
        }),
      ];

      vi.spyOn(CLISkillManager.prototype, "loadAll").mockResolvedValue(createFakeRegistry(skills));

      const env = createEnv({
        argv: ["node", "llmist", "skill", "list"],
        stdout: stdout.stream,
        stderr: stderr.stream,
      });

      await runCLI({ config: {}, env });

      const output = stdout.read();
      expect(output).toContain("[background]");
    });

    it("should show [fork] flag when context is fork", async () => {
      const stdout = createWritable();
      const stderr = createWritable();

      const skills = [
        createFakeSkill("forked-skill", "A skill that runs in a fork", {
          context: "fork",
        }),
      ];

      vi.spyOn(CLISkillManager.prototype, "loadAll").mockResolvedValue(createFakeRegistry(skills));

      const env = createEnv({
        argv: ["node", "llmist", "skill", "list"],
        stdout: stdout.stream,
        stderr: stderr.stream,
      });

      await runCLI({ config: {}, env });

      const output = stdout.read();
      expect(output).toContain("[fork]");
    });

    it("should show [model:X] flag when model is set", async () => {
      const stdout = createWritable();
      const stderr = createWritable();

      const skills = [
        createFakeSkill("sonnet-skill", "A skill that uses sonnet", {
          model: "sonnet",
        }),
      ];

      vi.spyOn(CLISkillManager.prototype, "loadAll").mockResolvedValue(createFakeRegistry(skills));

      const env = createEnv({
        argv: ["node", "llmist", "skill", "list"],
        stdout: stdout.stream,
        stderr: stderr.stream,
      });

      await runCLI({ config: {}, env });

      const output = stdout.read();
      expect(output).toContain("[model:sonnet]");
    });

    it("should show multiple flags together", async () => {
      const stdout = createWritable();
      const stderr = createWritable();

      const skills = [
        createFakeSkill("complex-skill", "A skill with multiple flags", {
          disableModelInvocation: true,
          context: "fork",
          model: "haiku",
        }),
      ];

      vi.spyOn(CLISkillManager.prototype, "loadAll").mockResolvedValue(createFakeRegistry(skills));

      const env = createEnv({
        argv: ["node", "llmist", "skill", "list"],
        stdout: stdout.stream,
        stderr: stderr.stream,
      });

      await runCLI({ config: {}, env });

      const output = stdout.read();
      expect(output).toContain("[user-only, fork, model:haiku]");
    });

    it("should truncate descriptions longer than 80 characters", async () => {
      const stdout = createWritable();
      const stderr = createWritable();

      const longDesc =
        "This is a very long description that exceeds eighty characters and should be cut off with ellipsis";

      const skills = [createFakeSkill("verbose-skill", longDesc)];

      vi.spyOn(CLISkillManager.prototype, "loadAll").mockResolvedValue(createFakeRegistry(skills));

      const env = createEnv({
        argv: ["node", "llmist", "skill", "list"],
        stdout: stdout.stream,
        stderr: stderr.stream,
      });

      await runCLI({ config: {}, env });

      const output = stdout.read();
      expect(output).toContain("...");
      // The description line should contain the first 77 chars + "..."
      expect(output).toContain(`${longDesc.slice(0, 77)}...`);
      expect(output).not.toContain(longDesc);
    });

    it("should not truncate descriptions of exactly 80 characters", async () => {
      const stdout = createWritable();
      const stderr = createWritable();

      // Exactly 80 chars
      const desc = "A".repeat(80);
      const skills = [createFakeSkill("exact-skill", desc)];

      vi.spyOn(CLISkillManager.prototype, "loadAll").mockResolvedValue(createFakeRegistry(skills));

      const env = createEnv({
        argv: ["node", "llmist", "skill", "list"],
        stdout: stdout.stream,
        stderr: stderr.stream,
      });

      await runCLI({ config: {}, env });

      const output = stdout.read();
      expect(output).toContain(desc);
      expect(output).not.toContain("...");
    });
  });

  describe("skill info", () => {
    it("should display skill details for an existing skill", async () => {
      const stdout = createWritable();
      const stderr = createWritable();

      const skill = createFakeSkill("code-review", "Review code for bugs and best practices", {
        instructions: "Always check for null pointer dereferences.",
      });

      vi.spyOn(CLISkillManager.prototype, "loadAll").mockResolvedValue(createFakeRegistry([skill]));

      const env = createEnv({
        argv: ["node", "llmist", "skill", "info", "code-review"],
        stdout: stdout.stream,
        stderr: stderr.stream,
      });

      await runCLI({ config: {}, env });

      const output = stdout.read();
      expect(output).toContain("Skill: code-review");
      expect(output).toContain("Description: Review code for bugs and best practices");
      expect(output).toContain("Source: /fake/skills/code-review/SKILL.md");
      expect(output).toContain("--- Instructions ---");
      expect(output).toContain("Always check for null pointer dereferences.");
    });

    it("should display optional Model field when present", async () => {
      const stdout = createWritable();
      const stderr = createWritable();

      const skill = createFakeSkill("model-skill", "Uses a specific model", {
        model: "sonnet",
      });

      vi.spyOn(CLISkillManager.prototype, "loadAll").mockResolvedValue(createFakeRegistry([skill]));

      const env = createEnv({
        argv: ["node", "llmist", "skill", "info", "model-skill"],
        stdout: stdout.stream,
        stderr: stderr.stream,
      });

      await runCLI({ config: {}, env });

      const output = stdout.read();
      expect(output).toContain("Model: sonnet");
    });

    it("should display optional Context field when present", async () => {
      const stdout = createWritable();
      const stderr = createWritable();

      const skill = createFakeSkill("fork-skill", "Runs in a fork context", {
        context: "fork",
      });

      vi.spyOn(CLISkillManager.prototype, "loadAll").mockResolvedValue(createFakeRegistry([skill]));

      const env = createEnv({
        argv: ["node", "llmist", "skill", "info", "fork-skill"],
        stdout: stdout.stream,
        stderr: stderr.stream,
      });

      await runCLI({ config: {}, env });

      const output = stdout.read();
      expect(output).toContain("Context: fork");
    });

    it("should display optional Agent field when present", async () => {
      const stdout = createWritable();
      const stderr = createWritable();

      const skill = createFakeSkill("agent-skill", "Uses a specific agent type", {
        agent: "Explore",
      });

      vi.spyOn(CLISkillManager.prototype, "loadAll").mockResolvedValue(createFakeRegistry([skill]));

      const env = createEnv({
        argv: ["node", "llmist", "skill", "info", "agent-skill"],
        stdout: stdout.stream,
        stderr: stderr.stream,
      });

      await runCLI({ config: {}, env });

      const output = stdout.read();
      expect(output).toContain("Agent: Explore");
    });

    it("should display optional Allowed tools field when present", async () => {
      const stdout = createWritable();
      const stderr = createWritable();

      const skill = createFakeSkill("restricted-skill", "A skill with allowed tools", {
        allowedTools: ["FileRead", "FileWrite"],
      });

      vi.spyOn(CLISkillManager.prototype, "loadAll").mockResolvedValue(createFakeRegistry([skill]));

      const env = createEnv({
        argv: ["node", "llmist", "skill", "info", "restricted-skill"],
        stdout: stdout.stream,
        stderr: stderr.stream,
      });

      await runCLI({ config: {}, env });

      const output = stdout.read();
      expect(output).toContain("Allowed tools: FileRead, FileWrite");
    });

    it("should display optional Paths field when present", async () => {
      const stdout = createWritable();
      const stderr = createWritable();

      const skill = createFakeSkill("path-skill", "A skill with path triggers", {
        paths: ["**/*.ts", "**/*.tsx"],
      });

      vi.spyOn(CLISkillManager.prototype, "loadAll").mockResolvedValue(createFakeRegistry([skill]));

      const env = createEnv({
        argv: ["node", "llmist", "skill", "info", "path-skill"],
        stdout: stdout.stream,
        stderr: stderr.stream,
      });

      await runCLI({ config: {}, env });

      const output = stdout.read();
      expect(output).toContain("Paths: **/*.ts, **/*.tsx");
    });

    it("should display resources when present", async () => {
      const stdout = createWritable();
      const stderr = createWritable();

      const skill = createFakeSkill("resource-skill", "A skill with resources", {
        resources: [
          { category: "scripts", relativePath: "check.sh" },
          { category: "references", relativePath: "guide.md" },
        ],
      });

      vi.spyOn(CLISkillManager.prototype, "loadAll").mockResolvedValue(createFakeRegistry([skill]));

      const env = createEnv({
        argv: ["node", "llmist", "skill", "info", "resource-skill"],
        stdout: stdout.stream,
        stderr: stderr.stream,
      });

      await runCLI({ config: {}, env });

      const output = stdout.read();
      expect(output).toContain("Resources: 2");
      expect(output).toContain("scripts/check.sh");
      expect(output).toContain("references/guide.md");
    });

    it("should not display optional fields when metadata is absent", async () => {
      const stdout = createWritable();
      const stderr = createWritable();

      const skill = createFakeSkill("minimal-skill", "A minimal skill with no extras");

      vi.spyOn(CLISkillManager.prototype, "loadAll").mockResolvedValue(createFakeRegistry([skill]));

      const env = createEnv({
        argv: ["node", "llmist", "skill", "info", "minimal-skill"],
        stdout: stdout.stream,
        stderr: stderr.stream,
      });

      await runCLI({ config: {}, env });

      const output = stdout.read();
      expect(output).not.toContain("Model:");
      expect(output).not.toContain("Context:");
      expect(output).not.toContain("Agent:");
      expect(output).not.toContain("Allowed tools:");
      expect(output).not.toContain("Paths:");
      expect(output).not.toContain("Resources:");
    });
  });

  describe("skill info - not found", () => {
    it("should write error to stderr and set exit code 1 when skill not found", async () => {
      const stdout = createWritable();
      const stderr = createWritable();

      const skills = [createFakeSkill("existing-skill", "An existing skill")];
      vi.spyOn(CLISkillManager.prototype, "loadAll").mockResolvedValue(createFakeRegistry(skills));

      const env = createEnv({
        argv: ["node", "llmist", "skill", "info", "missing-skill"],
        stdout: stdout.stream,
        stderr: stderr.stream,
      });

      await runCLI({ config: {}, env });

      const errOutput = stderr.read();
      expect(errOutput).toContain("Skill not found: missing-skill");
      expect(errOutput).toContain("Available skills:");
      expect(process.exitCode).toBe(1);
    });

    it("should list available skills in the error message", async () => {
      const stdout = createWritable();
      const stderr = createWritable();

      const skills = [
        createFakeSkill("alpha", "First skill"),
        createFakeSkill("beta", "Second skill"),
      ];
      vi.spyOn(CLISkillManager.prototype, "loadAll").mockResolvedValue(createFakeRegistry(skills));

      const env = createEnv({
        argv: ["node", "llmist", "skill", "info", "gamma"],
        stdout: stdout.stream,
        stderr: stderr.stream,
      });

      await runCLI({ config: {}, env });

      const errOutput = stderr.read();
      expect(errOutput).toContain("alpha");
      expect(errOutput).toContain("beta");
    });

    it("should show (none) in error message when no skills are available", async () => {
      const stdout = createWritable();
      const stderr = createWritable();

      vi.spyOn(CLISkillManager.prototype, "loadAll").mockResolvedValue(createFakeRegistry([]));

      const env = createEnv({
        argv: ["node", "llmist", "skill", "info", "missing"],
        stdout: stdout.stream,
        stderr: stderr.stream,
      });

      await runCLI({ config: {}, env });

      const errOutput = stderr.read();
      expect(errOutput).toContain("(none)");
    });
  });

  describe("safeLoadConfig failure", () => {
    it("should proceed gracefully when loadConfig throws", async () => {
      // vi.mock at the top makes loadConfig throw — skill list should still work
      const stdout = createWritable();
      const stderr = createWritable();

      vi.spyOn(CLISkillManager.prototype, "loadAll").mockResolvedValue(createFakeRegistry([]));

      const env = createEnv({
        argv: ["node", "llmist", "skill", "list"],
        stdout: stdout.stream,
        stderr: stderr.stream,
      });

      // Pass config: {} so runCLI skips its own loadConfig call;
      // the skill-command's internal safeLoadConfig() still uses the mocked module
      await runCLI({ config: {}, env });

      const output = stdout.read();
      // Should still produce output even if loadConfig throws internally
      expect(output).toContain("No skills found.\n");
    });
  });
});
