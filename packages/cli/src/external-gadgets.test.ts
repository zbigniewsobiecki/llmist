import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Hoist mocks so they run before module-level constants are initialised ---

vi.mock("node:os", () => ({
  default: {
    homedir: vi.fn(() => "/mock-home"),
  },
  homedir: vi.fn(() => "/mock-home"),
}));

vi.mock("node:fs", () => {
  const mockFns = {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    rmSync: vi.fn(),
  };
  return { default: mockFns, ...mockFns };
});

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock("./gadgets.js", () => ({
  extractGadgetsFromModule: vi.fn(),
  createTypeScriptImporter: vi.fn(),
  isTypeScriptFile: vi.fn(),
}));

import { execSync } from "node:child_process";
// --- Import mocked modules after vi.mock declarations ---
import fs from "node:fs";
// Module under test — imported after mocks so module-level constants (CACHE_DIR)
// see our mocked os.homedir().
import {
  isExternalPackageSpecifier,
  loadExternalGadgets,
  parseGadgetSpecifier,
} from "./external-gadgets.js";
import { createTypeScriptImporter, extractGadgetsFromModule, isTypeScriptFile } from "./gadgets.js";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/**
 * Minimal gadget-like object returned from extractGadgetsFromModule.
 */
function makeMockGadget(name = "TestGadget") {
  return { name, description: "a test gadget" };
}

/**
 * Package.json content that includes an llmist.gadgets entry point.
 */
function makePackageJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    name: "test-pkg",
    version: "1.0.0",
    ...overrides,
  });
}

/**
 * Sets up the isTypeScriptFile + createTypeScriptImporter + extractGadgetsFromModule
 * mocks so that the module-loading phase completes successfully.
 * We always use the TypeScript importer path to avoid dynamic import() failures.
 */
function setupModuleLoadMocks(gadgets: ReturnType<typeof makeMockGadget>[] = [makeMockGadget()]) {
  vi.mocked(isTypeScriptFile).mockReturnValue(true);
  const importer = vi.fn().mockResolvedValue({});
  vi.mocked(createTypeScriptImporter).mockReturnValue(importer);
  vi.mocked(extractGadgetsFromModule).mockReturnValue(gadgets as any);
}

/**
 * Configures the standard "all-files-exist" state so a cached npm package
 * goes straight through to module loading without triggering install.
 *
 * The npm CACHE_DIR for "test-pkg" (no version) is:
 *   /mock-home/.llmist/gadget-cache/npm/test-pkg@latest
 * The node_modules path (returned by getPackagePath):
 *   …/test-pkg@latest/node_modules/test-pkg
 */
function setupCachedNpmPackage(
  gadgets: ReturnType<typeof makeMockGadget>[] = [makeMockGadget()],
  packageJsonContent: string = makePackageJson(),
) {
  vi.mocked(fs.existsSync).mockImplementation((p: unknown) => {
    const s = String(p);
    if (s.endsWith("dist/index.js")) return true;
    if (s.endsWith("package.json")) return true;
    if (s.includes("node_modules/test-pkg")) return true;
    return false;
  });

  vi.mocked(fs.readFileSync).mockReturnValue(packageJsonContent as unknown as Buffer);
  setupModuleLoadMocks(gadgets);
}

// --------------------------------------------------------------------------

describe("external-gadgets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // ========================================================================
  // isExternalPackageSpecifier
  // ========================================================================

  describe("isExternalPackageSpecifier", () => {
    it("recognizes npm package names", () => {
      expect(isExternalPackageSpecifier("dhalsim")).toBe(true);
      expect(isExternalPackageSpecifier("dhalsim@2.0.0")).toBe(true);
      expect(isExternalPackageSpecifier("dhalsim:minimal")).toBe(true);
      expect(isExternalPackageSpecifier("dhalsim/BrowseWeb")).toBe(true);
    });

    it("recognizes scoped npm packages", () => {
      expect(isExternalPackageSpecifier("@myorg/my-gadgets")).toBe(true);
      expect(isExternalPackageSpecifier("@myorg/my-gadgets@1.0.0")).toBe(true);
      expect(isExternalPackageSpecifier("@myorg/my-gadgets:preset")).toBe(true);
      expect(isExternalPackageSpecifier("@myorg/my-gadgets/MyGadget")).toBe(true);
    });

    it("recognizes git URLs", () => {
      expect(isExternalPackageSpecifier("git+https://github.com/user/repo.git")).toBe(true);
      expect(isExternalPackageSpecifier("git+https://github.com/user/repo.git#dev")).toBe(true);
      expect(isExternalPackageSpecifier("git+https://github.com/user/repo.git#dev/BrowseWeb")).toBe(
        true,
      );
    });

    it("rejects local file paths", () => {
      expect(isExternalPackageSpecifier("./local-gadget.ts")).toBe(false);
      expect(isExternalPackageSpecifier("/absolute/path.ts")).toBe(false);
      expect(isExternalPackageSpecifier("~/home/gadgets.ts")).toBe(false);
    });
  });

  // ========================================================================
  // parseGadgetSpecifier
  // ========================================================================

  describe("parseGadgetSpecifier", () => {
    describe("npm packages", () => {
      it("parses simple package name", () => {
        const result = parseGadgetSpecifier("dhalsim");
        expect(result).toEqual({
          type: "npm",
          package: "dhalsim",
          version: undefined,
          preset: undefined,
          gadgetName: undefined,
        });
      });

      it("parses package with version", () => {
        const result = parseGadgetSpecifier("dhalsim@2.0.0");
        expect(result).toEqual({
          type: "npm",
          package: "dhalsim",
          version: "2.0.0",
          preset: undefined,
          gadgetName: undefined,
        });
      });

      it("parses package with preset", () => {
        const result = parseGadgetSpecifier("dhalsim:minimal");
        expect(result).toEqual({
          type: "npm",
          package: "dhalsim",
          version: undefined,
          preset: "minimal",
          gadgetName: undefined,
        });
      });

      it("parses package with gadget name", () => {
        const result = parseGadgetSpecifier("dhalsim/BrowseWeb");
        expect(result).toEqual({
          type: "npm",
          package: "dhalsim",
          version: undefined,
          preset: undefined,
          gadgetName: "BrowseWeb",
        });
      });

      it("parses package with version, preset, and gadget name", () => {
        const result = parseGadgetSpecifier("dhalsim@2.0.0:minimal");
        expect(result).toEqual({
          type: "npm",
          package: "dhalsim",
          version: "2.0.0",
          preset: "minimal",
          gadgetName: undefined,
        });
      });

      it("parses scoped package with gadget name", () => {
        const result = parseGadgetSpecifier("@myorg/my-gadgets/MyGadget");
        expect(result).toEqual({
          type: "npm",
          package: "@myorg/my-gadgets",
          version: undefined,
          preset: undefined,
          gadgetName: "MyGadget",
        });
      });

      it("parses scoped package with version and preset", () => {
        const result = parseGadgetSpecifier("@myorg/my-gadgets@1.0.0:readonly");
        expect(result).toEqual({
          type: "npm",
          package: "@myorg/my-gadgets",
          version: "1.0.0",
          preset: "readonly",
          gadgetName: undefined,
        });
      });
    });

    describe("git URLs", () => {
      it("parses simple git URL", () => {
        const result = parseGadgetSpecifier("git+https://github.com/user/repo.git");
        expect(result).toEqual({
          type: "git",
          package: "https://github.com/user/repo.git",
          version: undefined,
          preset: undefined,
          gadgetName: undefined,
        });
      });

      it("parses git URL with ref", () => {
        const result = parseGadgetSpecifier("git+https://github.com/user/repo.git#dev");
        expect(result).toEqual({
          type: "git",
          package: "https://github.com/user/repo.git",
          version: "dev",
          preset: undefined,
          gadgetName: undefined,
        });
      });

      it("parses git URL with ref and gadget name", () => {
        const result = parseGadgetSpecifier("git+https://github.com/user/repo.git#dev/BrowseWeb");
        expect(result).toEqual({
          type: "git",
          package: "https://github.com/user/repo.git",
          version: "dev",
          preset: undefined,
          gadgetName: "BrowseWeb",
        });
      });

      it("parses git URL with ref and preset", () => {
        const result = parseGadgetSpecifier("git+https://github.com/user/repo.git#dev:minimal");
        expect(result).toEqual({
          type: "git",
          package: "https://github.com/user/repo.git",
          version: "dev",
          preset: "minimal",
          gadgetName: undefined,
        });
      });

      it("parses git URL with preset (no ref)", () => {
        const result = parseGadgetSpecifier("git+https://github.com/user/repo.git:minimal");
        expect(result).toEqual({
          type: "git",
          package: "https://github.com/user/repo.git",
          version: undefined,
          preset: "minimal",
          gadgetName: undefined,
        });
      });

      it("parses git URL with gadget name (no ref)", () => {
        const result = parseGadgetSpecifier("git+https://github.com/user/repo.git/BrowseWeb");
        expect(result).toEqual({
          type: "git",
          package: "https://github.com/user/repo.git",
          version: undefined,
          preset: undefined,
          gadgetName: "BrowseWeb",
        });
      });
    });
  });

  // ========================================================================
  // isCached — tested indirectly through loadExternalGadgets
  // ========================================================================

  describe("isCached (via loadExternalGadgets)", () => {
    it("returns false when package.json is missing — triggers install", async () => {
      // The top-level cache package.json does NOT exist → isCached returns false → install triggered.
      // After install, node_modules and entry point become available so the rest of
      // loadExternalGadgets can complete.
      vi.mocked(fs.existsSync).mockImplementation((p: unknown) => {
        const s = String(p);
        if (s.includes("node_modules/test-pkg")) return true;
        if (s.endsWith("dist/index.js")) return true;
        if (s.endsWith("package.json") && s.includes("node_modules")) return true;
        // Top-level cache package.json absent — key condition
        return false;
      });
      vi.mocked(fs.readFileSync).mockReturnValue(makePackageJson() as unknown as Buffer);
      vi.mocked(execSync).mockReturnValue(Buffer.from("") as any);
      setupModuleLoadMocks();

      await loadExternalGadgets("test-pkg");

      // mkdirSync and writeFileSync are called by installNpmPackage
      expect(fs.mkdirSync).toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it("returns false when entry point file is missing — triggers install", async () => {
      // Top-level package.json exists but entry point is absent → isCached returns false.
      vi.mocked(fs.existsSync).mockImplementation((p: unknown) => {
        const s = String(p);
        // After install, provide node_modules and entry point
        if (s.includes("node_modules/test-pkg")) return true;
        // node_modules path for dist/index.js → true (post-install)
        if (s.endsWith("dist/index.js") && s.includes("node_modules")) return true;
        if (s.endsWith("package.json") && s.includes("node_modules")) return true;
        // Top-level cache package.json exists (isCached reads it)
        if (s.endsWith("package.json") && !s.includes("node_modules")) return true;
        // Entry point inside cache dir (not node_modules) is absent — isCached returns false
        if (s.endsWith("dist/index.js")) return false;
        return false;
      });
      vi.mocked(fs.readFileSync).mockReturnValue(makePackageJson() as unknown as Buffer);
      vi.mocked(execSync).mockReturnValue(Buffer.from("") as any);
      setupModuleLoadMocks();

      await loadExternalGadgets("test-pkg");

      // Install must have been triggered
      expect(fs.mkdirSync).toHaveBeenCalled();
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining("npm install"),
        expect.objectContaining({ cwd: expect.any(String) }),
      );
    });

    it("returns true when both package.json and entry point exist — skips install", async () => {
      setupCachedNpmPackage();

      await loadExternalGadgets("test-pkg");

      // mkdirSync must NOT have been called (no install happened)
      expect(fs.mkdirSync).not.toHaveBeenCalled();
      expect(execSync).not.toHaveBeenCalledWith(
        expect.stringContaining("npm install"),
        expect.anything(),
      );
    });
  });

  // ========================================================================
  // readManifest — tested indirectly through loadExternalGadgets
  // ========================================================================

  describe("readManifest (via loadExternalGadgets)", () => {
    it("returns null when node_modules package.json is missing — uses default entry point", async () => {
      // node_modules/test-pkg does NOT exist → getPackagePath returns cacheDir.
      // readManifest is then called on cacheDir, whose package.json has no llmist key,
      // so the default entry point ./dist/index.js is used.
      vi.mocked(fs.existsSync).mockImplementation((p: unknown) => {
        const s = String(p);
        if (s.includes("node_modules")) return false;
        if (s.endsWith("package.json")) return true;
        if (s.endsWith("dist/index.js")) return true;
        return false;
      });
      vi.mocked(fs.readFileSync).mockReturnValue(
        makePackageJson({ llmist: { gadgets: "./dist/index.js" } }) as unknown as Buffer,
      );
      setupModuleLoadMocks();

      const result = await loadExternalGadgets("test-pkg");
      expect(result).toHaveLength(1);
    });

    it("returns manifest when package.json is present", async () => {
      const manifestContent = makePackageJson({
        llmist: { gadgets: "./dist/index.js" },
      });
      setupCachedNpmPackage([makeMockGadget()], manifestContent);

      const result = await loadExternalGadgets("test-pkg");
      expect(result).toHaveLength(1);
      // readFileSync must have been called (manifest was read)
      expect(fs.readFileSync).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // getPackagePath — tested indirectly through loadExternalGadgets
  // ========================================================================

  describe("getPackagePath (via loadExternalGadgets)", () => {
    it("returns node_modules path when npm package directory exists", async () => {
      setupCachedNpmPackage();

      await loadExternalGadgets("test-pkg");

      // existsSync must have been called with the node_modules/test-pkg path
      const calls = vi.mocked(fs.existsSync).mock.calls.map(([p]) => String(p));
      expect(calls.some((p) => p.includes("node_modules/test-pkg"))).toBe(true);
    });

    it("returns cacheDir for git packages when node_modules does not exist", async () => {
      // node_modules directory does not exist → getPackagePath returns cacheDir
      vi.mocked(fs.existsSync).mockImplementation((p: unknown) => {
        const s = String(p);
        if (s.includes("node_modules")) return false;
        if (s.endsWith("package.json")) return true;
        if (s.endsWith("dist/index.js")) return true;
        return false;
      });
      vi.mocked(fs.readFileSync).mockReturnValue(makePackageJson() as unknown as Buffer);
      setupModuleLoadMocks();

      const result = await loadExternalGadgets("git+https://github.com/user/repo.git");
      expect(result).toHaveLength(1);

      // node_modules must have been checked by getPackagePath
      const calls = vi.mocked(fs.existsSync).mock.calls.map(([p]) => String(p));
      expect(calls.some((p) => p.includes("node_modules"))).toBe(true);
    });
  });

  // ========================================================================
  // loadExternalGadgets — invalid specifier
  // ========================================================================

  describe("loadExternalGadgets — invalid specifier", () => {
    it("throws on an invalid specifier", async () => {
      await expect(loadExternalGadgets("!!!invalid!!!")).rejects.toThrow(
        "Invalid external package specifier: !!!invalid!!!",
      );
    });

    it("throws on an empty specifier", async () => {
      await expect(loadExternalGadgets("")).rejects.toThrow("Invalid external package specifier");
    });
  });

  // ========================================================================
  // npm install flow
  // ========================================================================

  describe("npm install flow", () => {
    /**
     * Sets up mocks so that isCached returns false (top-level package.json absent),
     * install succeeds, and subsequent path/entry-point checks all pass.
     */
    function setupFreshNpmInstall(pkgName = "test-pkg") {
      vi.mocked(fs.existsSync).mockImplementation((p: unknown) => {
        const s = String(p);
        if (s.includes(`node_modules/${pkgName}`)) return true;
        if (s.endsWith("dist/index.js")) return true;
        if (s.endsWith("package.json") && s.includes("node_modules")) return true;
        // Top-level cache package.json absent → triggers install
        return false;
      });
      vi.mocked(fs.readFileSync).mockReturnValue(makePackageJson() as unknown as Buffer);
      vi.mocked(execSync).mockReturnValue(Buffer.from("") as any);
      setupModuleLoadMocks();
    }

    it("calls mkdirSync with recursive:true to create cache directory", async () => {
      setupFreshNpmInstall();
      await loadExternalGadgets("test-pkg");

      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining("npm/test-pkg"), {
        recursive: true,
      });
    });

    it("writes a minimal package.json to the cache directory", async () => {
      setupFreshNpmInstall();
      await loadExternalGadgets("test-pkg");

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("package.json"),
        expect.stringContaining('"private": true'),
      );
    });

    it("calls execSync with npm install command and correct cwd", async () => {
      setupFreshNpmInstall();
      await loadExternalGadgets("test-pkg");

      const installCall = vi
        .mocked(execSync)
        .mock.calls.find(([cmd]) => String(cmd).includes("npm install"));
      expect(installCall).toBeDefined();
      const [cmd, opts] = installCall!;
      expect(cmd).toContain("test-pkg");
      expect((opts as any).cwd).toContain("npm/test-pkg");
    });

    it("passes version in npm install command when version is specified", async () => {
      setupFreshNpmInstall("test-pkg");
      await loadExternalGadgets("test-pkg@2.0.0");

      const installCall = vi
        .mocked(execSync)
        .mock.calls.find(([cmd]) => String(cmd).includes("npm install"));
      expect(installCall).toBeDefined();
      expect(String(installCall![0])).toContain("test-pkg@2.0.0");
    });

    it("wraps execSync errors in a descriptive Error", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(execSync).mockImplementation((cmd: unknown) => {
        // npm availability check (which npm) succeeds; actual install fails
        if (String(cmd).includes("which")) return Buffer.from("") as any;
        throw new Error("E404 Not Found");
      });

      await expect(loadExternalGadgets("nonexistent-pkg")).rejects.toThrow(
        /Failed to install npm package.*nonexistent-pkg/,
      );
    });

    it("throws a descriptive error when npm is not available", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("command not found: npm");
      });

      await expect(loadExternalGadgets("test-pkg")).rejects.toThrow(/npm is not available/);
    });
  });

  // ========================================================================
  // Caching behaviour / forceInstall
  // ========================================================================

  describe("caching behaviour", () => {
    it("skips install when package is already cached", async () => {
      setupCachedNpmPackage();

      await loadExternalGadgets("test-pkg");

      expect(fs.mkdirSync).not.toHaveBeenCalled();
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it("re-installs when forceInstall=true even if cached", async () => {
      setupCachedNpmPackage();
      vi.mocked(execSync).mockReturnValue(Buffer.from("") as any);

      await loadExternalGadgets("test-pkg", true /* forceInstall */);

      // Install steps must have run despite cached state
      expect(fs.mkdirSync).toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // installGitPackage flow
  // ========================================================================

  describe("installGitPackage flow", () => {
    const GIT_URL = "git+https://github.com/user/repo.git";
    const GIT_CACHE_DIR_NAME = "https---github.com-user-repo.git@latest";

    /**
     * existsSync call sequence for a FRESH git clone (cacheDirExists=false):
     *
     *  1. isCached: existsSync(cacheDir/package.json)     → false (not cached)
     *  2. installGitPackage: existsSync(cacheDir)         → false (no dir, skip fetch)
     *  3. installGitPackage: !existsSync(cacheDir)        → false → true (enter clone)
     *  4. installGitPackage: existsSync(cacheDir/pkg.json)→ true  (dep install)
     *  5. loadExternalGadgets: getPackagePath node_modules→ false (git = no node_modules)
     *  6. loadExternalGadgets: readManifest pkg.json      → true
     *  7. loadExternalGadgets: existsSync(entryPoint)     → true
     */
    function setupFreshGitClone(packageJsonContent: string = makePackageJson()) {
      vi.mocked(fs.existsSync)
        .mockReturnValueOnce(false) // 1: isCached pkg.json
        .mockReturnValueOnce(false) // 2: cacheDir exists? (update path)
        .mockReturnValueOnce(false) // 3: cacheDir exists? (clone decision)
        .mockReturnValueOnce(true) // 4: post-clone pkg.json (dep install)
        .mockReturnValueOnce(false) // 5: getPackagePath node_modules
        .mockReturnValueOnce(true) // 6: readManifest pkg.json
        .mockReturnValueOnce(true); // 7: entry point
      vi.mocked(fs.readFileSync).mockReturnValue(packageJsonContent as unknown as Buffer);
      vi.mocked(execSync).mockReturnValue(Buffer.from("") as any);
      setupModuleLoadMocks();
    }

    /**
     * existsSync call sequence for EXISTING repo with forceInstall=true:
     *
     *  1. isCached: existsSync(cacheDir/package.json)  → true
     *  2. isCached: existsSync(cacheDir/dist/index.js) → true  → isCached=true but forceInstall wins
     *  3. installGitPackage: existsSync(cacheDir)      → true  (enter fetch path)
     *  4. installGitPackage: !existsSync(cacheDir)     → true  → false (don't clone)
     *  5. loadExternalGadgets: getPackagePath           → false (no node_modules)
     *  6. loadExternalGadgets: readManifest pkg.json   → true
     *  7. loadExternalGadgets: existsSync(entryPoint)  → true
     */
    function setupExistingGitRepo(packageJsonContent: string = makePackageJson()) {
      vi.mocked(fs.existsSync)
        .mockReturnValueOnce(true) // 1: isCached pkg.json
        .mockReturnValueOnce(true) // 2: isCached entry point
        .mockReturnValueOnce(true) // 3: cacheDir exists? (update path) → true → fetch
        .mockReturnValueOnce(true) // 4: cacheDir exists? (clone decision) → true → no clone
        .mockReturnValueOnce(false) // 5: getPackagePath node_modules
        .mockReturnValueOnce(true) // 6: readManifest pkg.json
        .mockReturnValueOnce(true); // 7: entry point
      vi.mocked(fs.readFileSync).mockReturnValue(packageJsonContent as unknown as Buffer);
      vi.mocked(execSync).mockReturnValue(Buffer.from("") as any);
      setupModuleLoadMocks();
    }

    it("performs a fresh git clone when cache directory does not exist", async () => {
      setupFreshGitClone();

      await loadExternalGadgets(GIT_URL);

      const cloneCall = vi
        .mocked(execSync)
        .mock.calls.find(([cmd]) => String(cmd).includes("git clone"));
      expect(cloneCall).toBeDefined();
      expect(String(cloneCall![0])).toContain("https://github.com/user/repo.git");
    });

    it("clones with --branch when version is specified", async () => {
      // Versioned clone: same existsSync sequence as fresh clone
      vi.mocked(fs.existsSync)
        .mockReturnValueOnce(false) // isCached pkg.json
        .mockReturnValueOnce(false) // cacheDir exists? (update path)
        .mockReturnValueOnce(false) // cacheDir exists? (clone decision)
        .mockReturnValueOnce(true) // post-clone pkg.json
        .mockReturnValueOnce(false) // getPackagePath node_modules
        .mockReturnValueOnce(true) // readManifest pkg.json
        .mockReturnValueOnce(true); // entry point
      vi.mocked(fs.readFileSync).mockReturnValue(makePackageJson() as unknown as Buffer);
      vi.mocked(execSync).mockReturnValue(Buffer.from("") as any);
      setupModuleLoadMocks();

      await loadExternalGadgets("git+https://github.com/user/repo.git#v1.0.0");

      const cloneCall = vi
        .mocked(execSync)
        .mock.calls.find(([cmd]) => String(cmd).includes("git clone"));
      expect(cloneCall).toBeDefined();
      expect(String(cloneCall![0])).toContain("--branch v1.0.0");
    });

    it("fetches existing repo when cache directory already exists (forceInstall=true)", async () => {
      setupExistingGitRepo();

      await loadExternalGadgets(GIT_URL, true /* forceInstall */);

      const fetchCall = vi.mocked(execSync).mock.calls.find(([cmd]) => String(cmd) === "git fetch");
      expect(fetchCall).toBeDefined();

      // No clone should happen since directory was already there and fetch succeeded
      const cloneCall = vi
        .mocked(execSync)
        .mock.calls.find(([cmd]) => String(cmd).includes("git clone"));
      expect(cloneCall).toBeUndefined();
    });

    it("removes and re-clones when git fetch fails on existing repo", async () => {
      let dirRemoved = false;
      vi.mocked(fs.rmSync).mockImplementation(() => {
        dirRemoved = true;
      });
      // existsSync sequence for fetch-fail → reclone:
      //  1. isCached: pkg.json → true (dir exists)
      //  2. isCached: entry point → true (isCached=true, forceInstall overrides)
      //  3. installGitPackage: cacheDir → true (enter fetch path)
      //  [execSync("git fetch") throws → rmSync called → dirRemoved=true]
      //  4. installGitPackage: !cacheDir → false (dir gone) → enter clone
      //  5. post-clone pkg.json → true
      //  6. getPackagePath node_modules → false
      //  7. readManifest pkg.json → true
      //  8. entry point → true
      vi.mocked(fs.existsSync)
        .mockReturnValueOnce(true) // 1: isCached pkg.json
        .mockReturnValueOnce(true) // 2: isCached entry point
        .mockReturnValueOnce(true) // 3: cacheDir (enter fetch path)
        .mockReturnValueOnce(false) // 4: !cacheDir (after rmSync → dir gone)
        .mockReturnValueOnce(true) // 5: post-clone pkg.json
        .mockReturnValueOnce(false) // 6: getPackagePath node_modules
        .mockReturnValueOnce(true) // 7: readManifest pkg.json
        .mockReturnValueOnce(true); // 8: entry point
      vi.mocked(fs.readFileSync).mockReturnValue(makePackageJson() as unknown as Buffer);
      vi.mocked(execSync).mockImplementation((cmd: unknown) => {
        if (String(cmd) === "git fetch") throw new Error("network error");
        return Buffer.from("") as any;
      });
      setupModuleLoadMocks();

      await loadExternalGadgets(GIT_URL, true /* forceInstall */);

      expect(fs.rmSync).toHaveBeenCalled();
      const cloneCall = vi
        .mocked(execSync)
        .mock.calls.find(([cmd]) => String(cmd).includes("git clone"));
      expect(cloneCall).toBeDefined();
    });

    it("installs npm dependencies after a fresh clone", async () => {
      setupFreshGitClone();

      await loadExternalGadgets(GIT_URL);

      // "npm install --foreground-scripts …" without a quoted package name = dep install
      const installCall = vi
        .mocked(execSync)
        .mock.calls.find(
          ([cmd]) => String(cmd).includes("npm install") && !String(cmd).includes('"'),
        );
      expect(installCall).toBeDefined();
    });

    it("runs npm run build when package.json has a build script", async () => {
      setupFreshGitClone(makePackageJson({ scripts: { build: "tsc" } }));

      await loadExternalGadgets(GIT_URL);

      const buildCall = vi
        .mocked(execSync)
        .mock.calls.find(
          ([cmd]) => String(cmd).includes("npm run") && String(cmd).includes("build"),
        );
      expect(buildCall).toBeDefined();
    });

    it("does not run npm run build when package.json has no build script", async () => {
      setupFreshGitClone(makePackageJson({ scripts: {} }));

      await loadExternalGadgets(GIT_URL);

      const buildCall = vi
        .mocked(execSync)
        .mock.calls.find(
          ([cmd]) => String(cmd).includes("npm run") && String(cmd).includes("build"),
        );
      expect(buildCall).toBeUndefined();
    });
  });

  // ========================================================================
  // Entry point not found
  // ========================================================================

  describe("entry point resolution", () => {
    it("throws a descriptive error when the entry point file does not exist", async () => {
      // Use forceInstall=true so we bypass isCached and always proceed to the
      // entry point existence check inside loadExternalGadgets.
      vi.mocked(fs.existsSync).mockImplementation((p: unknown) => {
        const s = String(p);
        // Check entry point FIRST so it takes priority over the node_modules check
        if (s.endsWith("dist/index.js")) return false; // entry point absent → descriptive error
        if (s.includes("node_modules/test-pkg")) return true;
        if (s.endsWith("package.json") && s.includes("node_modules")) return true;
        if (s.endsWith("package.json")) return true;
        return false;
      });
      vi.mocked(fs.readFileSync).mockReturnValue(makePackageJson() as unknown as Buffer);
      vi.mocked(execSync).mockReturnValue(Buffer.from("") as any);

      await expect(loadExternalGadgets("test-pkg", true /* forceInstall */)).rejects.toThrow(
        /Entry point not found/,
      );
    });
  });
});
