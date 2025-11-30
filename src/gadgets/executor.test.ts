import { beforeEach, describe, expect, it } from "bun:test";
import { z } from "zod";
import {
  AskUserGadget,
  AsyncGadget,
  ErrorGadget,
  MathGadget,
  TestGadget,
} from "../testing/helpers.js";
import { BreakLoopException } from "./exceptions.js";
import { GadgetExecutor } from "./executor.js";
import { GadgetRegistry } from "./registry.js";
import { Gadget } from "./typed-gadget.js";
import type { ParsedGadgetCall } from "./types.js";

describe("GadgetExecutor", () => {
  let registry: GadgetRegistry;
  let executor: GadgetExecutor;

  beforeEach(() => {
    registry = new GadgetRegistry();
    executor = new GadgetExecutor(registry);
  });

  describe("successful execution", () => {
    it("executes a sync gadget successfully", async () => {
      registry.registerByClass(new TestGadget());

      const call: ParsedGadgetCall = {
        gadgetName: "TestGadget",
        invocationId: "123",
        parametersRaw: '{"message": "Hello"}',
        parameters: { message: "Hello" },
      };

      const result = await executor.execute(call);

      expect(result).toMatchObject({
        gadgetName: "TestGadget",
        invocationId: "123",
        parameters: { message: "Hello" },
        result: "Echo: Hello",
      });
      expect(result.error).toBeUndefined();
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("executes an async gadget successfully", async () => {
      registry.registerByClass(new AsyncGadget());

      const call: ParsedGadgetCall = {
        gadgetName: "AsyncGadget",
        invocationId: "async-1",
        parametersRaw: '{"delay": 10, "result": "success"}',
        parameters: { delay: 10, result: "success" },
      };

      const result = await executor.execute(call);

      expect(result).toMatchObject({
        gadgetName: "AsyncGadget",
        invocationId: "async-1",
        parameters: { delay: 10, result: "success" },
        result: "Async result: success",
      });
      expect(result.error).toBeUndefined();
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(10);
    });

    it("executes gadget with complex parameters", async () => {
      registry.registerByClass(new MathGadget());

      const call: ParsedGadgetCall = {
        gadgetName: "MathGadget",
        invocationId: "math-1",
        parametersRaw: '{"operation": "add", "a": 15, "b": 27}',
        parameters: { operation: "add", a: 15, b: 27 },
      };

      const result = await executor.execute(call);

      expect(result).toMatchObject({
        gadgetName: "MathGadget",
        invocationId: "math-1",
        result: "42",
      });
    });
  });

  describe("error handling", () => {
    it("returns error when gadget not found", async () => {
      const call: ParsedGadgetCall = {
        gadgetName: "NonExistent",
        invocationId: "err-1",
        parametersRaw: '{"test": "value"}',
        parameters: { test: "value" },
      };

      const result = await executor.execute(call);

      expect(result).toMatchObject({
        gadgetName: "NonExistent",
        invocationId: "err-1",
        parameters: { test: "value" },
      });
      // Error now includes rich context with available gadgets list
      expect(result.error).toContain("Gadget 'NonExistent' not found");
      expect(result.error).toContain("No gadgets are currently registered");
      expect(result.result).toBeUndefined();
    });

    it("returns error when parameters have parse error", async () => {
      registry.registerByClass(new TestGadget());

      const call: ParsedGadgetCall = {
        gadgetName: "TestGadget",
        invocationId: "err-2",
        parametersRaw: "bad: [yaml",
        parseError: "end of the stream or a document separator is expected",
      };

      const result = await executor.execute(call);

      expect(result).toMatchObject({
        gadgetName: "TestGadget",
        invocationId: "err-2",
        parameters: {},
      });
      // Error now includes rich context with gadget instructions and block format reference
      expect(result.error).toContain("expected");
      expect(result.error).toContain("Gadget Usage:");
      expect(result.error).toContain("Block Format Reference:");
      expect(result.error).toContain("!!!GADGET_START:");
      expect(result.result).toBeUndefined();
    });

    it("returns error when parameters are missing", async () => {
      registry.registerByClass(new TestGadget());

      const call: ParsedGadgetCall = {
        gadgetName: "TestGadget",
        invocationId: "err-3",
        parametersRaw: "",
        parameters: undefined,
      };

      const result = await executor.execute(call);

      expect(result).toMatchObject({
        gadgetName: "TestGadget",
        invocationId: "err-3",
        parameters: {},
      });
      // Error now includes rich context with gadget instructions and block format reference
      expect(result.error).toContain("Failed to parse parameters");
      expect(result.error).toContain("Gadget Usage:");
      expect(result.error).toContain("Block Format Reference:");
      expect(result.error).toContain("!!!GADGET_START:");
      expect(result.error).toContain("!!!ARG:");
      expect(result.error).toContain("!!!GADGET_END");
      expect(result.result).toBeUndefined();
    });

    it("catches and returns gadget execution errors", async () => {
      registry.registerByClass(new ErrorGadget());

      const call: ParsedGadgetCall = {
        gadgetName: "ErrorGadget",
        invocationId: "err-4",
        parametersRaw: "",
        parameters: {},
      };

      const result = await executor.execute(call);

      expect(result).toMatchObject({
        gadgetName: "ErrorGadget",
        invocationId: "err-4",
        parameters: {},
        error: "Intentional error from ErrorGadget",
      });
      expect(result.result).toBeUndefined();
    });

    it("handles non-Error exceptions", async () => {
      class WeirdGadget {
        instruction = "Throws non-Error";
        execute() {
          throw "String error"; // eslint-disable-line
        }
      }

      registry.register("WeirdGadget", new WeirdGadget());

      const call: ParsedGadgetCall = {
        gadgetName: "WeirdGadget",
        invocationId: "err-5",
        parametersRaw: "",
        parameters: {},
      };

      const result = await executor.execute(call);

      expect(result).toMatchObject({
        gadgetName: "WeirdGadget",
        invocationId: "err-5",
        error: "String error",
      });
    });
  });

  describe("parameter validation", () => {
    class SchemaGadget extends Gadget({
      name: "SchemaGadget",
      description: "Uses a Zod schema for parameters",
      schema: z.object({
        name: z.string().min(1).describe("Name of the item"),
        count: z.number().int().nonnegative().default(0).describe("Number of items to process"),
      }),
    }) {
      execute(params: this["params"]): string {
        const { name, count } = params;
        return `${name}:${count}`;
      }
    }

    class ComplexSchemaGadget extends Gadget({
      name: "ComplexSchemaGadget",
      description: "Validates nested payloads with defaults and enums",
      schema: z.object({
        dataset: z.object({
          name: z.string().min(1).describe("Dataset identifier"),
          fields: z
            .array(
              z.object({
                key: z.string().min(1).describe("Field key"),
                weight: z.number().min(0).max(1).default(1).describe("Relative weight"),
              }),
            )
            .min(1)
            .describe("Fields that will be processed"),
        }),
        mode: z.enum(["fast", "balanced", "accurate"]).default("balanced"),
        options: z
          .object({
            dryRun: z.boolean().default(false),
            tags: z.array(z.string().min(1)).default([]),
          })
          .default({}),
      }),
    }) {
      execute(params: this["params"]): string {
        const { dataset, mode } = params;
        return `${dataset.name}:${dataset.fields.length}:${mode}`;
      }
    }

    it("validates parameters before executing the gadget", async () => {
      registry.registerByClass(new SchemaGadget());

      const call: ParsedGadgetCall = {
        gadgetName: "SchemaGadget",
        invocationId: "schema-1",
        parametersRaw: '{"name": "Widget"}',
        parameters: { name: "Widget" },
      };

      const result = await executor.execute(call);

      expect(result).toMatchObject({
        gadgetName: "SchemaGadget",
        invocationId: "schema-1",
        parameters: { name: "Widget", count: 0 },
        result: "Widget:0",
      });
    });

    it("returns an error when validation fails", async () => {
      registry.registerByClass(new SchemaGadget());

      const call: ParsedGadgetCall = {
        gadgetName: "SchemaGadget",
        invocationId: "schema-2",
        parametersRaw: '{"name": "", "count": -1}',
        parameters: { name: "", count: -1 },
      };

      const result = await executor.execute(call);

      expect(result.error).toBeTruthy();
      // Error includes validation issues
      expect(result.error).toContain("Invalid parameters");
      expect(result.error).toContain("name");
      expect(result.error).toContain("count");
      // Error now includes gadget usage instructions for self-correction
      expect(result.error).toContain("Gadget Usage:");
      expect(result.parameters).toEqual({ name: "", count: -1 });
    });

    it("applies defaults for nested schemas", async () => {
      registry.registerByClass(new ComplexSchemaGadget());

      const call: ParsedGadgetCall = {
        gadgetName: "ComplexSchemaGadget",
        invocationId: "complex-1",
        parametersRaw: '{"dataset": {"name": "widgets", "fields": [{"key": "size"}]}}',
        parameters: { dataset: { name: "widgets", fields: [{ key: "size" }] } },
      };

      const result = await executor.execute(call);

      expect(result).toMatchObject({
        gadgetName: "ComplexSchemaGadget",
        invocationId: "complex-1",
        result: "widgets:1:balanced",
      });
      expect(result.parameters).toEqual({
        dataset: { name: "widgets", fields: [{ key: "size", weight: 1 }] },
        mode: "balanced",
        options: {}, // Zod v4: nested defaults not applied when parent object is provided
      });
    });

    it("returns detailed errors for deeply nested validation failures", async () => {
      registry.registerByClass(new ComplexSchemaGadget());

      const call: ParsedGadgetCall = {
        gadgetName: "ComplexSchemaGadget",
        invocationId: "complex-2",
        parametersRaw:
          '{"dataset": {"name": "", "fields": [{"key": "", "weight": 2}]}, "mode": "turbo"}',
        parameters: {
          dataset: { name: "", fields: [{ key: "", weight: 2 }] },
          mode: "turbo",
        },
      };

      const result = await executor.execute(call);

      expect(result.error).toContain("dataset.name");
      expect(result.error).toContain("dataset.fields.0.key");
      expect(result.error).toContain("dataset.fields.0.weight");
      expect(result.error).toContain("mode");
      expect(result.parameters).toEqual({
        dataset: { name: "", fields: [{ key: "", weight: 2 }] },
        mode: "turbo",
      });
    });
  });

  describe("executeAll", () => {
    it("executes multiple gadgets in parallel", async () => {
      registry.registerByClass(new TestGadget());
      registry.registerByClass(new MathGadget());

      const calls: ParsedGadgetCall[] = [
        {
          gadgetName: "TestGadget",
          invocationId: "1",
          parametersRaw: '{"message": "First"}',
          parameters: { message: "First" },
        },
        {
          gadgetName: "MathGadget",
          invocationId: "2",
          parametersRaw: '{"operation": "multiply", "a": 6, "b": 7}',
          parameters: { operation: "multiply", a: 6, b: 7 },
        },
        {
          gadgetName: "TestGadget",
          invocationId: "3",
          parametersRaw: '{"message": "Third"}',
          parameters: { message: "Third" },
        },
      ];

      const results = await executor.executeAll(calls);

      expect(results).toHaveLength(3);
      expect(results[0]).toMatchObject({
        gadgetName: "TestGadget",
        invocationId: "1",
        result: "Echo: First",
      });
      expect(results[1]).toMatchObject({
        gadgetName: "MathGadget",
        invocationId: "2",
        result: "42",
      });
      expect(results[2]).toMatchObject({
        gadgetName: "TestGadget",
        invocationId: "3",
        result: "Echo: Third",
      });
    });

    it("handles mix of successful and failed executions", async () => {
      registry.registerByClass(new TestGadget());
      registry.registerByClass(new ErrorGadget());

      const calls: ParsedGadgetCall[] = [
        {
          gadgetName: "TestGadget",
          invocationId: "1",
          parametersRaw: '{"message": "Success"}',
          parameters: { message: "Success" },
        },
        {
          gadgetName: "ErrorGadget",
          invocationId: "2",
          parametersRaw: "{}",
          parameters: {},
        },
        {
          gadgetName: "NonExistent",
          invocationId: "3",
          parametersRaw: "{}",
          parameters: {},
        },
      ];

      const results = await executor.executeAll(calls);

      expect(results).toHaveLength(3);
      expect(results[0]?.error).toBeUndefined();
      expect(results[1]?.error).toBe("Intentional error from ErrorGadget");
      expect(results[2]?.error).toContain("not found");
    });

    it("returns empty array for empty calls", async () => {
      const results = await executor.executeAll([]);
      expect(results).toEqual([]);
    });
  });

  describe("execution timing", () => {
    it("measures execution time accurately", async () => {
      registry.registerByClass(new AsyncGadget());

      const call: ParsedGadgetCall = {
        gadgetName: "AsyncGadget",
        invocationId: "timing-1",
        parametersRaw: '{"delay": 50, "result": "done"}',
        parameters: { delay: 50, result: "done" },
      };

      const result = await executor.execute(call);

      // Allow for small timing variance (1-2ms) due to system load and timer precision
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(48);
      expect(result.executionTimeMs).toBeLessThan(200); // Reasonable upper bound
    });

    it("measures time even for errors", async () => {
      registry.registerByClass(new ErrorGadget());

      const call: ParsedGadgetCall = {
        gadgetName: "ErrorGadget",
        invocationId: "timing-2",
        parametersRaw: "",
        parameters: {},
      };

      const result = await executor.execute(call);

      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeTruthy();
    });
  });

  describe("BreakLoopException handling", () => {
    it("sets breaksLoop flag when gadget throws BreakLoopException", async () => {
      class FinishGadget extends Gadget({
        name: "FinishGadget",
        description: "Signals task completion",
        schema: z.object({
          message: z.string().optional(),
        }),
      }) {
        execute(params: this["params"]): string {
          const message = params.message || "Task completed";
          throw new BreakLoopException(message);
        }
      }

      registry.registerByClass(new FinishGadget());

      const call: ParsedGadgetCall = {
        gadgetName: "FinishGadget",
        invocationId: "finish-1",
        parametersRaw: '{"message": "All done!"}',
        parameters: { message: "All done!" },
      };

      const result = await executor.execute(call);

      expect(result).toMatchObject({
        gadgetName: "FinishGadget",
        invocationId: "finish-1",
        parameters: { message: "All done!" },
        result: "All done!",
        breaksLoop: true,
      });
      expect(result.error).toBeUndefined();
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("uses default message when BreakLoopException has no message", async () => {
      class QuietFinishGadget extends Gadget({
        name: "QuietFinishGadget",
        description: "Finishes silently",
        schema: z.object({}),
      }) {
        execute(): string {
          throw new BreakLoopException();
        }
      }

      registry.registerByClass(new QuietFinishGadget());

      const call: ParsedGadgetCall = {
        gadgetName: "QuietFinishGadget",
        invocationId: "finish-2",
        parametersRaw: "",
        parameters: {},
      };

      const result = await executor.execute(call);

      expect(result).toMatchObject({
        gadgetName: "QuietFinishGadget",
        invocationId: "finish-2",
        result: "Agent loop terminated by gadget",
        breaksLoop: true,
      });
      expect(result.error).toBeUndefined();
    });

    it("normal errors do not set breaksLoop flag", async () => {
      registry.registerByClass(new ErrorGadget());

      const call: ParsedGadgetCall = {
        gadgetName: "ErrorGadget",
        invocationId: "error-1",
        parametersRaw: "",
        parameters: {},
      };

      const result = await executor.execute(call);

      expect(result.breaksLoop).toBeUndefined();
      expect(result.error).toBe("Intentional error from ErrorGadget");
      expect(result.result).toBeUndefined();
    });
  });

  describe("HumanInputException handling", () => {
    it("returns error when no callback provided", async () => {
      registry.registerByClass(new AskUserGadget());

      const call: ParsedGadgetCall = {
        gadgetName: "AskUser",
        invocationId: "ask-1",
        parametersRaw: '{"question": "What is your name?"}',
        parameters: { question: "What is your name?" },
      };

      const result = await executor.execute(call);

      expect(result).toMatchObject({
        gadgetName: "AskUser",
        invocationId: "ask-1",
        parameters: { question: "What is your name?" },
        error: "Human input required but not available (stdin is not interactive)",
      });
      expect(result.result).toBeUndefined();
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("calls callback and returns answer when provided", async () => {
      const mockCallback = async (question: string): Promise<string> => {
        expect(question).toBe("What is your favorite color?");
        return "Blue";
      };

      const executorWithCallback = new GadgetExecutor(registry, mockCallback);
      registry.registerByClass(new AskUserGadget());

      const call: ParsedGadgetCall = {
        gadgetName: "AskUser",
        invocationId: "ask-2",
        parametersRaw: '{"question": "What is your favorite color?"}',
        parameters: { question: "What is your favorite color?" },
      };

      const result = await executorWithCallback.execute(call);

      expect(result).toMatchObject({
        gadgetName: "AskUser",
        invocationId: "ask-2",
        parameters: { question: "What is your favorite color?" },
        result: "Blue",
      });
      expect(result.error).toBeUndefined();
    });

    it("handles callback errors gracefully", async () => {
      const mockCallback = async (): Promise<string> => {
        throw new Error("User input cancelled");
      };

      const executorWithCallback = new GadgetExecutor(registry, mockCallback);
      registry.registerByClass(new AskUserGadget());

      const call: ParsedGadgetCall = {
        gadgetName: "AskUser",
        invocationId: "ask-3",
        parametersRaw: '{"question": "Are you sure?"}',
        parameters: { question: "Are you sure?" },
      };

      const result = await executorWithCallback.execute(call);

      expect(result).toMatchObject({
        gadgetName: "AskUser",
        invocationId: "ask-3",
        error: "User input cancelled",
      });
      expect(result.result).toBeUndefined();
    });

    it("handles async callback correctly", async () => {
      const mockCallback = async (question: string): Promise<string> => {
        // Simulate async user input (e.g., waiting for UI response)
        await new Promise((resolve) => setTimeout(resolve, 50));
        return `Answer to: ${question}`;
      };

      const executorWithCallback = new GadgetExecutor(registry, mockCallback);
      registry.registerByClass(new AskUserGadget());

      const call: ParsedGadgetCall = {
        gadgetName: "AskUser",
        invocationId: "ask-4",
        parametersRaw: '{"question": "How are you?"}',
        parameters: { question: "How are you?" },
      };

      const startTime = Date.now();
      const result = await executorWithCallback.execute(call);
      const elapsed = Date.now() - startTime;

      expect(result.result).toBe("Answer to: How are you?");
      expect(elapsed).toBeGreaterThanOrEqual(50);
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(50);
    });
  });

  describe("timeout handling", () => {
    class SlowGadget extends Gadget({
      name: "SlowGadget",
      description: "A gadget that takes a long time to execute",
      schema: z.object({
        delay: z.number().describe("Delay in milliseconds"),
      }),
    }) {
      async execute(params: this["params"]): Promise<string> {
        const delay = params.delay;
        await new Promise((resolve) => setTimeout(resolve, delay));
        return `Completed after ${delay}ms`;
      }
    }

    class FastGadget extends Gadget({
      name: "FastGadget",
      description: "A gadget that executes quickly",
      schema: z.object({}),
    }) {
      execute(): string {
        return "Fast result";
      }
    }

    it("executes without timeout when no timeout is configured", async () => {
      registry.registerByClass(new SlowGadget());

      const call: ParsedGadgetCall = {
        gadgetName: "SlowGadget",
        invocationId: "slow-1",
        parametersRaw: '{"delay": 100}',
        parameters: { delay: 100 },
      };

      const result = await executor.execute(call);

      expect(result).toMatchObject({
        gadgetName: "SlowGadget",
        invocationId: "slow-1",
        result: "Completed after 100ms",
      });
      expect(result.error).toBeUndefined();
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(90);  // 10% margin for overhead
      expect(result.executionTimeMs).toBeLessThan(200);  // Ensure it didn't hang/timeout
    });

    it("times out when gadget exceeds its own timeoutMs", async () => {
      const slowGadget = new SlowGadget();
      slowGadget.timeoutMs = 50; // Set timeout to 50ms
      registry.registerByClass(slowGadget);

      const call: ParsedGadgetCall = {
        gadgetName: "SlowGadget",
        invocationId: "slow-2",
        parametersRaw: '{"delay": 200}',
        parameters: { delay: 200 },
      };

      const result = await executor.execute(call);

      expect(result).toMatchObject({
        gadgetName: "SlowGadget",
        invocationId: "slow-2",
        error: "Gadget 'SlowGadget' execution exceeded timeout of 50ms",
      });
      expect(result.result).toBeUndefined();
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(45); // Allow 5ms variance for timing precision
      expect(result.executionTimeMs).toBeLessThan(200); // Should not wait for full execution
    });

    it("times out when gadget exceeds default timeout", async () => {
      const executorWithTimeout = new GadgetExecutor(registry, undefined, undefined, 50);
      registry.registerByClass(new SlowGadget());

      const call: ParsedGadgetCall = {
        gadgetName: "SlowGadget",
        invocationId: "slow-3",
        parametersRaw: '{"delay": 200}',
        parameters: { delay: 200 },
      };

      const result = await executorWithTimeout.execute(call);

      expect(result).toMatchObject({
        gadgetName: "SlowGadget",
        invocationId: "slow-3",
        error: "Gadget 'SlowGadget' execution exceeded timeout of 50ms",
      });
      expect(result.result).toBeUndefined();
      // Use margin for CI timing variations (timeout is 50ms, but allow 40-200ms range)
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(40);
      expect(result.executionTimeMs).toBeLessThan(200);
    });

    it("gadget timeoutMs overrides default timeout", async () => {
      // Use a very short default timeout that would definitely fail
      const executorWithTimeout = new GadgetExecutor(registry, undefined, undefined, 10);
      const slowGadget = new SlowGadget();
      slowGadget.timeoutMs = 2000; // Override with much longer timeout
      registry.registerByClass(slowGadget);

      // Use 50ms delay - short enough to be fast, long enough to prove the override works
      const call: ParsedGadgetCall = {
        gadgetName: "SlowGadget",
        invocationId: "slow-4",
        parametersRaw: '{"delay": 150}',
        parameters: { delay: 150 },
      };

      const result = await executorWithTimeout.execute(call);

      // Should succeed because gadget's 2000ms timeout overrides the 10ms default
      expect(result).toMatchObject({
        gadgetName: "SlowGadget",
        invocationId: "slow-4",
        result: "Completed after 150ms",
      });
      expect(result.error).toBeUndefined();
      // Allow wide margin for CI timing variance (coverage overhead can add significant time)
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(40);
    });

    it("gadget with timeoutMs=0 disables timeout", async () => {
      const executorWithTimeout = new GadgetExecutor(registry, undefined, undefined, 50);
      const slowGadget = new SlowGadget();
      slowGadget.timeoutMs = 0; // Explicitly disable timeout
      registry.registerByClass(slowGadget);

      const call: ParsedGadgetCall = {
        gadgetName: "SlowGadget",
        invocationId: "slow-5",
        parametersRaw: '{"delay": 100}',
        parameters: { delay: 100 },
      };

      const result = await executorWithTimeout.execute(call);

      expect(result).toMatchObject({
        gadgetName: "SlowGadget",
        invocationId: "slow-5",
        result: "Completed after 100ms",
      });
      expect(result.error).toBeUndefined();
    });

    it("fast gadgets complete successfully with timeout configured", async () => {
      const executorWithTimeout = new GadgetExecutor(registry, undefined, undefined, 100);
      registry.registerByClass(new FastGadget());

      const call: ParsedGadgetCall = {
        gadgetName: "FastGadget",
        invocationId: "fast-1",
        parametersRaw: "{}",
        parameters: {},
      };

      const result = await executorWithTimeout.execute(call);

      expect(result).toMatchObject({
        gadgetName: "FastGadget",
        invocationId: "fast-1",
        result: "Fast result",
      });
      expect(result.error).toBeUndefined();
      expect(result.executionTimeMs).toBeLessThan(100);
    });

    it("measures execution time accurately for timed out gadgets", async () => {
      const slowGadget = new SlowGadget();
      slowGadget.timeoutMs = 75;
      registry.registerByClass(slowGadget);

      const call: ParsedGadgetCall = {
        gadgetName: "SlowGadget",
        invocationId: "slow-6",
        parametersRaw: '{"delay": 500}',
        parameters: { delay: 500 },
      };

      const result = await executor.execute(call);

      expect(result.error).toContain("timeout");
      // Allow small timing variance (70ms instead of 75ms) to prevent flaky test failures
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(70);
      expect(result.executionTimeMs).toBeLessThan(150); // Should be close to timeout value
    });

    it("timeout does not interfere with parameter validation", async () => {
      const executorWithTimeout = new GadgetExecutor(registry, undefined, undefined, 50);
      registry.registerByClass(new SlowGadget());

      const call: ParsedGadgetCall = {
        gadgetName: "SlowGadget",
        invocationId: "slow-7",
        parametersRaw: '{"delay": "not a number"}',
        parameters: { delay: "not a number" },
      };

      const result = await executorWithTimeout.execute(call);

      expect(result.error).toContain("Invalid parameters");
      expect(result.error).not.toContain("timeout");
    });
  });
});
