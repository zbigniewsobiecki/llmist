/**
 * Unit tests for CLISkillManager.loadAll
 *
 * Strategy: vi.mock("llmist", ...) with importOriginal so that
 * discoverSkills/loadSkillsFromDirectory are stubbed while other
 * llmist re-exports still resolve normally.
 */

import os from "node:os";
import path from "node:path";
import { SkillRegistry } from "llmist";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLISkillManager } from "./skill-manager.js";

// ---------------------------------------------------------------------------
// Mock llmist — stub only discoverSkills and loadSkillsFromDirectory
// Use vi.hoisted so variables are available inside the vi.mock factory
// ---------------------------------------------------------------------------

const { mockDiscoverSkills, mockLoadSkillsFromDirectory } = vi.hoisted(() => ({
  mockDiscoverSkills: vi.fn<typeof import("llmist").discoverSkills>(),
  mockLoadSkillsFromDirectory: vi.fn<typeof import("llmist").loadSkillsFromDirectory>(),
}));

vi.mock("llmist", async (importOriginal) => {
  const actual = await importOriginal<typeof import("llmist")>();
  return {
    ...actual,
    discoverSkills: mockDiscoverSkills,
    loadSkillsFromDirectory: mockLoadSkillsFromDirectory,
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a real (empty) SkillRegistry with optional spy methods. */
function makeRegistry(): SkillRegistry {
  const registry = new SkillRegistry();
  vi.spyOn(registry, "registerMany");
  vi.spyOn(registry, "remove");
  return registry;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let manager: CLISkillManager;
let registry: SkillRegistry;

beforeEach(() => {
  manager = new CLISkillManager();
  registry = makeRegistry();

  // Default: discoverSkills returns a fresh spy-wrapped registry
  mockDiscoverSkills.mockReturnValue(registry);
  // Default: loadSkillsFromDirectory returns an empty array
  mockLoadSkillsFromDirectory.mockReturnValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Default discovery path
// ---------------------------------------------------------------------------

describe("CLISkillManager.loadAll — default discovery", () => {
  it("calls discoverSkills with projectDir: process.cwd() when no config is provided", async () => {
    await manager.loadAll();

    expect(mockDiscoverSkills).toHaveBeenCalledOnce();
    expect(mockDiscoverSkills).toHaveBeenCalledWith({ projectDir: process.cwd() });
  });

  it("calls discoverSkills with projectDir: process.cwd() when config has no sources or overrides", async () => {
    await manager.loadAll({});

    expect(mockDiscoverSkills).toHaveBeenCalledWith({ projectDir: process.cwd() });
  });

  it("returns the registry returned by discoverSkills", async () => {
    const result = await manager.loadAll();

    expect(result).toBe(registry);
  });
});

// ---------------------------------------------------------------------------
// Custom projectDir
// ---------------------------------------------------------------------------

describe("CLISkillManager.loadAll — custom projectDir", () => {
  it("passes a custom projectDir directly to discoverSkills", async () => {
    await manager.loadAll(undefined, "/custom/project");

    expect(mockDiscoverSkills).toHaveBeenCalledWith({ projectDir: "/custom/project" });
  });

  it("passes custom projectDir even when config is provided", async () => {
    await manager.loadAll({ sources: [] }, "/another/dir");

    expect(mockDiscoverSkills).toHaveBeenCalledWith({ projectDir: "/another/dir" });
  });
});

// ---------------------------------------------------------------------------
// sources configuration
// ---------------------------------------------------------------------------

describe("CLISkillManager.loadAll — sources", () => {
  it("calls loadSkillsFromDirectory for each source", async () => {
    await manager.loadAll({ sources: ["/abs/path-a", "/abs/path-b"] });

    expect(mockLoadSkillsFromDirectory).toHaveBeenCalledTimes(2);
    expect(mockLoadSkillsFromDirectory).toHaveBeenCalledWith("/abs/path-a", {
      type: "directory",
      path: "/abs/path-a",
    });
    expect(mockLoadSkillsFromDirectory).toHaveBeenCalledWith("/abs/path-b", {
      type: "directory",
      path: "/abs/path-b",
    });
  });

  it("calls registry.registerMany with skills returned by each source", async () => {
    const skillA = { name: "skill-a" } as import("llmist").Skill;
    const skillB = { name: "skill-b" } as import("llmist").Skill;

    mockLoadSkillsFromDirectory.mockReturnValueOnce([skillA]).mockReturnValueOnce([skillB]);

    await manager.loadAll({ sources: ["/abs/path-a", "/abs/path-b"] });

    expect(registry.registerMany).toHaveBeenCalledTimes(2);
    expect(registry.registerMany).toHaveBeenCalledWith([skillA]);
    expect(registry.registerMany).toHaveBeenCalledWith([skillB]);
  });

  it("does not call loadSkillsFromDirectory when sources is empty", async () => {
    await manager.loadAll({ sources: [] });

    expect(mockLoadSkillsFromDirectory).not.toHaveBeenCalled();
  });

  it("does not call loadSkillsFromDirectory when sources is absent", async () => {
    await manager.loadAll({});

    expect(mockLoadSkillsFromDirectory).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Source path resolution
// ---------------------------------------------------------------------------

describe("CLISkillManager.loadAll — source path resolution", () => {
  it("expands ~/foo to os.homedir() + '/foo'", async () => {
    await manager.loadAll({ sources: ["~/foo"] });

    const expected = path.join(os.homedir(), "/foo");
    expect(mockLoadSkillsFromDirectory).toHaveBeenCalledWith(expected, {
      type: "directory",
      path: expected,
    });
  });

  it("expands ~foo (no slash) using os.homedir() join", async () => {
    await manager.loadAll({ sources: ["~foo"] });

    // skill-manager slices from index 1, so "foo" is joined with homedir
    const expected = path.join(os.homedir(), "foo");
    expect(mockLoadSkillsFromDirectory).toHaveBeenCalledWith(expected, {
      type: "directory",
      path: expected,
    });
  });

  it("resolves a relative path via path.resolve", async () => {
    await manager.loadAll({ sources: ["./relative/dir"] });

    const expected = path.resolve("./relative/dir");
    expect(mockLoadSkillsFromDirectory).toHaveBeenCalledWith(expected, {
      type: "directory",
      path: expected,
    });
  });

  it("returns absolute paths unchanged (via path.resolve which is idempotent)", async () => {
    await manager.loadAll({ sources: ["/foo/bar"] });

    expect(mockLoadSkillsFromDirectory).toHaveBeenCalledWith("/foo/bar", {
      type: "directory",
      path: "/foo/bar",
    });
  });
});

// ---------------------------------------------------------------------------
// Override: enabled === false
// ---------------------------------------------------------------------------

describe("CLISkillManager.loadAll — overrides (enabled: false)", () => {
  it("calls registry.remove for a skill with enabled: false", async () => {
    await manager.loadAll({ overrides: { "my-skill": { enabled: false } } });

    expect(registry.remove).toHaveBeenCalledOnce();
    expect(registry.remove).toHaveBeenCalledWith("my-skill");
  });

  it("calls registry.remove for each disabled skill", async () => {
    await manager.loadAll({
      overrides: {
        "skill-a": { enabled: false },
        "skill-b": { enabled: false },
      },
    });

    expect(registry.remove).toHaveBeenCalledTimes(2);
    expect(registry.remove).toHaveBeenCalledWith("skill-a");
    expect(registry.remove).toHaveBeenCalledWith("skill-b");
  });
});

// ---------------------------------------------------------------------------
// Override: enabled === true (no-op)
// ---------------------------------------------------------------------------

describe("CLISkillManager.loadAll — overrides (enabled: true)", () => {
  it("does NOT call registry.remove when enabled is true", async () => {
    await manager.loadAll({ overrides: { "my-skill": { enabled: true } } });

    expect(registry.remove).not.toHaveBeenCalled();
  });

  it("does NOT call registry.remove when enabled is absent", async () => {
    await manager.loadAll({ overrides: { "my-skill": { model: "flash" } } });

    expect(registry.remove).not.toHaveBeenCalled();
  });

  it("does NOT call registry.remove when overrides is empty", async () => {
    await manager.loadAll({ overrides: {} });

    expect(registry.remove).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Combined: sources + overrides end-to-end
// ---------------------------------------------------------------------------

describe("CLISkillManager.loadAll — combined sources + overrides", () => {
  it("loads sources first, then applies overrides", async () => {
    const callOrder: string[] = [];

    mockLoadSkillsFromDirectory.mockImplementation(() => {
      callOrder.push("loadSkillsFromDirectory");
      return [];
    });

    vi.spyOn(registry, "registerMany").mockImplementation(() => {
      callOrder.push("registerMany");
    });

    vi.spyOn(registry, "remove").mockImplementation((_name: string) => {
      callOrder.push("remove");
      return true;
    });

    await manager.loadAll({
      sources: ["/abs/path"],
      overrides: { "disabled-skill": { enabled: false } },
    });

    expect(callOrder).toEqual(["loadSkillsFromDirectory", "registerMany", "remove"]);
  });

  it("end-to-end: skills from sources are in registry, disabled skill is removed", async () => {
    // Use a real registry (not spy-wrapped) to verify actual state
    const realRegistry = new SkillRegistry();
    mockDiscoverSkills.mockReturnValue(realRegistry);

    const { Skill } = await import("llmist");
    const makeSkill = (name: string) =>
      Skill.fromContent(
        `---\nname: ${name}\ndescription: desc\n---\nBody.`,
        `/fake/${name}/SKILL.md`,
      );

    const skillKeep = makeSkill("keep-skill");
    const skillRemove = makeSkill("remove-skill");

    mockLoadSkillsFromDirectory.mockReturnValueOnce([skillKeep]).mockReturnValueOnce([skillRemove]);

    const result = await manager.loadAll({
      sources: ["/path/a", "/path/b"],
      overrides: { "remove-skill": { enabled: false } },
    });

    expect(result.has("keep-skill")).toBe(true);
    expect(result.has("remove-skill")).toBe(false);
  });
});
