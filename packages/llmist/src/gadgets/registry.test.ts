import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { ErrorGadget, MathGadget, TestGadget } from "../../../testing/src/helpers.js";
import { GadgetRegistry } from "./registry.js";
import { Gadget } from "./typed-gadget.js";

describe("GadgetRegistry", () => {
  let registry: GadgetRegistry;

  beforeEach(() => {
    registry = new GadgetRegistry();
  });

  describe("register", () => {
    it("registers a gadget by name", () => {
      const gadget = new TestGadget();
      registry.register("CustomName", gadget);

      expect(registry.has("CustomName")).toBe(true);
      expect(registry.get("CustomName")).toBe(gadget);
    });

    it("throws error when registering duplicate name", () => {
      const gadget1 = new TestGadget();
      const gadget2 = new TestGadget();

      registry.register("Duplicate", gadget1);

      expect(() => registry.register("Duplicate", gadget2)).toThrowError(
        "Gadget 'Duplicate' is already registered",
      );
    });
  });

  describe("registerByClass", () => {
    it("registers gadget using class name", () => {
      const gadget = new TestGadget();
      registry.registerByClass(gadget);

      expect(registry.has("TestGadget")).toBe(true);
      expect(registry.get("TestGadget")).toBe(gadget);
    });

    it("registers multiple gadgets with different class names", () => {
      registry.registerByClass(new TestGadget());
      registry.registerByClass(new MathGadget());
      registry.registerByClass(new ErrorGadget());

      expect(registry.has("TestGadget")).toBe(true);
      expect(registry.has("MathGadget")).toBe(true);
      expect(registry.has("ErrorGadget")).toBe(true);
    });

    it("throws error for duplicate class registration", () => {
      registry.registerByClass(new TestGadget());

      expect(() => registry.registerByClass(new TestGadget())).toThrowError(
        "Gadget 'TestGadget' is already registered",
      );
    });
  });

  describe("get and has", () => {
    it("returns undefined for non-existent gadget", () => {
      expect(registry.get("NonExistent")).toBeUndefined();
    });

    it("returns false for non-existent gadget", () => {
      expect(registry.has("NonExistent")).toBe(false);
    });

    it("retrieves registered gadget", () => {
      const gadget = new MathGadget();
      registry.register("Math", gadget);

      expect(registry.get("Math")).toBe(gadget);
      expect(registry.has("Math")).toBe(true);
    });
  });

  describe("getNames and getAll", () => {
    it("returns empty arrays when no gadgets registered", () => {
      expect(registry.getNames()).toEqual([]);
      expect(registry.getAll()).toEqual([]);
    });

    it("returns all registered gadget names", () => {
      registry.register("First", new TestGadget());
      registry.register("Second", new MathGadget());
      registry.register("Third", new ErrorGadget());

      const names = registry.getNames();

      expect(names).toHaveLength(3);
      // Names are stored in lowercase for case-insensitive lookup
      expect(names).toContain("first");
      expect(names).toContain("second");
      expect(names).toContain("third");
    });

    it("returns all registered gadgets", () => {
      const gadget1 = new TestGadget();
      const gadget2 = new MathGadget();

      registry.register("G1", gadget1);
      registry.register("G2", gadget2);

      const gadgets = registry.getAll();

      expect(gadgets).toHaveLength(2);
      expect(gadgets).toContain(gadget1);
      expect(gadgets).toContain(gadget2);
    });
  });

  describe("unregister", () => {
    it("removes a registered gadget (case-insensitive)", () => {
      registry.register("ToRemove", new TestGadget());

      expect(registry.has("ToRemove")).toBe(true);
      expect(registry.has("toremove")).toBe(true); // Case-insensitive

      const removed = registry.unregister("TOREMOVE"); // Different case

      expect(removed).toBe(true);
      expect(registry.has("ToRemove")).toBe(false);
      expect(registry.get("ToRemove")).toBeUndefined();
    });

    it("returns false when unregistering non-existent gadget", () => {
      const removed = registry.unregister("NonExistent");
      expect(removed).toBe(false);
    });

    it("updates getNames and getAll after unregister", () => {
      registry.register("Keep", new TestGadget());
      registry.register("Remove", new MathGadget());

      registry.unregister("Remove");

      expect(registry.getNames()).toEqual(["keep"]); // Lowercase
      expect(registry.getAll()).toHaveLength(1);
    });
  });

  describe("clear", () => {
    it("removes all gadgets", () => {
      registry.register("G1", new TestGadget());
      registry.register("G2", new MathGadget());
      registry.register("G3", new ErrorGadget());

      expect(registry.getNames()).toHaveLength(3);

      registry.clear();

      expect(registry.getNames()).toEqual([]);
      expect(registry.getAll()).toEqual([]);
      expect(registry.has("G1")).toBe(false);
      expect(registry.has("G2")).toBe(false);
      expect(registry.has("G3")).toBe(false);
    });

    it("allows re-registration after clear", () => {
      registry.register("Test", new TestGadget());
      registry.clear();
      registry.register("Test", new TestGadget()); // Should not throw

      expect(registry.has("Test")).toBe(true);
    });
  });

  describe("instruction access", () => {
    it("preserves gadget instructions", () => {
      const gadget = new MathGadget();
      registry.registerByClass(gadget);

      const retrieved = registry.get("MathGadget");
      expect(retrieved?.instruction).toBe(gadget.instruction);
    });

    it("allows instruction access from getAll", () => {
      registry.registerByClass(new TestGadget());
      registry.registerByClass(new MathGadget());

      const gadgets = registry.getAll();

      expect(gadgets[0]?.instruction).toBeTruthy();
      expect(gadgets[1]?.instruction).toBeTruthy();
    });
  });

  describe("schema validation", () => {
    it("throws error when registering gadget with z.unknown()", () => {
      class BadSchemaGadget extends Gadget({
        name: "BadSchemaGadget",
        description: "Has invalid schema",
        schema: z.object({
          id: z.string(),
          data: z.unknown(),
        }),
      }) {
        execute(): string {
          return "done";
        }
      }

      const gadget = new BadSchemaGadget();

      expect(() => registry.register("BadGadget", gadget)).toThrow(/uses z\.unknown\(\)/);
      expect(() => registry.register("BadGadget", gadget)).toThrow(/BadGadget/);
      expect(() => registry.register("BadGadget", gadget)).toThrow(/data/);
    });

    it("throws error when using registerByClass with z.unknown()", () => {
      class UnknownSchemaGadget extends Gadget({
        name: "UnknownSchemaGadget",
        description: "Test",
        schema: z.object({
          content: z.unknown(),
        }),
      }) {
        execute(): string {
          return "done";
        }
      }

      expect(() => registry.registerByClass(new UnknownSchemaGadget())).toThrow(
        /uses z\.unknown\(\)/,
      );
    });

    it("allows gadgets with valid schemas", () => {
      class ValidGadget extends Gadget({
        name: "ValidGadget",
        description: "Has valid schema",
        schema: z.object({
          id: z.string(),
          data: z.object({}).passthrough(), // Use passthrough instead of z.record()
        }),
      }) {
        execute(): string {
          return "done";
        }
      }

      expect(() => registry.registerByClass(new ValidGadget())).not.toThrow();
      expect(registry.has("ValidGadget")).toBe(true);
    });

    it("allows gadgets without parameter schemas", () => {
      class NoSchemaGadget extends Gadget({
        name: "NoSchemaGadget",
        description: "No schema",
        schema: z.object({}),
      }) {
        execute(): string {
          return "done";
        }
      }

      expect(() => registry.registerByClass(new NoSchemaGadget())).not.toThrow();
      expect(registry.has("NoSchemaGadget")).toBe(true);
    });
  });

  describe("registerMany (syntactic sugar)", () => {
    it("registers multiple gadgets from array of instances", () => {
      const gadgets = [new TestGadget(), new MathGadget(), new ErrorGadget()];

      registry.registerMany(gadgets);

      expect(registry.has("TestGadget")).toBe(true);
      expect(registry.has("MathGadget")).toBe(true);
      expect(registry.has("ErrorGadget")).toBe(true);
      expect(registry.getAll()).toHaveLength(3);
    });

    it("registers multiple gadgets from array of classes", () => {
      registry.registerMany([TestGadget, MathGadget, ErrorGadget]);

      expect(registry.has("TestGadget")).toBe(true);
      expect(registry.has("MathGadget")).toBe(true);
      expect(registry.has("ErrorGadget")).toBe(true);
    });

    it("returns this for chaining", () => {
      const result = registry.registerMany([TestGadget, MathGadget]);

      expect(result).toBe(registry);
      expect(registry.getAll()).toHaveLength(2);
    });

    it("handles mixed instances and classes", () => {
      registry.registerMany([new TestGadget(), MathGadget, new ErrorGadget()]);

      expect(registry.getAll()).toHaveLength(3);
    });

    it("handles empty array", () => {
      registry.registerMany([]);

      expect(registry.getAll()).toHaveLength(0);
    });
  });

  describe("from (syntactic sugar)", () => {
    it("creates registry from array of gadget instances", () => {
      const newRegistry = GadgetRegistry.from([new TestGadget(), new MathGadget()]);

      expect(newRegistry.has("TestGadget")).toBe(true);
      expect(newRegistry.has("MathGadget")).toBe(true);
      expect(newRegistry.getAll()).toHaveLength(2);
    });

    it("creates registry from array of gadget classes", () => {
      const newRegistry = GadgetRegistry.from([TestGadget, MathGadget, ErrorGadget]);

      expect(newRegistry.has("TestGadget")).toBe(true);
      expect(newRegistry.has("MathGadget")).toBe(true);
      expect(newRegistry.has("ErrorGadget")).toBe(true);
    });

    it("creates registry from object with custom names (instances)", () => {
      const newRegistry = GadgetRegistry.from({
        math: new MathGadget(),
        test: new TestGadget(),
      });

      expect(newRegistry.has("math")).toBe(true);
      expect(newRegistry.has("test")).toBe(true);
      expect(newRegistry.has("MathGadget")).toBe(false); // Not using class name
    });

    it("creates registry from object with custom names (classes)", () => {
      const newRegistry = GadgetRegistry.from({
        calculator: MathGadget,
        tester: TestGadget,
      });

      expect(newRegistry.has("calculator")).toBe(true);
      expect(newRegistry.has("tester")).toBe(true);
    });

    it("creates registry from mixed array of classes and instances", () => {
      const newRegistry = GadgetRegistry.from([TestGadget, new MathGadget(), ErrorGadget]);

      expect(newRegistry.getAll()).toHaveLength(3);
    });

    it("creates registry from empty array", () => {
      const newRegistry = GadgetRegistry.from([]);

      expect(newRegistry.getAll()).toHaveLength(0);
    });

    it("creates registry from empty object", () => {
      const newRegistry = GadgetRegistry.from({});

      expect(newRegistry.getAll()).toHaveLength(0);
    });

    it("creates new independent registry instance", () => {
      const registry1 = GadgetRegistry.from([TestGadget]);
      const registry2 = GadgetRegistry.from([MathGadget]);

      expect(registry1.has("TestGadget")).toBe(true);
      expect(registry1.has("MathGadget")).toBe(false);

      expect(registry2.has("MathGadget")).toBe(true);
      expect(registry2.has("TestGadget")).toBe(false);
    });
  });
});
