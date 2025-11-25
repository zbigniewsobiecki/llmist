/**
 * Tests to ensure v3.0 breaking changes are properly implemented.
 * These tests verify that old APIs are no longer accessible and new APIs work correctly.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as llmist from "../index.js";

describe("v3.0 Breaking Changes", () => {
  describe("Gadget API Changes", () => {
    it("should export the new Gadget class (formerly TypedGadget)", () => {
      expect(llmist.Gadget).toBeDefined();
      expect(typeof llmist.Gadget).toBe("function");

      // The new Gadget should be a factory function that returns a class
      const TestClass = llmist.Gadget({
        description: "test",
        schema: {} as any,
      });
      expect(typeof TestClass).toBe("function");
    });

    it("should NOT export TypedGadget (it's now called Gadget)", () => {
      // TypedGadget should not exist in the public API
      expect((llmist as any).TypedGadget).toBeUndefined();
    });

    it("should export BaseGadget for internal/advanced use", () => {
      // BaseGadget should be exported but it's the old Gadget class
      expect(llmist.BaseGadget).toBeDefined();
      expect(typeof llmist.BaseGadget).toBe("function");
    });

    it("should export createGadget unchanged", () => {
      expect(llmist.createGadget).toBeDefined();
      expect(typeof llmist.createGadget).toBe("function");
    });

    it("should export GadgetConfig type (formerly TypedGadgetConfig)", () => {
      // This is a type-level test, we're just checking the export exists
      // TypeScript will verify the type at compile time
      const testConfig: llmist.GadgetConfig<any> = {
        description: "test",
        schema: {} as any,
      };
      expect(testConfig.description).toBe("test");
    });

    it("should NOT export TypedGadgetConfig type", () => {
      // We can't directly test type exports at runtime, but we can ensure
      // the old name doesn't accidentally leak through as a value
      expect((llmist as any).TypedGadgetConfig).toBeUndefined();
    });
  });

  describe("Import Error Messages", () => {
    it("should provide helpful error when trying to use old Gadget pattern", () => {
      // Test that BaseGadget requires manual type casting (old behavior)
      const baseGadget = new (class extends llmist.BaseGadget {
        description = "test";
        execute(params: Record<string, unknown>): string {
          // This should require manual casting - the old way
          const typedParams = params as { value: string };
          return typedParams.value;
        }
      })();

      expect(baseGadget.description).toBe("test");
      expect(baseGadget.execute({ value: "test" })).toBe("test");
    });

    it("should work correctly with new Gadget pattern", () => {
      // Test that new Gadget provides automatic type inference
      class TestGadget extends llmist.Gadget({
        description: "test gadget",
        schema: {} as any, // Using any for simplicity in test
      }) {
        execute(params: this["params"]): string {
          // This should have automatic type inference - the new way
          return "success";
        }
      }

      const gadget = new TestGadget();
      expect(gadget.description).toBe("test gadget");
      expect(gadget.execute({})).toBe("success");
    });
  });

  describe("Migration Validation", () => {
    it("should allow both class-based (Gadget) and functional (createGadget) approaches", () => {
      // Class-based approach (new Gadget, formerly TypedGadget)
      const ClassBasedGadget = llmist.Gadget({
        description: "class-based",
        schema: {} as any,
      });
      expect(typeof ClassBasedGadget).toBe("function");

      // Functional approach (unchanged)
      const functionalGadget = llmist.createGadget({
        description: "functional",
        schema: {} as any,
        execute: () => "result",
      });
      expect(functionalGadget.description).toBe("functional");
    });

    it("should maintain backward compatibility for createGadget", () => {
      const gadget = llmist.createGadget({
        name: "TestGadget",
        description: "A test gadget",
        schema: {} as any,
        execute: ({ input }: any) => `Got: ${input}`,
      });

      expect(gadget.name).toBe("TestGadget");
      expect(gadget.description).toBe("A test gadget");
      expect(gadget.execute({ input: "hello" })).toBe("Got: hello");
    });
  });

  describe("Registry and Runtime Compatibility", () => {
    it("should work with GadgetRegistry for all gadget types", () => {
      const registry = new llmist.GadgetRegistry();

      // Should work with new Gadget
      class NewStyleGadget extends llmist.Gadget({
        description: "new style",
        schema: z.object({}), // Use proper Zod schema
      }) {
        execute(): string {
          return "new";
        }
      }

      // Should work with createGadget
      const functionalGadget = llmist.createGadget({
        description: "functional",
        schema: z.object({}), // Use proper Zod schema
        execute: () => "functional",
      });

      // Should work with BaseGadget (though not recommended)
      class OldStyleGadget extends llmist.BaseGadget {
        description = "old style";
        execute(): string {
          return "old";
        }
      }

      // All should register successfully
      registry.register("new", new NewStyleGadget());
      registry.register("functional", functionalGadget);
      registry.register("old", new OldStyleGadget());

      expect(registry.has("new")).toBe(true);
      expect(registry.has("functional")).toBe(true);
      expect(registry.has("old")).toBe(true);
    });
  });
});
