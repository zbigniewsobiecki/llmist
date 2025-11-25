import type { BaseGadget } from "./gadget.js";
import { validateGadgetSchema } from "./schema-validator.js";

// Type for gadget constructor
export type GadgetClass = new (...args: unknown[]) => BaseGadget;

// Type for gadget or gadget class
export type GadgetOrClass = BaseGadget | GadgetClass;

export class GadgetRegistry {
  private readonly gadgets = new Map<string, BaseGadget>();

  /**
   * Creates a registry from an array of gadget classes or instances,
   * or an object mapping names to gadgets.
   *
   * @param gadgets - Array of gadgets/classes or object with custom names
   * @returns New GadgetRegistry with all gadgets registered
   *
   * @example
   * ```typescript
   * // From array of classes
   * const registry = GadgetRegistry.from([Calculator, Weather]);
   *
   * // From array of instances
   * const registry = GadgetRegistry.from([new Calculator(), new Weather()]);
   *
   * // From object with custom names
   * const registry = GadgetRegistry.from({
   *   calc: Calculator,
   *   weather: new Weather({ apiKey: "..." })
   * });
   * ```
   */
  static from(gadgets: GadgetOrClass[] | Record<string, GadgetOrClass>): GadgetRegistry {
    const registry = new GadgetRegistry();

    if (Array.isArray(gadgets)) {
      // Array of gadgets or classes
      registry.registerMany(gadgets);
    } else {
      // Object with custom names
      for (const [name, gadget] of Object.entries(gadgets)) {
        const instance = typeof gadget === "function" ? new gadget() : gadget;
        registry.register(name, instance);
      }
    }

    return registry;
  }

  /**
   * Registers multiple gadgets at once from an array.
   *
   * @param gadgets - Array of gadget instances or classes
   * @returns This registry for chaining
   *
   * @example
   * ```typescript
   * registry.registerMany([Calculator, Weather, Email]);
   * registry.registerMany([new Calculator(), new Weather()]);
   * ```
   */
  registerMany(gadgets: GadgetOrClass[]): this {
    for (const gadget of gadgets) {
      const instance = typeof gadget === "function" ? new gadget() : gadget;
      this.registerByClass(instance);
    }
    return this;
  }

  // Register a gadget by name
  register(name: string, gadget: BaseGadget): void {
    const normalizedName = name.toLowerCase();
    if (this.gadgets.has(normalizedName)) {
      throw new Error(`Gadget '${name}' is already registered`);
    }

    // Validate schema if present
    if (gadget.parameterSchema) {
      validateGadgetSchema(gadget.parameterSchema, name);
    }

    this.gadgets.set(normalizedName, gadget);
  }

  // Register a gadget using its name property or class name
  registerByClass(gadget: BaseGadget): void {
    const name = gadget.name ?? gadget.constructor.name;
    this.register(name, gadget);
  }

  // Get gadget by name (case-insensitive)
  get(name: string): BaseGadget | undefined {
    return this.gadgets.get(name.toLowerCase());
  }

  // Check if gadget exists (case-insensitive)
  has(name: string): boolean {
    return this.gadgets.has(name.toLowerCase());
  }

  // Get all registered gadget names
  getNames(): string[] {
    return Array.from(this.gadgets.keys());
  }

  // Get all gadgets for instruction generation
  getAll(): BaseGadget[] {
    return Array.from(this.gadgets.values());
  }

  // Unregister gadget (useful for testing, case-insensitive)
  unregister(name: string): boolean {
    return this.gadgets.delete(name.toLowerCase());
  }

  // Clear all gadgets (useful for testing)
  clear(): void {
    this.gadgets.clear();
  }
}
