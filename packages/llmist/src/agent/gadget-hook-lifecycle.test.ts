import type { ILogObj, Logger } from "tslog";
import { describe, expect, it, vi } from "vitest";
import type { GadgetExecutor } from "../gadgets/executor.js";
import type { GadgetExecutionResult, ParsedGadgetCall, StreamEvent } from "../gadgets/types.js";
import { GadgetDependencyResolver } from "./gadget-dependency-resolver.js";
import { GadgetHookLifecycle } from "./gadget-hook-lifecycle.js";
import type { AgentHooks } from "./hooks.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockLogger(): Logger<ILogObj> {
  return {
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    silly: vi.fn(),
  } as unknown as Logger<ILogObj>;
}

function makeCall(
  invocationId: string,
  gadgetName = "TestGadget",
  params: Record<string, unknown> = {},
  deps: string[] = [],
): ParsedGadgetCall {
  return {
    invocationId,
    gadgetName,
    parametersRaw: "{}",
    parameters: params,
    dependencies: deps,
  };
}

function createMockExecutor(result: Partial<GadgetExecutionResult> = {}): GadgetExecutor {
  return {
    execute: vi.fn().mockResolvedValue({
      gadgetName: "TestGadget",
      invocationId: "g1",
      parameters: {},
      result: "gadget result",
      executionTimeMs: 5,
      ...result,
    }),
  } as unknown as GadgetExecutor;
}

/**
 * Collect all events from the lifecycle.execute() generator.
 */
async function collectExecuteEvents(
  lifecycle: GadgetHookLifecycle,
  call: ParsedGadgetCall,
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const evt of lifecycle.execute(call)) {
    events.push(evt);
  }
  return events;
}

function createLifecycle(
  opts: { hooks?: AgentHooks; executor?: GadgetExecutor; resolver?: GadgetDependencyResolver } = {},
): {
  lifecycle: GadgetHookLifecycle;
  resolver: GadgetDependencyResolver;
  executor: GadgetExecutor;
} {
  const resolver = opts.resolver ?? new GadgetDependencyResolver();
  const executor = opts.executor ?? createMockExecutor();
  const lifecycle = new GadgetHookLifecycle({
    iteration: 1,
    hooks: opts.hooks ?? {},
    logger: createMockLogger(),
    executor,
    dependencyResolver: resolver,
  });
  return { lifecycle, resolver, executor };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GadgetHookLifecycle", () => {
  // =========================================================================
  // Basic execution
  // =========================================================================

  describe("basic execution", () => {
    it("yields a single gadget_result event", async () => {
      const { lifecycle } = createLifecycle();

      const events = await collectExecuteEvents(lifecycle, makeCall("g1"));

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("gadget_result");
    });

    it("gadget_result contains the executor result", async () => {
      const { lifecycle } = createLifecycle({
        executor: createMockExecutor({ result: "the answer", invocationId: "g1" }),
      });

      const events = await collectExecuteEvents(lifecycle, makeCall("g1"));

      expect(events[0]).toMatchObject({
        type: "gadget_result",
        result: expect.objectContaining({ result: "the answer" }),
      });
    });

    it("calls executor.execute with the original call", async () => {
      const executor = createMockExecutor();
      const { lifecycle } = createLifecycle({ executor });
      const call = makeCall("g1", "MyGadget", { foo: "bar" });

      await collectExecuteEvents(lifecycle, call);

      expect(executor.execute).toHaveBeenCalledWith(call);
    });
  });

  // =========================================================================
  // Dependency resolver integration
  // =========================================================================

  describe("dependency resolver integration", () => {
    it("marks the gadget as complete in the dependency resolver after execution", async () => {
      const resolver = new GadgetDependencyResolver();
      const { lifecycle } = createLifecycle({ resolver });
      const call = makeCall("g1");

      await collectExecuteEvents(lifecycle, call);

      expect(resolver.isCompleted("g1")).toBe(true);
    });

    it("marks the gadget as failed in resolver when executor returns an error", async () => {
      const resolver = new GadgetDependencyResolver();
      const executor = createMockExecutor({ result: undefined, error: "Something broke" });
      const { lifecycle } = createLifecycle({ resolver, executor });

      await collectExecuteEvents(lifecycle, makeCall("g1"));

      // isFailed checks for gadgets whose result had an error
      expect(resolver.isFailed("g1")).toBe(true);
    });

    it("does not mark as failed when execution succeeds", async () => {
      const resolver = new GadgetDependencyResolver();
      const { lifecycle } = createLifecycle({ resolver });

      await collectExecuteEvents(lifecycle, makeCall("g1"));

      expect(resolver.isFailed("g1")).toBe(false);
    });
  });

  // =========================================================================
  // Parameter interceptor
  // =========================================================================

  describe("interceptGadgetParameters", () => {
    it("transforms parameters before execution", async () => {
      const executor = createMockExecutor();
      const hooks: AgentHooks = {
        interceptors: {
          interceptGadgetParameters: (_params, _ctx) => ({ transformed: true }),
        },
      };
      const { lifecycle } = createLifecycle({ hooks, executor });
      const call = makeCall("g1", "TestGadget", { original: true });

      await collectExecuteEvents(lifecycle, call);

      // Verify executor received the modified parameters (call.parameters was mutated)
      expect(call.parameters).toEqual({ transformed: true });
    });

    it("passes the original parameters to the interceptor context", async () => {
      const paramInterceptor = vi.fn().mockReturnValue({});
      const hooks: AgentHooks = {
        interceptors: { interceptGadgetParameters: paramInterceptor },
      };
      const { lifecycle } = createLifecycle({ hooks });
      const call = makeCall("g1", "TestGadget", { a: 1 });

      await collectExecuteEvents(lifecycle, call);

      expect(paramInterceptor).toHaveBeenCalledWith(
        { a: 1 },
        expect.objectContaining({ gadgetName: "TestGadget", invocationId: "g1" }),
      );
    });
  });

  // =========================================================================
  // beforeGadgetExecution controller — skip action
  // =========================================================================

  describe("beforeGadgetExecution — skip action", () => {
    it("skips executor when controller returns skip action with syntheticResult", async () => {
      const executor = createMockExecutor();
      const hooks: AgentHooks = {
        controllers: {
          beforeGadgetExecution: vi
            .fn()
            .mockResolvedValue({ action: "skip", syntheticResult: "skipped" }),
        },
      };
      const { lifecycle } = createLifecycle({ hooks, executor });

      await collectExecuteEvents(lifecycle, makeCall("g1"));

      expect(executor.execute).not.toHaveBeenCalled();
    });

    it("returns syntheticResult from skip action", async () => {
      const hooks: AgentHooks = {
        controllers: {
          beforeGadgetExecution: vi
            .fn()
            .mockResolvedValue({ action: "skip", syntheticResult: "custom skip output" }),
        },
      };
      const { lifecycle } = createLifecycle({ hooks });

      const events = await collectExecuteEvents(lifecycle, makeCall("g1"));

      expect(events[0]).toMatchObject({
        type: "gadget_result",
        result: expect.objectContaining({ result: "custom skip output" }),
      });
    });

    it("does not skip when controller returns proceed action", async () => {
      const executor = createMockExecutor();
      const hooks: AgentHooks = {
        controllers: {
          beforeGadgetExecution: vi.fn().mockResolvedValue({ action: "proceed" }),
        },
      };
      const { lifecycle } = createLifecycle({ hooks, executor });

      await collectExecuteEvents(lifecycle, makeCall("g1"));

      expect(executor.execute).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // afterGadgetExecution controller — recover action
  // =========================================================================

  describe("afterGadgetExecution — recover action", () => {
    it("replaces error result with fallbackResult when recover action", async () => {
      const executor = createMockExecutor({ result: undefined, error: "bad error" });
      const hooks: AgentHooks = {
        controllers: {
          afterGadgetExecution: vi.fn().mockResolvedValue({
            action: "recover",
            fallbackResult: "recovered successfully",
          }),
        },
      };
      const { lifecycle } = createLifecycle({ hooks, executor });

      const events = await collectExecuteEvents(lifecycle, makeCall("g1"));

      expect(events[0]).toMatchObject({
        type: "gadget_result",
        result: expect.objectContaining({
          result: "recovered successfully",
          error: undefined,
        }),
      });
    });

    it("does not apply recover action when there is no error", async () => {
      const executor = createMockExecutor({ result: "success" });
      const hooks: AgentHooks = {
        controllers: {
          afterGadgetExecution: vi.fn().mockResolvedValue({
            action: "recover",
            fallbackResult: "fallback",
          }),
        },
      };
      const { lifecycle } = createLifecycle({ hooks, executor });

      const events = await collectExecuteEvents(lifecycle, makeCall("g1"));

      // recover only triggers on errors; since there's no error, result is unchanged
      expect(events[0]).toMatchObject({
        type: "gadget_result",
        result: expect.objectContaining({ result: "success" }),
      });
    });
  });

  // =========================================================================
  // Result interceptor
  // =========================================================================

  describe("interceptGadgetResult", () => {
    it("transforms the result text", async () => {
      const executor = createMockExecutor({ result: "raw result" });
      const hooks: AgentHooks = {
        interceptors: {
          interceptGadgetResult: (text, _ctx) => `[transformed] ${text}`,
        },
      };
      const { lifecycle } = createLifecycle({ hooks, executor });

      const events = await collectExecuteEvents(lifecycle, makeCall("g1"));

      expect(events[0]).toMatchObject({
        result: expect.objectContaining({ result: "[transformed] raw result" }),
      });
    });

    it("transforms the error text", async () => {
      const executor = createMockExecutor({ result: undefined, error: "raw error" });
      const hooks: AgentHooks = {
        interceptors: {
          interceptGadgetResult: (text, _ctx) => `[error-transformed] ${text}`,
        },
      };
      const { lifecycle } = createLifecycle({ hooks, executor });

      const events = await collectExecuteEvents(lifecycle, makeCall("g1"));

      expect(events[0]).toMatchObject({
        result: expect.objectContaining({ error: "[error-transformed] raw error" }),
      });
    });

    it("does not call interceptor when result and error are both undefined", async () => {
      const executor = createMockExecutor({ result: undefined, error: undefined });
      const interceptGadgetResult = vi.fn().mockReturnValue("transformed");
      const hooks: AgentHooks = {
        interceptors: { interceptGadgetResult },
      };
      const { lifecycle } = createLifecycle({ hooks, executor });

      await collectExecuteEvents(lifecycle, makeCall("g1"));

      expect(interceptGadgetResult).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Observer notifications
  // =========================================================================

  describe("observer notifications", () => {
    it("calls onGadgetExecutionStart before execution", async () => {
      const onGadgetExecutionStart = vi.fn().mockResolvedValue(undefined);
      const executor = createMockExecutor();
      const hooks: AgentHooks = {
        observers: { onGadgetExecutionStart },
      };
      const { lifecycle } = createLifecycle({ hooks, executor });

      await collectExecuteEvents(lifecycle, makeCall("g1", "MyGadget"));

      expect(onGadgetExecutionStart).toHaveBeenCalledOnce();
      expect(onGadgetExecutionStart).toHaveBeenCalledWith(
        expect.objectContaining({ gadgetName: "MyGadget", invocationId: "g1" }),
      );
    });

    it("calls onGadgetExecutionComplete after execution", async () => {
      const onGadgetExecutionComplete = vi.fn().mockResolvedValue(undefined);
      const hooks: AgentHooks = {
        observers: { onGadgetExecutionComplete },
      };
      const { lifecycle } = createLifecycle({ hooks });

      await collectExecuteEvents(lifecycle, makeCall("g1"));

      expect(onGadgetExecutionComplete).toHaveBeenCalledOnce();
    });

    it("calls onGadgetExecutionComplete with error info when gadget fails", async () => {
      const onGadgetExecutionComplete = vi.fn().mockResolvedValue(undefined);
      const executor = createMockExecutor({ result: undefined, error: "gadget failed" });
      const hooks: AgentHooks = {
        observers: { onGadgetExecutionComplete },
      };
      const { lifecycle } = createLifecycle({ hooks, executor });

      await collectExecuteEvents(lifecycle, makeCall("g1"));

      expect(onGadgetExecutionComplete).toHaveBeenCalledWith(
        expect.objectContaining({ error: "gadget failed" }),
      );
    });

    it("calls onGadgetExecutionStart before onGadgetExecutionComplete (ordering)", async () => {
      const callOrder: string[] = [];
      const onGadgetExecutionStart = vi.fn().mockImplementation(async () => {
        callOrder.push("start");
      });
      const onGadgetExecutionComplete = vi.fn().mockImplementation(async () => {
        callOrder.push("complete");
      });
      const hooks: AgentHooks = {
        observers: { onGadgetExecutionStart, onGadgetExecutionComplete },
      };
      const { lifecycle } = createLifecycle({ hooks });

      await collectExecuteEvents(lifecycle, makeCall("g1"));

      expect(callOrder).toEqual(["start", "complete"]);
    });
  });

  // =========================================================================
  // Parse error logging
  // =========================================================================

  describe("parse error handling", () => {
    it("logs a warning when call has a parseError", async () => {
      const logger = createMockLogger();
      const resolver = new GadgetDependencyResolver();
      const lifecycle = new GadgetHookLifecycle({
        iteration: 1,
        hooks: {},
        logger,
        executor: createMockExecutor(),
        dependencyResolver: resolver,
      });

      const call = makeCall("g1");
      call.parseError = "invalid JSON";

      await collectExecuteEvents(lifecycle, call);

      expect(logger.warn).toHaveBeenCalledWith(
        "Gadget has parse error",
        expect.objectContaining({ gadgetName: "TestGadget", error: "invalid JSON" }),
      );
    });

    it("continues execution despite parse error", async () => {
      const executor = createMockExecutor();
      const { lifecycle } = createLifecycle({ executor });
      const call = makeCall("g1");
      call.parseError = "malformed params";

      const events = await collectExecuteEvents(lifecycle, call);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("gadget_result");
      expect(executor.execute).toHaveBeenCalled();
    });
  });
});
