/**
 * Skill class with lazy-loading progressive disclosure.
 *
 * Tier 1 (metadata) is always available after construction.
 * Tier 2 (instructions) and Tier 3 (resources) are loaded on demand.
 *
 * @module skills/skill
 */

import fs from "node:fs/promises";
import { resolveInstructions } from "./activation.js";
import { parseFrontmatter, parseSkillContent } from "./parser.js";
import type {
  ParsedSkill,
  SkillActivation,
  SkillActivationOptions,
  SkillMetadata,
  SkillResource,
  SkillSource,
} from "./types.js";

export class Skill {
  readonly metadata: SkillMetadata;
  readonly sourcePath: string;
  readonly sourceDir: string;
  readonly source: SkillSource;

  private _instructions: string | null;
  private _resources: SkillResource[];
  private readonly _resourceCache = new Map<string, string>();
  private readonly _resourceLoading = new Map<string, Promise<string>>();

  constructor(parsed: ParsedSkill) {
    this.metadata = parsed.metadata;
    this.sourcePath = parsed.sourcePath;
    this.sourceDir = parsed.sourceDir;
    this.source = parsed.source;
    this._instructions = parsed.instructions;
    this._resources = parsed.resources;
  }

  /** Skill name for registry lookup. */
  get name(): string {
    return this.metadata.name;
  }

  /** Skill description for LLM matching. */
  get description(): string {
    return this.metadata.description;
  }

  /** Whether the LLM can auto-trigger this skill. */
  get isModelInvocable(): boolean {
    return this.metadata.disableModelInvocation !== true;
  }

  /** Whether the user can invoke this skill via /skill-name. */
  get isUserInvocable(): boolean {
    return this.metadata.userInvocable !== false;
  }

  /**
   * Load and cache Tier 2 instructions.
   * If instructions were loaded during parsing, returns the cached value.
   */
  async getInstructions(): Promise<string> {
    if (this._instructions !== null) return this._instructions;

    const content = await fs.readFile(this.sourcePath, "utf-8");
    const { body } = parseFrontmatter(content);
    this._instructions = body;
    return body;
  }

  /**
   * List Tier 3 resources.
   * Resources are discovered at parse time but content is loaded on demand.
   */
  getResources(): SkillResource[] {
    return this._resources;
  }

  /**
   * Load a specific Tier 3 resource by relative path.
   * Results are cached for the lifetime of this Skill instance.
   * Concurrent calls for the same resource share a single read.
   */
  async getResource(relativePath: string): Promise<string> {
    if (relativePath.includes("..")) {
      throw new Error(`Invalid resource path (path traversal): ${relativePath}`);
    }

    const cached = this._resourceCache.get(relativePath);
    if (cached !== undefined) return cached;

    // Deduplicate concurrent loads for the same resource
    const existing = this._resourceLoading.get(relativePath);
    if (existing) return existing;

    const resource = this._resources.find((r) => r.relativePath === relativePath);
    if (!resource) {
      throw new Error(`Resource not found: ${relativePath} in skill ${this.name}`);
    }

    const loadPromise = fs.readFile(resource.absolutePath, "utf-8").then(
      (content) => {
        this._resourceCache.set(relativePath, content);
        this._resourceLoading.delete(relativePath);
        return content;
      },
      (error) => {
        this._resourceLoading.delete(relativePath);
        throw new Error(
          `Failed to load resource ${relativePath} in skill ${this.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      },
    );

    this._resourceLoading.set(relativePath, loadPromise);
    return loadPromise;
  }

  /**
   * Activate this skill with optional arguments.
   *
   * Performs:
   * 1. Variable substitution (${SKILL_DIR}, etc.)
   * 2. Argument substitution ($ARGUMENTS, $0, $1)
   * 3. Shell preprocessing (!`command`)
   * 4. Resource loading (if eagerResources is true)
   */
  async activate(options?: SkillActivationOptions): Promise<SkillActivation> {
    const instructions = await this.getInstructions();

    const resolvedInstructions = resolveInstructions(instructions, {
      arguments: options?.arguments,
      variables: {
        SKILL_DIR: this.sourceDir,
        CLAUDE_SKILL_DIR: this.sourceDir,
      },
      cwd: options?.cwd ?? this.sourceDir,
      shell: this.metadata.shell,
      enableShellPreprocessing: options?.enableShellPreprocessing,
      shellTimeoutMs: options?.shellTimeoutMs,
    });

    const loadedResources = new Map<string, string>();
    if (options?.eagerResources) {
      for (const resource of this._resources) {
        const content = await this.getResource(resource.relativePath);
        loadedResources.set(resource.relativePath, content);
      }
    }

    return {
      skillName: this.name,
      resolvedInstructions,
      gadgets: [], // Gadgets are resolved by the CLI layer
      loadedResources,
    };
  }

  /**
   * Create a Skill from a SKILL.md content string.
   * Useful for testing or dynamic skill creation.
   */
  static fromContent(
    content: string,
    sourcePath: string,
    source: SkillSource = { type: "directory", path: sourcePath },
  ): Skill {
    const parsed = parseSkillContent(content, sourcePath, source, true);
    return new Skill(parsed);
  }
}
