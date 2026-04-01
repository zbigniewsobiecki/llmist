/**
 * Testing utilities for skills.
 *
 * Provides helpers for parsing, activating, and asserting on skills
 * without requiring filesystem setup.
 *
 * @module testing/skill-testing
 */

import {
  type ParsedSkill,
  parseSkillContent,
  Skill,
  type SkillActivation,
  type SkillActivationOptions,
  type SkillMetadata,
  validateMetadata,
} from "llmist";

/**
 * Parse and validate a SKILL.md content string.
 *
 * @param content - Full SKILL.md content (frontmatter + body)
 * @param sourcePath - Optional source path (defaults to /test/SKILL.md)
 * @returns Parsed skill with instructions loaded
 *
 * @example
 * ```typescript
 * import { testSkillParse } from '@llmist/testing';
 *
 * const parsed = testSkillParse(`---
 * name: my-skill
 * description: A test skill
 * ---
 * Do the thing.`);
 *
 * expect(parsed.metadata.name).toBe('my-skill');
 * ```
 */
export function testSkillParse(content: string, sourcePath = "/test/skill/SKILL.md"): ParsedSkill {
  return parseSkillContent(content, sourcePath, { type: "directory", path: "/test/skill" }, true);
}

/**
 * Test a skill's activation with given arguments.
 *
 * @param skill - Skill instance to activate
 * @param options - Activation options (arguments, cwd, etc.)
 * @returns Activation result with resolved instructions
 *
 * @example
 * ```typescript
 * import { testSkillActivation, mockSkill } from '@llmist/testing';
 *
 * const skill = mockSkill({ name: 'search' });
 * const activation = await testSkillActivation(skill, { arguments: '*.ts' });
 * expect(activation.resolvedInstructions).toContain('*.ts');
 * ```
 */
export async function testSkillActivation(
  skill: Skill,
  options?: SkillActivationOptions,
): Promise<SkillActivation> {
  return skill.activate({
    ...options,
    // Disable shell preprocessing in tests by default for safety
    cwd: options?.cwd ?? "/test",
    enableShellPreprocessing: options?.enableShellPreprocessing ?? false,
  });
}

/**
 * Assert that a skill's resolved instructions contain expected content.
 *
 * @param activation - The activation result to check
 * @param expected - Array of strings that must be present in the instructions
 * @throws AssertionError if any expected string is missing
 */
export function assertSkillContains(activation: SkillActivation, expected: string[]): void {
  for (const text of expected) {
    if (!activation.resolvedInstructions.includes(text)) {
      throw new Error(
        `Expected skill instructions to contain "${text}" but it was not found.\n` +
          `Instructions: ${activation.resolvedInstructions.slice(0, 500)}...`,
      );
    }
  }
}

/**
 * Validate a SKILL.md content string and return any issues.
 *
 * @param content - Full SKILL.md content
 * @returns Array of validation issues (empty if valid)
 */
export function validateSkill(content: string): string[] {
  const parsed = testSkillParse(content);
  return validateMetadata(parsed.metadata);
}

/**
 * Create a mock Skill instance for testing.
 *
 * @param overrides - Override any metadata fields
 * @param instructions - Custom instructions body
 */
export function mockSkill(
  overrides?: Partial<SkillMetadata>,
  instructions = "Mock skill instructions for testing.",
): Skill {
  const name = overrides?.name ?? "mock-skill";
  const description = overrides?.description ?? "A mock skill for testing";

  const metadataLines = Object.entries({ name, description, ...overrides })
    .filter(([_, v]) => v !== undefined)
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}:\n${v.map((i) => `  - "${i}"`).join("\n")}`;
      return `${k}: ${v}`;
    })
    .join("\n");

  return Skill.fromContent(
    `---\n${metadataLines}\n---\n${instructions}`,
    `/mock/${name}/SKILL.md`,
    { type: "directory", path: `/mock/${name}` },
  );
}

/**
 * Fluent builder for creating test skills.
 *
 * @example
 * ```typescript
 * import { MockSkillBuilder } from '@llmist/testing';
 *
 * const skill = new MockSkillBuilder()
 *   .withName('gmail-read')
 *   .withDescription('Read Gmail messages')
 *   .withInstructions('Use gws to read emails.')
 *   .build();
 * ```
 */
export class MockSkillBuilder {
  private _name = "mock-skill";
  private _description = "A mock skill";
  private _instructions = "Mock instructions.";
  private _overrides: Record<string, unknown> = {};

  withName(name: string): this {
    this._name = name;
    return this;
  }

  withDescription(description: string): this {
    this._description = description;
    return this;
  }

  withInstructions(instructions: string): this {
    this._instructions = instructions;
    return this;
  }

  withModel(model: string): this {
    this._overrides.model = model;
    return this;
  }

  withContext(context: "fork" | "inline"): this {
    this._overrides.context = context;
    return this;
  }

  withPaths(paths: string[]): this {
    this._overrides.paths = paths;
    return this;
  }

  withAllowedTools(tools: string[]): this {
    this._overrides["allowed-tools"] = tools;
    return this;
  }

  withGadgets(gadgets: string[]): this {
    this._overrides.gadgets = gadgets;
    return this;
  }

  build(): Skill {
    return mockSkill(
      {
        name: this._name,
        description: this._description,
        ...this._overrides,
      } as Partial<SkillMetadata>,
      this._instructions,
    );
  }
}
