import { describe, expect, it } from "vitest";
import { isExternalPackageSpecifier, parseGadgetSpecifier } from "./external-gadgets.js";

describe("external-gadgets", () => {
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
});
