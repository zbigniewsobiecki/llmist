import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mockLLM } from "./mock-builder.js";
import { createMockClient } from "./mock-client.js";
import { MockManager } from "./mock-manager.js";

describe("Mock Integration (Simple)", () => {
  beforeEach(() => {
    MockManager.reset();
  });

  afterEach(() => {
    MockManager.reset();
  });

  test("should handle text responses", async () => {
    mockLLM()
      .forModel("test")
      .whenMessageContains("hello")
      .returns("Hello! How can I help you today?")
      .withUsage({ inputTokens: 5, outputTokens: 8, totalTokens: 13 })
      .register();

    const client = createMockClient();
    const stream = client.stream({
      model: "mock:test",
      messages: [{ role: "user", content: "hello" }],
    });

    let fullResponse = "";
    let usage: { inputTokens: number; outputTokens: number; totalTokens: number } | undefined;

    for await (const chunk of stream) {
      fullResponse += chunk.text;
      if (chunk.usage) {
        usage = chunk.usage;
      }
    }

    expect(fullResponse).toBe("Hello! How can I help you today?");
    expect(usage).toEqual({ inputTokens: 5, outputTokens: 8, totalTokens: 13 });
  });

  test("should handle gadget calls in responses", async () => {
    mockLLM()
      .forModel("test")
      .returns("Calculating...")
      .returnsGadgetCall("calculator", { operation: "add", a: 5, b: 3 })
      .register();

    const client = createMockClient();
    const stream = client.stream({
      model: "mock:test",
      messages: [{ role: "user", content: "Add 5 and 3" }],
    });

    let fullText = "";
    for await (const chunk of stream) {
      fullText += chunk.text;
    }

    // Should include both text and gadget marker in block format
    expect(fullText).toContain("Calculating...");
    expect(fullText).toContain("!!!GADGET_START:calculator");
    expect(fullText).toContain("!!!ARG:operation");
    expect(fullText).toContain("add");
  });

  test("should handle multiple sequential calls with once()", async () => {
    // First mock - use once()
    mockLLM().forModel("test").returns("First response").once().register();

    // Second mock - fallback
    mockLLM().forModel("test").returns("Second response").register();

    const client = createMockClient();

    // First call
    let stream = client.stream({
      model: "mock:test",
      messages: [{ role: "user", content: "test" }],
    });

    let response1 = "";
    for await (const chunk of stream) {
      response1 += chunk.text;
    }
    expect(response1).toBe("First response");

    // Second call - first mock should be consumed
    stream = client.stream({
      model: "mock:test",
      messages: [{ role: "user", content: "test" }],
    });

    let response2 = "";
    for await (const chunk of stream) {
      response2 += chunk.text;
    }
    expect(response2).toBe("Second response");
  });

  test("should match based on message content", async () => {
    mockLLM()
      .forModel("test")
      .whenMessageContains("weather")
      .returns("It's sunny today!")
      .register();

    mockLLM().forModel("test").whenMessageContains("time").returns("It's 3:00 PM").register();

    const client = createMockClient();

    // Test weather query
    let stream = client.stream({
      model: "mock:test",
      messages: [{ role: "user", content: "What's the weather?" }],
    });

    let response1 = "";
    for await (const chunk of stream) {
      response1 += chunk.text;
    }
    expect(response1).toBe("It's sunny today!");

    // Test time query
    stream = client.stream({
      model: "mock:test",
      messages: [{ role: "user", content: "What time is it?" }],
    });

    let response2 = "";
    for await (const chunk of stream) {
      response2 += chunk.text;
    }
    expect(response2).toBe("It's 3:00 PM");
  });

  test("should support regex matching", async () => {
    mockLLM()
      .forModel("test")
      .whenMessageMatches(/\d+\s*\+\s*\d+/) // Matches "5 + 3" or "5+3"
      .returns("That's a math problem!")
      .register();

    const client = createMockClient();
    const stream = client.stream({
      model: "mock:test",
      messages: [{ role: "user", content: "What is 5 + 3?" }],
    });

    let response = "";
    for await (const chunk of stream) {
      response += chunk.text;
    }
    expect(response).toBe("That's a math problem!");
  });

  test("should support custom matcher functions", async () => {
    mockLLM()
      .when((ctx) => ctx.messages.length > 3)
      .returns("This is a long conversation!")
      .register();

    mockLLM()
      .when((ctx) => ctx.messages.length <= 3)
      .returns("This is a short conversation")
      .register();

    const client = createMockClient();

    // Short conversation
    let stream = client.stream({
      model: "mock:test",
      messages: [{ role: "user", content: "Hi" }],
    });

    let response1 = "";
    for await (const chunk of stream) {
      response1 += chunk.text;
    }
    expect(response1).toBe("This is a short conversation");

    // Long conversation
    stream = client.stream({
      model: "mock:test",
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello" },
        { role: "user", content: "How are you?" },
        { role: "assistant", content: "I'm good" },
        { role: "user", content: "Great!" },
      ],
    });

    let response2 = "";
    for await (const chunk of stream) {
      response2 += chunk.text;
    }
    expect(response2).toBe("This is a long conversation!");
  });

  test("should support dynamic responses based on context", async () => {
    mockLLM()
      .forModel("test")
      .when(() => true)
      .withResponse((ctx) => {
        const lastMsg = ctx.messages[ctx.messages.length - 1];
        const name = lastMsg.content?.match(/name is (\w+)/)?.[1];
        return {
          text: name ? `Nice to meet you, ${name}!` : "Hello!",
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        };
      })
      .register();

    const client = createMockClient();

    // Without name
    let stream = client.stream({
      model: "mock:test",
      messages: [{ role: "user", content: "Hi there" }],
    });

    let response1 = "";
    for await (const chunk of stream) {
      response1 += chunk.text;
    }
    expect(response1).toBe("Hello!");

    // With name
    stream = client.stream({
      model: "mock:test",
      messages: [{ role: "user", content: "My name is Alice" }],
    });

    let response2 = "";
    for await (const chunk of stream) {
      response2 += chunk.text;
    }
    expect(response2).toBe("Nice to meet you, Alice!");
  });
});
