import { describe, expect, it } from "vitest";
import { z } from "zod";

import { AbortException } from "./exceptions.js";
import { Gadget } from "./typed-gadget.js";
import type { ExecutionContext } from "./types.js";

class SchemaGadget extends Gadget({
  name: "SchemaGadget",
  description: "Processes items with structured input.",
  schema: z.object({
    count: z.number().int().min(1).describe("Number of items to process"),
    tags: z.array(z.string()).default([]).describe("Optional tags to apply"),
  }),
}) {
  execute(params: this["params"]): string {
    const { count, tags } = params;
    return `Processed ${count} items with ${tags.length} tags.`;
  }
}

describe("BaseGadget", () => {
  it("includes parameters in plain text format (default)", () => {
    const gadget = new SchemaGadget();
    const instruction = gadget.instruction;

    // Should use plain text format with required/optional sections
    expect(instruction).toContain("Parameters:");
    expect(instruction).toContain("2 required");
    expect(instruction).toContain("REQUIRED Parameters:");
    expect(instruction).toContain("- count (integer): Number of items to process");
    expect(instruction).toContain("- tags (array of string): Optional tags to apply");
  });

  it("includes parameters in plain text format", () => {
    const gadget = new SchemaGadget();
    const instruction = gadget.getInstruction();

    expect(instruction).toContain("Processes items with structured input.");
    expect(instruction).toContain("Parameters:");
    expect(instruction).toContain("2 required");
    expect(instruction).toContain("REQUIRED Parameters:");
    expect(instruction).toContain("- count (integer): Number of items to process");
    expect(instruction).toContain("- tags (array of string): Optional tags to apply");
  });

  it("includes all nested properties in plain text schema for complex objects", () => {
    class ComplexGadget extends Gadget({
      name: "ComplexGadget",
      description: "Tests complex nested schemas",
      schema: z.object({
        user: z
          .object({
            name: z.string().describe("User name"),
            email: z.string().email().describe("User email"),
            age: z.number().optional().describe("User age"),
          })
          .describe("User information"),
        items: z
          .array(
            z.object({
              id: z.string(),
              quantity: z.number(),
            }),
          )
          .describe("List of items"),
        metadata: z.object({}).passthrough().describe("Additional metadata"),
      }),
    }) {
      execute(): string {
        return "done";
      }
    }

    const gadget = new ComplexGadget();
    const instruction = gadget.getInstruction();

    expect(instruction).toContain("Parameters:");
    expect(instruction).toContain("3 required");
    expect(instruction).toContain("REQUIRED Parameters:");

    // Verify top-level properties without [required] marker (section indicates it)
    expect(instruction).toContain("- user (object): User information");
    expect(instruction).toContain("- items (array of object): List of items");
    expect(instruction).toContain("- metadata (object): Additional metadata");

    // Verify nested user properties (indented, still have [required] marker for nested fields)
    expect(instruction).toContain("  - name (string) [required]: User name");
    expect(instruction).toContain("  - email (string) [required]: User email");
    expect(instruction).toContain("  - age (number): User age");
  });

  it("throws error when using z.unknown() in parameter schema", () => {
    class BadGadget extends Gadget({
      name: "BadGadget",
      description: "Uses z.unknown() which is not allowed",
      schema: z.object({
        id: z.string(),
        content: z.unknown(),
      }),
    }) {
      execute(): string {
        return "done";
      }
    }

    const gadget = new BadGadget();

    expect(() => gadget.getInstruction()).toThrow(/uses z\.unknown\(\)/);
    expect(() => gadget.getInstruction()).toThrow(/BadGadget/);
    expect(() => gadget.getInstruction()).toThrow(/content/);
  });

  it("provides helpful error message with suggestions when z.unknown() is used", () => {
    class UnknownGadget extends Gadget({
      name: "UnknownGadget",
      description: "Test gadget",
      schema: z.object({
        data: z.unknown(),
      }),
    }) {
      execute(): string {
        return "done";
      }
    }

    const gadget = new UnknownGadget();

    try {
      gadget.getInstruction();
      expect.fail("Should have thrown an error");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("z.record(z.string())");
      expect(message).toContain("z.object({}).passthrough()");
      expect(message).toContain("Example fixes:");
    }
  });
});

describe("BaseGadget examples", () => {
  it("renders single example with comment and output in block format", () => {
    class ExampleGadget extends Gadget({
      description: "Test gadget with example",
      schema: z.object({
        value: z.number(),
      }),
      examples: [{ params: { value: 42 }, output: "Result: 42", comment: "Basic usage" }],
    }) {
      execute(): string {
        return "done";
      }
    }

    const gadget = new ExampleGadget();
    const instruction = gadget.getInstruction();

    expect(instruction).toContain("Examples:");
    expect(instruction).toContain("# Basic usage");
    expect(instruction).toContain("!!!GADGET_START:ExampleGadget");
    expect(instruction).toContain("!!!ARG:value");
    expect(instruction).toContain("42");
    expect(instruction).toContain("!!!GADGET_END");
    expect(instruction).toContain("Expected Output:");
    expect(instruction).toContain("Result: 42");
  });

  it("renders multiple examples with blank line separation", () => {
    class MultiExampleGadget extends Gadget({
      description: "Test gadget",
      schema: z.object({ op: z.string() }),
      examples: [
        { params: { op: "first" }, comment: "First example" },
        { params: { op: "second" }, comment: "Second example" },
      ],
    }) {
      execute(): string {
        return "done";
      }
    }

    const gadget = new MultiExampleGadget();
    const instruction = gadget.getInstruction();

    expect(instruction).toContain("# First example");
    expect(instruction).toContain("!!!GADGET_START:MultiExampleGadget");
    expect(instruction).toContain("!!!GADGET_END");
    expect(instruction).toContain("# Second example");
    // Verify horizontal rule between examples
    expect(instruction).toContain("---");
    expect(instruction).toMatch(/first[\s\S]*?---[\s\S]*?# Second/);
  });

  it("omits Examples section when no examples provided", () => {
    class NoExamplesGadget extends Gadget({
      description: "Test",
      schema: z.object({ x: z.number() }),
    }) {
      execute(): string {
        return "done";
      }
    }

    const gadget = new NoExamplesGadget();
    const instruction = gadget.getInstruction();

    expect(instruction).not.toContain("Examples:");
  });

  it("omits Examples section when examples array is empty", () => {
    class EmptyExamplesGadget extends Gadget({
      description: "Test",
      schema: z.object({ x: z.number() }),
      examples: [],
    }) {
      execute(): string {
        return "done";
      }
    }

    const gadget = new EmptyExamplesGadget();
    const instruction = gadget.getInstruction();

    expect(instruction).not.toContain("Examples:");
  });

  it("renders example without output", () => {
    class NoOutputGadget extends Gadget({
      description: "Test",
      schema: z.object({ x: z.number() }),
      examples: [{ params: { x: 1 }, comment: "Just input" }],
    }) {
      execute(): string {
        return "done";
      }
    }

    const gadget = new NoOutputGadget();
    const instruction = gadget.getInstruction();

    expect(instruction).toContain("Examples:");
    expect(instruction).toContain("# Just input");
    expect(instruction).toContain("!!!GADGET_START:NoOutputGadget");
    expect(instruction).toContain("!!!GADGET_END");
    expect(instruction).not.toContain("Expected Output:");
  });

  it("renders example without comment", () => {
    class NoCommentGadget extends Gadget({
      description: "Test",
      schema: z.object({ x: z.number() }),
      examples: [{ params: { x: 5 }, output: "five" }],
    }) {
      execute(): string {
        return "done";
      }
    }

    const gadget = new NoCommentGadget();
    const instruction = gadget.getInstruction();

    expect(instruction).toContain("Examples:");
    expect(instruction).toContain("!!!GADGET_START:NoCommentGadget");
    expect(instruction).toContain("!!!ARG:x");
    expect(instruction).toContain("5");
    expect(instruction).toContain("!!!GADGET_END");
    expect(instruction).toContain("Expected Output:");
    expect(instruction).toContain("five");
    // Should not have a # line since no comment
    expect(instruction).not.toMatch(/Examples:\n#/);
  });

  it("renders block format examples with nested objects using JSON Pointer paths", () => {
    class NestedGadget extends Gadget({
      description: "Test nested objects",
      schema: z.object({
        config: z.object({
          name: z.string(),
          enabled: z.boolean(),
        }),
      }),
      examples: [
        {
          params: {
            config: { name: "test", enabled: true },
          },
        },
      ],
    }) {
      execute(): string {
        return "done";
      }
    }

    const gadget = new NestedGadget();
    const instruction = gadget.getInstruction();

    // Verify block format with nested paths
    expect(instruction).toContain("Examples:");
    expect(instruction).toContain("!!!ARG:config/name");
    expect(instruction).toContain("test");
    expect(instruction).toContain("!!!ARG:config/enabled");
    expect(instruction).toContain("true");
  });

  it("renders block format examples with arrays using numeric indices", () => {
    class ArrayGadget extends Gadget({
      description: "Test arrays",
      schema: z.object({
        items: z.array(z.string()),
      }),
      examples: [
        {
          params: {
            items: ["first", "second"],
          },
          comment: "Array items",
        },
      ],
    }) {
      execute(): string {
        return "done";
      }
    }

    const gadget = new ArrayGadget();
    const instruction = gadget.getInstruction();

    // Verify block format with array indices
    expect(instruction).toContain("Examples:");
    expect(instruction).toContain("!!!ARG:items/0");
    expect(instruction).toContain("first");
    expect(instruction).toContain("!!!ARG:items/1");
    expect(instruction).toContain("second");
  });
});

describe("BaseGadget examples with custom argPrefix", () => {
  it("uses custom argPrefix when provided to getInstruction", () => {
    class CustomPrefixGadget extends Gadget({
      description: "Test gadget with example",
      schema: z.object({
        value: z.number(),
      }),
      examples: [{ params: { value: 42 }, output: "Result: 42", comment: "Basic usage" }],
    }) {
      execute(): string {
        return "done";
      }
    }

    const gadget = new CustomPrefixGadget();
    const instruction = gadget.getInstruction("@param:");

    // Verify custom arg prefix
    expect(instruction).toContain("@param:value");
    expect(instruction).not.toContain("!!!ARG:");

    // When only argPrefix is customized, START/END use defaults
    expect(instruction).toContain("!!!GADGET_START:");
    expect(instruction).toContain("!!!GADGET_END");
  });

  it("uses all custom prefixes when provided as options", () => {
    class FullyCustomGadget extends Gadget({
      description: "Test gadget with all custom prefixes",
      schema: z.object({
        value: z.number(),
      }),
      examples: [{ params: { value: 42 }, output: "Result: 42", comment: "Full custom" }],
    }) {
      execute(): string {
        return "done";
      }
    }

    const gadget = new FullyCustomGadget();
    const instruction = gadget.getInstruction({
      argPrefix: "@param:",
      startPrefix: "@BEGIN:",
      endPrefix: "@END",
    });

    // Verify all custom prefixes
    expect(instruction).toContain("@param:value");
    expect(instruction).toContain("@BEGIN:FullyCustomGadget");
    expect(instruction).toContain("@END");

    // Verify defaults are not used
    expect(instruction).not.toContain("!!!ARG:");
    expect(instruction).not.toContain("!!!GADGET_START");
    expect(instruction).not.toContain("!!!GADGET_END");
  });

  it("uses custom argPrefix for nested objects", () => {
    class NestedGadget extends Gadget({
      description: "Test nested objects",
      schema: z.object({
        config: z.object({
          name: z.string(),
          enabled: z.boolean(),
        }),
      }),
      examples: [
        {
          params: {
            config: { name: "test", enabled: true },
          },
        },
      ],
    }) {
      execute(): string {
        return "done";
      }
    }

    const gadget = new NestedGadget();
    const instruction = gadget.getInstruction("<<<GADGET_ARG>>>:");

    expect(instruction).toContain("<<<GADGET_ARG>>>:config/name");
    expect(instruction).toContain("<<<GADGET_ARG>>>:config/enabled");
    expect(instruction).not.toContain("!!!ARG:");
  });

  it("uses custom argPrefix for arrays", () => {
    class ArrayGadget extends Gadget({
      description: "Test arrays",
      schema: z.object({
        items: z.array(z.string()),
      }),
      examples: [
        {
          params: {
            items: ["first", "second"],
          },
        },
      ],
    }) {
      execute(): string {
        return "done";
      }
    }

    const gadget = new ArrayGadget();
    const instruction = gadget.getInstruction("$ARG$");

    expect(instruction).toContain("$ARG$items/0");
    expect(instruction).toContain("$ARG$items/1");
    expect(instruction).not.toContain("!!!ARG:");
  });

  it("uses default prefix when argPrefix is not provided", () => {
    class DefaultGadget extends Gadget({
      description: "Test",
      schema: z.object({ x: z.number() }),
      examples: [{ params: { x: 1 } }],
    }) {
      execute(): string {
        return "done";
      }
    }

    const gadget = new DefaultGadget();
    const instruction = gadget.getInstruction();

    expect(instruction).toContain("!!!ARG:x");
  });
});

describe("BaseGadget parameter sections", () => {
  it("shows only REQUIRED section when all parameters are required", () => {
    class AllRequiredGadget extends Gadget({
      description: "Test gadget with all required params",
      schema: z.object({
        name: z.string().describe("User name"),
        email: z.string().describe("User email"),
        age: z.number().describe("User age"),
      }),
    }) {
      execute(): string {
        return "done";
      }
    }

    const gadget = new AllRequiredGadget();
    const instruction = gadget.getInstruction();

    expect(instruction).toContain("3 required");
    expect(instruction).not.toContain("optional");
    expect(instruction).toContain("REQUIRED Parameters:");
    expect(instruction).not.toContain("OPTIONAL Parameters:");
    expect(instruction).toContain("- name (string): User name");
    expect(instruction).toContain("- email (string): User email");
    expect(instruction).toContain("- age (number): User age");
  });

  it("shows only OPTIONAL section when all parameters are optional", () => {
    class AllOptionalGadget extends Gadget({
      description: "Test gadget with all optional params",
      schema: z.object({
        name: z.string().optional().describe("User name"),
        email: z.string().optional().describe("User email"),
        age: z.number().optional().describe("User age"),
      }),
    }) {
      execute(): string {
        return "done";
      }
    }

    const gadget = new AllOptionalGadget();
    const instruction = gadget.getInstruction();

    expect(instruction).toContain("3 optional");
    expect(instruction).not.toContain("required");
    expect(instruction).toContain("OPTIONAL Parameters:");
    expect(instruction).not.toContain("REQUIRED Parameters:");
    expect(instruction).toContain("- name (string): User name");
    expect(instruction).toContain("- email (string): User email");
    expect(instruction).toContain("- age (number): User age");
  });

  it("shows both REQUIRED and OPTIONAL sections for mixed parameters", () => {
    class MixedGadget extends Gadget({
      description: "Test gadget with mixed params",
      schema: z.object({
        name: z.string().describe("User name (required)"),
        email: z.string().describe("User email (required)"),
        age: z.number().optional().describe("User age (optional)"),
      }),
    }) {
      execute(): string {
        return "done";
      }
    }

    const gadget = new MixedGadget();
    const instruction = gadget.getInstruction();

    expect(instruction).toContain("2 required, 1 optional");
    expect(instruction).toContain("REQUIRED Parameters:");
    expect(instruction).toContain("OPTIONAL Parameters:");

    // Verify params are in correct sections
    const requiredSection = instruction.split("OPTIONAL Parameters:")[0];
    const optionalSection = instruction.split("OPTIONAL Parameters:")[1];

    expect(requiredSection).toContain("- name (string): User name (required)");
    expect(requiredSection).toContain("- email (string): User email (required)");
    expect(optionalSection).toContain("- age (number): User age (optional)");
  });

  it("separates three examples with horizontal rules", () => {
    class ThreeExamplesGadget extends Gadget({
      description: "Test gadget with three examples",
      schema: z.object({ value: z.number() }),
      examples: [
        { params: { value: 1 }, output: "first", comment: "First" },
        { params: { value: 2 }, output: "second", comment: "Second" },
        { params: { value: 3 }, output: "third", comment: "Third" },
      ],
    }) {
      execute(): string {
        return "done";
      }
    }

    const gadget = new ThreeExamplesGadget();
    const instruction = gadget.getInstruction();

    // Count occurrences of horizontal rule
    const ruleCount = (instruction.match(/---/g) || []).length;
    expect(ruleCount).toBe(2); // 2 rules between 3 examples

    // Verify order and spacing
    expect(instruction).toMatch(/# First[\s\S]*?---[\s\S]*?# Second[\s\S]*?---[\s\S]*?# Third/);

    // Verify all examples have START/END markers
    const startCount = (instruction.match(/!!!GADGET_START:/g) || []).length;
    const endCount = (instruction.match(/!!!GADGET_END/g) || []).length;
    expect(startCount).toBe(3);
    expect(endCount).toBe(3);
  });
});

// Helper gadget for testing helper methods
class TestGadget extends Gadget({
  description: "Test gadget for helper method testing",
  schema: z.object({ value: z.number() }),
}) {
  execute(): string {
    return "done";
  }
}

describe("BaseGadget.throwIfAborted", () => {
  it("does not throw when ctx is undefined", () => {
    const gadget = new TestGadget();
    expect(() => gadget.throwIfAborted(undefined)).not.toThrow();
  });

  it("does not throw when signal is not aborted", () => {
    const gadget = new TestGadget();
    const abortController = new AbortController();
    const ctx: ExecutionContext = {
      reportCost: () => {},
      signal: abortController.signal,
    };

    expect(() => gadget.throwIfAborted(ctx)).not.toThrow();
  });

  it("throws AbortException when signal is aborted", () => {
    const gadget = new TestGadget();
    const abortController = new AbortController();
    abortController.abort();

    const ctx: ExecutionContext = {
      reportCost: () => {},
      signal: abortController.signal,
    };

    expect(() => gadget.throwIfAborted(ctx)).toThrow(AbortException);
  });

  it("throws AbortException with default message", () => {
    const gadget = new TestGadget();
    const abortController = new AbortController();
    abortController.abort();

    const ctx: ExecutionContext = {
      reportCost: () => {},
      signal: abortController.signal,
    };

    try {
      gadget.throwIfAborted(ctx);
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AbortException);
      expect((error as AbortException).message).toBe("Gadget execution was aborted");
    }
  });
});

describe("BaseGadget.onAbort", () => {
  it("registers cleanup that fires on abort", async () => {
    const gadget = new TestGadget();
    const abortController = new AbortController();
    const ctx: ExecutionContext = {
      reportCost: () => {},
      signal: abortController.signal,
    };

    let cleanupCalled = false;
    gadget.onAbort(ctx, () => {
      cleanupCalled = true;
    });

    expect(cleanupCalled).toBe(false);
    abortController.abort();

    // Wait for async cleanup to run
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cleanupCalled).toBe(true);
  });

  it("runs cleanup immediately if already aborted", async () => {
    const gadget = new TestGadget();
    const abortController = new AbortController();
    abortController.abort(); // Abort before registering

    const ctx: ExecutionContext = {
      reportCost: () => {},
      signal: abortController.signal,
    };

    let cleanupCalled = false;
    gadget.onAbort(ctx, () => {
      cleanupCalled = true;
    });

    // Wait for async cleanup to run
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cleanupCalled).toBe(true);
  });

  it("handles undefined ctx gracefully", () => {
    const gadget = new TestGadget();

    // Should not throw
    expect(() => gadget.onAbort(undefined, () => {})).not.toThrow();
  });

  it("swallows cleanup errors", async () => {
    const gadget = new TestGadget();
    const abortController = new AbortController();
    const ctx: ExecutionContext = {
      reportCost: () => {},
      signal: abortController.signal,
    };

    gadget.onAbort(ctx, () => {
      throw new Error("Cleanup failed!");
    });

    // Should not throw
    abortController.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("handles async cleanup functions", async () => {
    const gadget = new TestGadget();
    const abortController = new AbortController();
    const ctx: ExecutionContext = {
      reportCost: () => {},
      signal: abortController.signal,
    };

    let cleanupCalled = false;
    gadget.onAbort(ctx, async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      cleanupCalled = true;
    });

    abortController.abort();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(cleanupCalled).toBe(true);
  });

  it("allows multiple cleanup handlers", async () => {
    const gadget = new TestGadget();
    const abortController = new AbortController();
    const ctx: ExecutionContext = {
      reportCost: () => {},
      signal: abortController.signal,
    };

    const cleanupOrder: number[] = [];
    gadget.onAbort(ctx, () => cleanupOrder.push(1));
    gadget.onAbort(ctx, () => cleanupOrder.push(2));
    gadget.onAbort(ctx, () => cleanupOrder.push(3));

    abortController.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(cleanupOrder).toEqual([1, 2, 3]);
  });
});

describe("BaseGadget.createLinkedAbortController", () => {
  it("propagates abort from parent signal", () => {
    const gadget = new TestGadget();
    const parentController = new AbortController();
    const ctx: ExecutionContext = {
      reportCost: () => {},
      signal: parentController.signal,
    };

    const childController = gadget.createLinkedAbortController(ctx);

    expect(childController.signal.aborted).toBe(false);
    parentController.abort();
    expect(childController.signal.aborted).toBe(true);
  });

  it("propagates abort reason from parent", () => {
    const gadget = new TestGadget();
    const parentController = new AbortController();
    const ctx: ExecutionContext = {
      reportCost: () => {},
      signal: parentController.signal,
    };

    const childController = gadget.createLinkedAbortController(ctx);

    parentController.abort("Timeout exceeded");
    expect(childController.signal.reason).toBe("Timeout exceeded");
  });

  it("aborts immediately if parent already aborted", () => {
    const gadget = new TestGadget();
    const parentController = new AbortController();
    parentController.abort("Already cancelled");

    const ctx: ExecutionContext = {
      reportCost: () => {},
      signal: parentController.signal,
    };

    const childController = gadget.createLinkedAbortController(ctx);

    expect(childController.signal.aborted).toBe(true);
    expect(childController.signal.reason).toBe("Already cancelled");
  });

  it("returns working controller when ctx is undefined", () => {
    const gadget = new TestGadget();
    const childController = gadget.createLinkedAbortController(undefined);

    expect(childController.signal.aborted).toBe(false);

    // Should be able to abort independently
    childController.abort("manual");
    expect(childController.signal.aborted).toBe(true);
  });

  it("allows independent abort of child controller", () => {
    const gadget = new TestGadget();
    const parentController = new AbortController();
    const ctx: ExecutionContext = {
      reportCost: () => {},
      signal: parentController.signal,
    };

    const childController = gadget.createLinkedAbortController(ctx);

    // Abort child without aborting parent
    childController.abort("child abort");
    expect(childController.signal.aborted).toBe(true);
    expect(parentController.signal.aborted).toBe(false);
  });
});
