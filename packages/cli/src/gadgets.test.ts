import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock node:fs so we can control existsSync behaviour
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(),
    },
    existsSync: vi.fn(),
  };
});

// Mock builtins index so we can control what's "registered"
vi.mock("./builtins/index.js", () => ({
  getBuiltinGadget: vi.fn(),
  getBuiltinGadgetNames: vi.fn(() => ["MockGadgetA", "MockGadgetB"]),
  isBuiltinGadgetName: vi.fn(),
}));

// Mock external-gadgets module
vi.mock("./external-gadgets.js", () => ({
  isExternalPackageSpecifier: vi.fn(() => false),
  loadExternalGadgets: vi.fn(),
}));

import fs from "node:fs";
import { AbstractGadget } from "llmist";
import { getBuiltinGadget, isBuiltinGadgetName } from "./builtins/index.js";
import { isExternalPackageSpecifier } from "./external-gadgets.js";
import {
  extractGadgetsFromModule,
  isTypeScriptFile,
  loadGadgets,
  resolveGadgetSpecifier,
  tryResolveBuiltin,
} from "./gadgets.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers – minimal gadget fixtures that satisfy AbstractGadget's shape
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a minimal AbstractGadget instance using duck-typing shape.
 * Avoids needing Zod schemas for simple unit tests.
 */
function makeFakeGadgetInstance(name = "FakeGadget"): AbstractGadget {
  return {
    name,
    description: "A fake gadget for testing",
    execute: () => "ok",
    parameterSchema: undefined,
  } as unknown as AbstractGadget;
}

/**
 * Create a concrete subclass of AbstractGadget so we can test class extraction.
 */
function makeFakeGadgetClass(gadgetName = "FakeClassGadget"): new () => AbstractGadget {
  class FakeGadget extends AbstractGadget {
    name = gadgetName;
    description = "A fake class gadget";
    execute() {
      return "ok";
    }
  }
  return FakeGadget;
}

// ─────────────────────────────────────────────────────────────────────────────
// isTypeScriptFile
// ─────────────────────────────────────────────────────────────────────────────

describe("isTypeScriptFile", () => {
  it("returns true for .ts extension", () => {
    expect(isTypeScriptFile("my-gadget.ts")).toBe(true);
  });

  it("returns true for .tsx extension", () => {
    expect(isTypeScriptFile("my-gadget.tsx")).toBe(true);
  });

  it("returns true for .mts extension", () => {
    expect(isTypeScriptFile("my-gadget.mts")).toBe(true);
  });

  it("returns true for .cts extension", () => {
    expect(isTypeScriptFile("my-gadget.cts")).toBe(true);
  });

  it("returns false for .js extension", () => {
    expect(isTypeScriptFile("my-gadget.js")).toBe(false);
  });

  it("returns false for .mjs extension", () => {
    expect(isTypeScriptFile("my-gadget.mjs")).toBe(false);
  });

  it("returns false for .cjs extension", () => {
    expect(isTypeScriptFile("my-gadget.cjs")).toBe(false);
  });

  it("returns false for file with no extension", () => {
    expect(isTypeScriptFile("my-gadget")).toBe(false);
  });

  it("handles file:// URL with .ts extension", () => {
    expect(isTypeScriptFile("file:///home/user/gadget.ts")).toBe(true);
  });

  it("handles file:// URL with .tsx extension", () => {
    expect(isTypeScriptFile("file:///home/user/component.tsx")).toBe(true);
  });

  it("handles file:// URL with .mts extension", () => {
    expect(isTypeScriptFile("file:///home/user/mod.mts")).toBe(true);
  });

  it("handles file:// URL with .cts extension", () => {
    expect(isTypeScriptFile("file:///home/user/mod.cts")).toBe(true);
  });

  it("handles file:// URL with .js extension (returns false)", () => {
    expect(isTypeScriptFile("file:///home/user/gadget.js")).toBe(false);
  });

  it("handles absolute path with .ts extension", () => {
    expect(isTypeScriptFile("/absolute/path/to/gadget.ts")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tryResolveBuiltin
// ─────────────────────────────────────────────────────────────────────────────

describe("tryResolveBuiltin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('explicit "builtin:" prefix', () => {
    it('resolves "builtin:ReadFile" to the ReadFile gadget', () => {
      const fakeGadget = makeFakeGadgetInstance("ReadFile");
      vi.mocked(getBuiltinGadget).mockReturnValue(fakeGadget);

      const result = tryResolveBuiltin("builtin:ReadFile");

      expect(getBuiltinGadget).toHaveBeenCalledWith("ReadFile");
      expect(result).toBe(fakeGadget);
    });

    it("resolves any known builtin: specifier", () => {
      const fakeGadget = makeFakeGadgetInstance("ListDirectory");
      vi.mocked(getBuiltinGadget).mockReturnValue(fakeGadget);

      const result = tryResolveBuiltin("builtin:ListDirectory");

      expect(result).toBe(fakeGadget);
    });

    it('throws for "builtin:UnknownGadget" when gadget is not found', () => {
      vi.mocked(getBuiltinGadget).mockReturnValue(undefined);

      expect(() => tryResolveBuiltin("builtin:UnknownGadget")).toThrow(
        /Unknown builtin gadget: UnknownGadget/,
      );
    });

    it("error message lists available builtins when builtin: prefix used but gadget unknown", () => {
      vi.mocked(getBuiltinGadget).mockReturnValue(undefined);

      expect(() => tryResolveBuiltin("builtin:NoSuchGadget")).toThrow(/Available builtins/);
    });
  });

  describe("bare name resolution (no prefix, no path chars)", () => {
    it("resolves bare name matching a registered builtin", () => {
      const fakeGadget = makeFakeGadgetInstance("WriteFile");
      vi.mocked(isBuiltinGadgetName).mockReturnValue(true);
      vi.mocked(getBuiltinGadget).mockReturnValue(fakeGadget);

      const result = tryResolveBuiltin("WriteFile");

      expect(isBuiltinGadgetName).toHaveBeenCalledWith("WriteFile");
      expect(result).toBe(fakeGadget);
    });

    it("returns null for bare name that is NOT a builtin", () => {
      vi.mocked(isBuiltinGadgetName).mockReturnValue(false);

      const result = tryResolveBuiltin("SomeRandomGadget");

      expect(result).toBeNull();
    });

    it("returns null for file-like specifiers even if they look like a name", () => {
      // Relative paths should not trigger the bare-name builtin check
      vi.mocked(isBuiltinGadgetName).mockReturnValue(true);

      const result = tryResolveBuiltin("./ReadFile");

      expect(result).toBeNull();
    });

    it("returns null for absolute path specifiers", () => {
      vi.mocked(isBuiltinGadgetName).mockReturnValue(true);

      const result = tryResolveBuiltin("/usr/local/ReadFile.ts");

      expect(result).toBeNull();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveGadgetSpecifier
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveGadgetSpecifier", () => {
  const cwd = "/workspace/myproject";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("converts a relative path to a file:// URL when file exists", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = resolveGadgetSpecifier("./gadgets/my-gadget.ts", cwd);
    const expectedAbsolute = path.resolve(cwd, "./gadgets/my-gadget.ts");

    expect(result).toBe(`file://${expectedAbsolute}`);
  });

  it("converts an absolute path to a file:// URL when file exists", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = resolveGadgetSpecifier("/absolute/path/gadget.ts", cwd);

    expect(result).toBe("file:///absolute/path/gadget.ts");
  });

  it("throws when the resolved file does not exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    expect(() => resolveGadgetSpecifier("./missing.ts", cwd)).toThrow(/Gadget module not found at/);
  });

  it("returns non-file specifiers unchanged (npm module name)", () => {
    // npm package names are not file-like specifiers
    const result = resolveGadgetSpecifier("some-npm-package", cwd);

    // Should not call existsSync for non-file specifiers
    expect(fs.existsSync).not.toHaveBeenCalled();
    expect(result).toBe("some-npm-package");
  });

  it("expands ~ paths and returns file:// URL when file exists", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = resolveGadgetSpecifier("~/gadgets/my-gadget.ts", cwd);

    // The result should be a file:// URL (not contain ~)
    expect(result).toMatch(/^file:\/\//);
    expect(result).not.toContain("~");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// extractGadgetsFromModule
// ─────────────────────────────────────────────────────────────────────────────

describe("extractGadgetsFromModule", () => {
  it("extracts a gadget instance from the default export", () => {
    const gadget = makeFakeGadgetInstance("DefaultExport");
    // Simulate: module.exports = gadgetInstance  (default export pattern)
    const moduleExports = { default: gadget };

    const result = extractGadgetsFromModule(moduleExports);

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(gadget);
  });

  it("extracts a gadget instance from named exports", () => {
    const gadget = makeFakeGadgetInstance("NamedExport");
    const moduleExports = { myGadget: gadget };

    const result = extractGadgetsFromModule(moduleExports);

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(gadget);
  });

  it("extracts multiple gadget instances from named exports", () => {
    const g1 = makeFakeGadgetInstance("Gadget1");
    const g2 = makeFakeGadgetInstance("Gadget2");
    const moduleExports = { g1, g2 };

    const result = extractGadgetsFromModule(moduleExports);

    expect(result).toHaveLength(2);
    expect(result).toContain(g1);
    expect(result).toContain(g2);
  });

  it("instantiates a gadget class (AbstractGadget subclass)", () => {
    const FakeGadgetClass = makeFakeGadgetClass("ClassGadget");
    const moduleExports = { FakeGadgetClass };

    const result = extractGadgetsFromModule(moduleExports);

    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(AbstractGadget);
    expect(result[0].name).toBe("ClassGadget");
  });

  it("extracts gadgets from an array export", () => {
    const g1 = makeFakeGadgetInstance("ArrayGadget1");
    const g2 = makeFakeGadgetInstance("ArrayGadget2");
    const moduleExports = { gadgets: [g1, g2] };

    const result = extractGadgetsFromModule(moduleExports);

    expect(result).toHaveLength(2);
    expect(result).toContain(g1);
    expect(result).toContain(g2);
  });

  it("extracts gadgets from a top-level array (default export as array)", () => {
    const g1 = makeFakeGadgetInstance("Arr1");
    const g2 = makeFakeGadgetInstance("Arr2");
    const moduleExports = [g1, g2];

    const result = extractGadgetsFromModule(moduleExports);

    expect(result).toHaveLength(2);
    expect(result).toContain(g1);
    expect(result).toContain(g2);
  });

  it("uses duck typing to detect gadget-like objects (not AbstractGadget instances)", () => {
    // An object that quacks like a gadget but is not an AbstractGadget instance
    const duckGadget = {
      name: "DuckGadget",
      description: "A duck-typed gadget",
      execute: () => "quack",
      parameterSchema: {}, // has 'parameterSchema' key
    };
    const moduleExports = { duckGadget };

    const result = extractGadgetsFromModule(moduleExports);

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(duckGadget);
  });

  it("uses duck typing: schema property also satisfies gadget detection", () => {
    // Objects with 'schema' (instead of 'parameterSchema') should also be detected
    const duckGadget = {
      name: "DuckGadget2",
      description: "Another duck-typed gadget",
      execute: () => "quack",
      schema: {}, // has 'schema' key
    };
    const moduleExports = { duckGadget };

    const result = extractGadgetsFromModule(moduleExports);

    expect(result).toHaveLength(1);
  });

  it("returns empty array for module with no gadgets", () => {
    const moduleExports = { notAGadget: 42, anotherThing: "hello" };

    const result = extractGadgetsFromModule(moduleExports);

    expect(result).toHaveLength(0);
  });

  it("returns empty array for null module", () => {
    const result = extractGadgetsFromModule(null);
    expect(result).toHaveLength(0);
  });

  it("returns empty array for undefined module", () => {
    const result = extractGadgetsFromModule(undefined);
    expect(result).toHaveLength(0);
  });

  it("handles mixed exports: instances, classes, and arrays", () => {
    const instance = makeFakeGadgetInstance("InstanceGadget");
    const FakeClass = makeFakeGadgetClass("ClassGadget");
    const arrGadget = makeFakeGadgetInstance("ArrayGadget");

    const moduleExports = {
      instance,
      FakeClass,
      gadgets: [arrGadget],
    };

    const result = extractGadgetsFromModule(moduleExports);

    expect(result).toHaveLength(3);
  });

  it("does not include duplicate gadgets (visited set prevents re-entry)", () => {
    const gadget = makeFakeGadgetInstance("SharedGadget");
    // Same gadget referenced in two places
    const moduleExports = { a: gadget, b: gadget };

    const result = extractGadgetsFromModule(moduleExports);

    // Should appear only once
    expect(result).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// loadGadgets
// ─────────────────────────────────────────────────────────────────────────────

describe("loadGadgets", () => {
  const cwd = "/workspace/myproject";

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: files don't exist unless test overrides
    vi.mocked(fs.existsSync).mockReturnValue(false);
    // Default: no external packages
    vi.mocked(isExternalPackageSpecifier).mockReturnValue(false);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("builtin resolution", () => {
    it("loads a builtin gadget by name", async () => {
      const fakeGadget = makeFakeGadgetInstance("ReadFile");
      vi.mocked(isBuiltinGadgetName).mockReturnValue(true);
      vi.mocked(getBuiltinGadget).mockReturnValue(fakeGadget);

      const result = await loadGadgets(["ReadFile"], cwd, async () => ({}));

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(fakeGadget);
    });

    it("loads a builtin gadget with explicit builtin: prefix", async () => {
      const fakeGadget = makeFakeGadgetInstance("WriteFile");
      vi.mocked(getBuiltinGadget).mockReturnValue(fakeGadget);

      const result = await loadGadgets(["builtin:WriteFile"], cwd, async () => ({}));

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(fakeGadget);
    });

    it("throws when builtin: prefix used but gadget does not exist", async () => {
      vi.mocked(getBuiltinGadget).mockReturnValue(undefined);

      await expect(loadGadgets(["builtin:Nonexistent"], cwd, async () => ({}))).rejects.toThrow(
        /Unknown builtin gadget/,
      );
    });
  });

  describe("file path loading with custom importer", () => {
    it("loads gadgets from a file path", async () => {
      const fakeGadget = makeFakeGadgetInstance("FileGadget");
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(isBuiltinGadgetName).mockReturnValue(false);

      const importer = vi.fn().mockResolvedValue({ default: fakeGadget });

      const result = await loadGadgets(["./gadgets/my-gadget.ts"], cwd, importer);

      expect(importer).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(fakeGadget);
    });

    it("applies :Name filter when loading a file path with :GadgetName suffix", async () => {
      const g1 = makeFakeGadgetInstance("BrowseWeb");
      const g2 = makeFakeGadgetInstance("SearchFiles");
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(isBuiltinGadgetName).mockReturnValue(false);

      const importer = vi.fn().mockResolvedValue({ BrowseWeb: g1, SearchFiles: g2 });

      const result = await loadGadgets(["./gadgets/index.ts:BrowseWeb"], cwd, importer);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(g1);
    });

    it("throws when :Name filter matches no gadgets in module", async () => {
      const g1 = makeFakeGadgetInstance("BrowseWeb");
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(isBuiltinGadgetName).mockReturnValue(false);

      const importer = vi.fn().mockResolvedValue({ BrowseWeb: g1 });

      await expect(loadGadgets(["./gadgets/index.ts:NonExistent"], cwd, importer)).rejects.toThrow(
        /NonExistent.*not found/,
      );
    });

    it("throws when module file cannot be loaded", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(isBuiltinGadgetName).mockReturnValue(false);

      const importer = vi.fn().mockRejectedValue(new Error("Module parse error"));

      await expect(loadGadgets(["./bad-module.ts"], cwd, importer)).rejects.toThrow(
        /Failed to load gadget module/,
      );
    });

    it("throws when module file does not exist on disk", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(isBuiltinGadgetName).mockReturnValue(false);

      const importer = vi.fn();

      await expect(loadGadgets(["./missing-file.ts"], cwd, importer)).rejects.toThrow(
        /Gadget module not found at/,
      );
      // importer should not have been called since the file doesn't exist
      expect(importer).not.toHaveBeenCalled();
    });

    it("throws when module exports no gadgets", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(isBuiltinGadgetName).mockReturnValue(false);

      const importer = vi.fn().mockResolvedValue({ notAGadget: 42 });

      await expect(loadGadgets(["./empty-module.ts"], cwd, importer)).rejects.toThrow(
        /does not export any Gadget instances/,
      );
    });

    it("loads multiple specifiers and returns all gadgets", async () => {
      const g1 = makeFakeGadgetInstance("Gadget1");
      const g2 = makeFakeGadgetInstance("Gadget2");

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(isBuiltinGadgetName).mockReturnValue(false);

      const importer = vi
        .fn()
        .mockResolvedValueOnce({ default: g1 })
        .mockResolvedValueOnce({ default: g2 });

      const result = await loadGadgets(["./gadget1.ts", "./gadget2.ts"], cwd, importer);

      expect(result).toHaveLength(2);
      expect(result).toContain(g1);
      expect(result).toContain(g2);
    });
  });

  describe("error propagation", () => {
    it("wraps importer errors with context about the failing specifier", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(isBuiltinGadgetName).mockReturnValue(false);

      const importer = vi.fn().mockRejectedValue(new Error("SyntaxError in module"));

      await expect(loadGadgets(["./broken.ts"], cwd, importer)).rejects.toThrow(
        /Failed to load gadget module '\.\/broken\.ts'/,
      );
    });
  });
});
