import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { createMockGadget, MockGadgetBuilder, mockGadget } from "./mock-gadget.js";

describe("createMockGadget", () => {
  it("creates a mock gadget with static result", async () => {
    const mock = createMockGadget({
      name: "Calculator",
      result: "42",
    });

    expect(mock.name).toBe("Calculator");
    expect(await mock.execute({})).toBe("42");
  });

  it("creates a mock gadget with dynamic result", async () => {
    const mock = createMockGadget({
      name: "Echo",
      resultFn: (params) => `Echo: ${params.message}`,
    });

    expect(await mock.execute({ message: "Hello" })).toBe("Echo: Hello");
  });

  it("creates a mock gadget that throws", async () => {
    const mock = createMockGadget({
      name: "Unstable",
      error: "Service unavailable",
    });

    await expect(mock.execute({})).rejects.toThrow("Service unavailable");
  });

  it("creates a mock gadget with Error instance", async () => {
    const customError = new Error("Custom error");
    const mock = createMockGadget({
      name: "Unstable",
      error: customError,
    });

    await expect(mock.execute({})).rejects.toThrow("Custom error");
  });

  it("tracks calls by default", async () => {
    const mock = createMockGadget({
      name: "Tracker",
      result: "done",
    });

    await mock.execute({ a: 1 });
    await mock.execute({ b: 2 });
    await mock.execute({ a: 1, c: 3 });

    expect(mock.getCallCount()).toBe(3);
    expect(mock.getCalls()).toHaveLength(3);
    expect(mock.getCalls()[0].params).toEqual({ a: 1 });
    expect(mock.getCalls()[1].params).toEqual({ b: 2 });
  });

  it("can disable call tracking", async () => {
    const mock = createMockGadget({
      name: "NoTrack",
      result: "done",
      trackCalls: false,
    });

    await mock.execute({ a: 1 });
    await mock.execute({ b: 2 });

    expect(mock.getCallCount()).toBe(0);
    expect(mock.getCalls()).toEqual([]);
  });

  it("checks wasCalledWith partial match", async () => {
    const mock = createMockGadget({
      name: "Checker",
      result: "done",
    });

    await mock.execute({ city: "Paris", temp: 20 });
    await mock.execute({ city: "London", temp: 15 });

    expect(mock.wasCalledWith({ city: "Paris" })).toBe(true);
    expect(mock.wasCalledWith({ city: "London", temp: 15 })).toBe(true);
    expect(mock.wasCalledWith({ city: "Berlin" })).toBe(false);
  });

  it("gets last call", async () => {
    const mock = createMockGadget({
      name: "LastCall",
      result: "done",
    });

    expect(mock.getLastCall()).toBeUndefined();

    await mock.execute({ first: true });
    await mock.execute({ second: true });

    expect(mock.getLastCall()?.params).toEqual({ second: true });
  });

  it("resets call history", async () => {
    const mock = createMockGadget({
      name: "Resettable",
      result: "done",
    });

    await mock.execute({ a: 1 });
    await mock.execute({ b: 2 });

    expect(mock.getCallCount()).toBe(2);

    mock.resetCalls();

    expect(mock.getCallCount()).toBe(0);
    expect(mock.getCalls()).toEqual([]);
  });

  it("supports delay", async () => {
    const mock = createMockGadget({
      name: "Slow",
      result: "done",
      delayMs: 50,
    });

    const start = Date.now();
    await mock.execute({});
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(50);
  });

  it("supports schema", () => {
    const mock = createMockGadget({
      name: "Typed",
      schema: z.object({
        query: z.string(),
        limit: z.number().optional(),
      }),
      result: "results",
    });

    expect(mock.parameterSchema).toBeDefined();
  });

  it("supports timeoutMs", () => {
    const mock = createMockGadget({
      name: "Timed",
      result: "done",
      timeoutMs: 5000,
    });

    expect(mock.timeoutMs).toBe(5000);
  });

  it("uses default description if not provided", () => {
    const mock = createMockGadget({
      name: "MyGadget",
      result: "done",
    });

    expect(mock.description).toBe("Mock gadget: MyGadget");
  });

  it("uses provided description", () => {
    const mock = createMockGadget({
      name: "MyGadget",
      description: "Custom description",
      result: "done",
    });

    expect(mock.description).toBe("Custom description");
  });

  it("returns default result if no result or resultFn provided", async () => {
    const mock = createMockGadget({
      name: "Default",
    });

    expect(await mock.execute({})).toBe("mock result");
  });

  it("supports async resultFn", async () => {
    const mock = createMockGadget({
      name: "AsyncResult",
      resultFn: async (params) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return `Async: ${params.value}`;
      },
    });

    expect(await mock.execute({ value: "test" })).toBe("Async: test");
  });
});

describe("mockGadget fluent builder", () => {
  it("creates mock with fluent API", async () => {
    const mock = mockGadget()
      .withName("Weather")
      .withDescription("Get weather")
      .returns("Sunny, 72F")
      .build();

    expect(mock.name).toBe("Weather");
    expect(mock.description).toBe("Get weather");
    expect(await mock.execute({})).toBe("Sunny, 72F");
  });

  it("supports schema in fluent API", () => {
    const mock = mockGadget()
      .withName("Search")
      .withSchema(z.object({ query: z.string() }))
      .returns("results")
      .build();

    expect(mock.parameterSchema).toBeDefined();
  });

  it("supports returnsAsync", async () => {
    const mock = mockGadget()
      .withName("Async")
      .returnsAsync(async (params) => `Processed: ${params.input}`)
      .build();

    expect(await mock.execute({ input: "test" })).toBe("Processed: test");
  });

  it("supports throws", async () => {
    const mock = mockGadget().withName("Error").throws("Failed").build();

    await expect(mock.execute({})).rejects.toThrow("Failed");
  });

  it("supports delay", async () => {
    const mock = mockGadget().withName("Slow").returns("done").withDelay(30).build();

    const start = Date.now();
    await mock.execute({});
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(30);
  });

  it("supports timeout", () => {
    const mock = mockGadget().withName("Timed").withTimeout(3000).build();

    expect(mock.timeoutMs).toBe(3000);
  });

  it("enables tracking by default", async () => {
    const mock = mockGadget().withName("Tracked").returns("done").build();

    await mock.execute({ a: 1 });
    expect(mock.getCallCount()).toBe(1);
  });

  it("supports noTracking", async () => {
    const mock = mockGadget().withName("Untracked").returns("done").noTracking().build();

    await mock.execute({ a: 1 });
    expect(mock.getCallCount()).toBe(0);
  });

  it("trackCalls is idempotent", async () => {
    const mock = mockGadget().withName("Track").returns("done").trackCalls().trackCalls().build();

    await mock.execute({ a: 1 });
    expect(mock.getCallCount()).toBe(1);
  });

  it("clears resultFn when using returns", async () => {
    const builder = new MockGadgetBuilder();
    builder
      .withName("Test")
      .returnsAsync(async () => "async")
      .returns("static");

    const mock = builder.build();
    expect(await mock.execute({})).toBe("static");
  });

  it("clears result when using returnsAsync", async () => {
    const builder = new MockGadgetBuilder();
    builder
      .withName("Test")
      .returns("static")
      .returnsAsync(async () => "async");

    const mock = builder.build();
    expect(await mock.execute({})).toBe("async");
  });
});
