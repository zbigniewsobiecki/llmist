import { describe, expect, it } from "vitest";

import {
  getPresetGadgets,
  getSubagent,
  hasPreset,
  hasSubagents,
  type LLMistPackageManifest,
  listPresets,
  listSubagents,
  parseManifest,
  type SubagentManifestEntry,
} from "./manifest.js";

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const validSubagent: SubagentManifestEntry = {
  entryPoint: "./dist/index.js",
  export: "BrowseWeb",
  description: "Autonomous web browser agent",
  defaultModel: "sonnet",
  maxIterations: 15,
};

const validManifest: LLMistPackageManifest = {
  gadgets: "./dist/index.js",
  factory: "./dist/index.js",
  presets: {
    minimal: ["Navigate", "GetFullPageContent"],
    readonly: ["Navigate", "GetFullPageContent", "Screenshot"],
    all: "*",
  },
  subagents: {
    BrowseWeb: validSubagent,
    SearchWeb: {
      entryPoint: "./dist/search.js",
      export: "SearchWeb",
      description: "Web search agent",
    },
  },
};

const minimalManifest: LLMistPackageManifest = {
  gadgets: "./dist/index.js",
};

// ---------------------------------------------------------------------------
// parseManifest
// ---------------------------------------------------------------------------

describe("parseManifest", () => {
  it("returns the llmist manifest object from a valid package.json", () => {
    const pkg = { name: "dhalsim", version: "1.0.0", llmist: validManifest };
    const result = parseManifest(pkg);
    expect(result).toBe(validManifest);
  });

  it("returns manifest when only minimal fields are present", () => {
    const pkg = { llmist: minimalManifest };
    expect(parseManifest(pkg)).toBe(minimalManifest);
  });

  it("returns undefined when llmist field is missing", () => {
    const pkg = { name: "some-package", version: "1.0.0" };
    expect(parseManifest(pkg)).toBeUndefined();
  });

  it("returns undefined when llmist field is null", () => {
    const pkg = { llmist: null };
    expect(parseManifest(pkg as Record<string, unknown>)).toBeUndefined();
  });

  it("returns undefined when llmist field is a string", () => {
    const pkg = { llmist: "not-an-object" };
    expect(parseManifest(pkg)).toBeUndefined();
  });

  it("returns undefined when llmist field is a number", () => {
    const pkg = { llmist: 42 };
    expect(parseManifest(pkg)).toBeUndefined();
  });

  it("returns undefined when llmist field is a boolean", () => {
    const pkg = { llmist: true };
    expect(parseManifest(pkg)).toBeUndefined();
  });

  it("returns the manifest object when llmist is an empty object", () => {
    const pkg = { llmist: {} };
    expect(parseManifest(pkg)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// hasPreset
// ---------------------------------------------------------------------------

describe("hasPreset", () => {
  it("returns true when the preset exists in the manifest", () => {
    expect(hasPreset(validManifest, "minimal")).toBe(true);
    expect(hasPreset(validManifest, "readonly")).toBe(true);
    expect(hasPreset(validManifest, "all")).toBe(true);
  });

  it("returns false when the preset does not exist", () => {
    expect(hasPreset(validManifest, "nonexistent")).toBe(false);
    expect(hasPreset(validManifest, "")).toBe(false);
  });

  it("returns false when the manifest has no presets field", () => {
    expect(hasPreset(minimalManifest, "minimal")).toBe(false);
  });

  it("returns false when the manifest is undefined", () => {
    expect(hasPreset(undefined, "minimal")).toBe(false);
  });

  it("returns false when presets is an empty object", () => {
    const manifest: LLMistPackageManifest = { presets: {} };
    expect(hasPreset(manifest, "minimal")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getPresetGadgets
// ---------------------------------------------------------------------------

describe("getPresetGadgets", () => {
  it("returns the gadget array for an existing preset", () => {
    expect(getPresetGadgets(validManifest, "minimal")).toEqual(["Navigate", "GetFullPageContent"]);
    expect(getPresetGadgets(validManifest, "readonly")).toEqual([
      "Navigate",
      "GetFullPageContent",
      "Screenshot",
    ]);
  });

  it("returns '*' for a wildcard preset", () => {
    expect(getPresetGadgets(validManifest, "all")).toBe("*");
  });

  it("returns undefined when the preset does not exist", () => {
    expect(getPresetGadgets(validManifest, "nonexistent")).toBeUndefined();
  });

  it("returns undefined when the manifest has no presets field", () => {
    expect(getPresetGadgets(minimalManifest, "minimal")).toBeUndefined();
  });

  it("returns undefined when the manifest is undefined", () => {
    expect(getPresetGadgets(undefined, "minimal")).toBeUndefined();
  });

  it("returns an empty array when the preset value is an empty array", () => {
    const manifest: LLMistPackageManifest = {
      presets: { empty: [] },
    };
    expect(getPresetGadgets(manifest, "empty")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// hasSubagents
// ---------------------------------------------------------------------------

describe("hasSubagents", () => {
  it("returns true when the manifest has one or more subagent entries", () => {
    expect(hasSubagents(validManifest)).toBe(true);
  });

  it("returns true when exactly one subagent is present", () => {
    const manifest: LLMistPackageManifest = {
      subagents: { BrowseWeb: validSubagent },
    };
    expect(hasSubagents(manifest)).toBe(true);
  });

  it("returns false when the subagents field is an empty object", () => {
    const manifest: LLMistPackageManifest = { subagents: {} };
    expect(hasSubagents(manifest)).toBe(false);
  });

  it("returns false when the subagents field is absent", () => {
    expect(hasSubagents(minimalManifest)).toBe(false);
  });

  it("returns false when the manifest is undefined", () => {
    expect(hasSubagents(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getSubagent
// ---------------------------------------------------------------------------

describe("getSubagent", () => {
  it("returns the subagent entry when the name exists", () => {
    expect(getSubagent(validManifest, "BrowseWeb")).toBe(validSubagent);
  });

  it("returns the correct entry when multiple subagents are present", () => {
    const result = getSubagent(validManifest, "SearchWeb");
    expect(result).toEqual({
      entryPoint: "./dist/search.js",
      export: "SearchWeb",
      description: "Web search agent",
    });
  });

  it("returns undefined when the subagent name does not exist", () => {
    expect(getSubagent(validManifest, "NonExistent")).toBeUndefined();
  });

  it("returns undefined when the manifest has no subagents field", () => {
    expect(getSubagent(minimalManifest, "BrowseWeb")).toBeUndefined();
  });

  it("returns undefined when the manifest is undefined", () => {
    expect(getSubagent(undefined, "BrowseWeb")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// listSubagents
// ---------------------------------------------------------------------------

describe("listSubagents", () => {
  it("returns all subagent names when multiple subagents are present", () => {
    const names = listSubagents(validManifest);
    expect(names).toHaveLength(2);
    expect(names).toContain("BrowseWeb");
    expect(names).toContain("SearchWeb");
  });

  it("returns a single-element array when only one subagent is present", () => {
    const manifest: LLMistPackageManifest = {
      subagents: { BrowseWeb: validSubagent },
    };
    expect(listSubagents(manifest)).toEqual(["BrowseWeb"]);
  });

  it("returns an empty array when the subagents field is an empty object", () => {
    const manifest: LLMistPackageManifest = { subagents: {} };
    expect(listSubagents(manifest)).toEqual([]);
  });

  it("returns an empty array when the subagents field is absent", () => {
    expect(listSubagents(minimalManifest)).toEqual([]);
  });

  it("returns an empty array when the manifest is undefined", () => {
    expect(listSubagents(undefined)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// listPresets
// ---------------------------------------------------------------------------

describe("listPresets", () => {
  it("returns all preset names when multiple presets are present", () => {
    const names = listPresets(validManifest);
    expect(names).toHaveLength(3);
    expect(names).toContain("minimal");
    expect(names).toContain("readonly");
    expect(names).toContain("all");
  });

  it("returns a single-element array when only one preset is present", () => {
    const manifest: LLMistPackageManifest = {
      presets: { minimal: ["Navigate"] },
    };
    expect(listPresets(manifest)).toEqual(["minimal"]);
  });

  it("returns an empty array when the presets field is an empty object", () => {
    const manifest: LLMistPackageManifest = { presets: {} };
    expect(listPresets(manifest)).toEqual([]);
  });

  it("returns an empty array when the presets field is absent", () => {
    expect(listPresets(minimalManifest)).toEqual([]);
  });

  it("returns an empty array when the manifest is undefined", () => {
    expect(listPresets(undefined)).toEqual([]);
  });
});
