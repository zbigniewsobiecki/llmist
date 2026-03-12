import type { LLMGenerationOptions } from "llmist";
import { audioFromBuffer, imageFromBuffer, text } from "llmist";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mockLLM, resetMocks } from "./index.js";
import { createMockClient } from "./mock-client.js";
import { MockManager } from "./mock-manager.js";

describe("MockBuilder", () => {
  beforeEach(() => {
    resetMocks();
  });

  afterEach(() => {
    resetMocks();
  });

  // Helper to consume a stream and return a complete response-like object
  async function completeMock(client: any, options: LLMGenerationOptions) {
    const stream = client.stream(options);
    let responseText = "";
    let usage: any;
    let finishReason: any;

    for await (const chunk of stream) {
      if (chunk.text) responseText += chunk.text;
      if (chunk.usage) usage = chunk.usage;
      if (chunk.finishReason) finishReason = chunk.finishReason;
    }

    return { text: responseText, usage, finishReason };
  }

  describe("Multimodal Matchers", () => {
    test("forImage() and whenMessageHasImage() detect messages with image content", async () => {
      mockLLM().forImage().returns("I see an image!").register();

      const client = createMockClient();

      // Should match message with image
      const res1 = await completeMock(client, {
        model: "mock:test",
        messages: [
          {
            role: "user",
            content: [
              text("Look at this"),
              imageFromBuffer(Buffer.from("fake-image"), "image/png"),
            ],
          },
        ],
      });

      expect(res1.text).toBe("I see an image!");

      // Should NOT match message with only text
      const res2 = await completeMock(client, {
        model: "mock:test",
        messages: [{ role: "user", content: "Just text here" }],
      });

      // In non-strict mode it returns empty string
      expect(res2.text).toBe("");
    });

    test("forAudio() and whenMessageHasAudio() detect messages with audio content", async () => {
      mockLLM().forAudio().returns("I hear you!").register();

      const client = createMockClient();

      // Should match message with audio
      const res1 = await completeMock(client, {
        model: "mock:test",
        messages: [
          {
            role: "user",
            content: [audioFromBuffer(Buffer.from("fake-audio"), "audio/mpeg")],
          },
        ],
      });

      expect(res1.text).toBe("I hear you!");
    });

    test("withImageCount() matches specific image counts", async () => {
      // Predicate match
      mockLLM()
        .withImageCount((n) => n === 2)
        .returns("Exactly two images")
        .register();

      mockLLM()
        .withImageCount((n) => n > 2)
        .returns("More than two images")
        .register();

      const client = createMockClient();

      // Test 2 images
      const res1 = await completeMock(client, {
        model: "mock:test",
        messages: [
          {
            role: "user",
            content: [
              imageFromBuffer(Buffer.from("1"), "image/png"),
              imageFromBuffer(Buffer.from("2"), "image/png"),
            ],
          },
        ],
      });
      expect(res1.text).toBe("Exactly two images");

      // Test 3 images
      const res2 = await completeMock(client, {
        model: "mock:test",
        messages: [
          {
            role: "user",
            content: [
              imageFromBuffer(Buffer.from("1"), "image/png"),
              imageFromBuffer(Buffer.from("2"), "image/png"),
              imageFromBuffer(Buffer.from("3"), "image/png"),
            ],
          },
        ],
      });
      expect(res2.text).toBe("More than two images");
    });
  });

  describe("Sequence and Dynamic Responses", () => {
    test("returnsSequence() returns different responses in order and cycles", async () => {
      mockLLM()
        .forModel("sequencer")
        .returnsSequence([{ text: "First" }, { text: "Second" }, { text: "Third" }])
        .register();

      const client = createMockClient();
      const call = () => completeMock(client, { model: "mock:sequencer", messages: [] });

      expect((await call()).text).toBe("First");
      expect((await call()).text).toBe("Second");
      expect((await call()).text).toBe("Third");
      expect((await call()).text).toBe("First"); // Cycles back
    });

    test("returnsDynamic() calls function with context", async () => {
      mockLLM()
        .forModel("dynamic")
        .returnsDynamic((ctx) => ({
          text: `Model is ${ctx.modelName}`,
        }))
        .register();

      const client = createMockClient();
      const res = await completeMock(client, { model: "mock:dynamic", messages: [] });
      expect(res.text).toBe("Model is dynamic");
    });
  });

  describe("Registration and Metadata", () => {
    test("withId() and withLabel() set registration metadata", () => {
      const builder = mockLLM().forAnyModel().withId("custom-id").withLabel("custom-label");

      const reg = builder.build();
      expect(reg.id).toBe("custom-id");
      expect(reg.label).toBe("custom-label");

      const registeredId = builder.register();
      expect(registeredId).toBe("custom-id");

      const manager = MockManager.getInstance();
      expect(manager.getMockIds()).toContain("custom-id");
    });

    test("once() auto-deregisters after first match", async () => {
      mockLLM().forModel("once").returns("Only once").once().register();

      const client = createMockClient();
      const call = () => completeMock(client, { model: "mock:once", messages: [] });

      expect((await call()).text).toBe("Only once");

      // Second call should return empty (no match)
      expect((await call()).text).toBe("");
    });
  });

  describe("Edge Cases and Guards", () => {
    test("forAnyProvider() and forAnyModel() match anything", async () => {
      mockLLM().forAnyProvider().returns("Any provider").register();
      mockLLM().forAnyModel().returns("Any model").register();

      const client = createMockClient();
      expect((await completeMock(client, { model: "foo:bar", messages: [] })).text).toBe(
        "Any provider",
      );
    });

    test("empty model/provider names throw errors", () => {
      expect(() => mockLLM().forModel("")).toThrow("Model name cannot be empty");
      expect(() => mockLLM().forModel("   ")).toThrow("Model name cannot be empty");
      expect(() => mockLLM().forProvider("")).toThrow("Provider name cannot be empty");
    });

    test("build() throws if no matchers are added", () => {
      expect(() => mockLLM().build()).toThrow("Mock must have at least one matcher");
    });

    test("multiple matchers combine with AND logic", async () => {
      mockLLM().forProvider("openai").forModel("gpt-4").returns("Matched both").register();

      const client = createMockClient();

      // Both match
      expect((await completeMock(client, { model: "openai:gpt-4", messages: [] })).text).toBe(
        "Matched both",
      );

      // Only provider matches
      expect((await completeMock(client, { model: "openai:other", messages: [] })).text).toBe("");

      // Only model matches (different provider)
      expect((await completeMock(client, { model: "anthropic:gpt-4", messages: [] })).text).toBe(
        "",
      );
    });
  });

  describe("State Management", () => {
    test("resetMocks() clears all registered mocks", () => {
      mockLLM().forAnyModel().returns("Hi").register();
      const manager = MockManager.getInstance();
      expect(manager.getCount()).toBe(1);

      resetMocks();
      expect(manager.getCount()).toBe(0);
    });

    test("resetMocks() in beforeEach prevents state leaks", () => {
      // This is partially verified by other tests, but let's be explicit
      const manager = MockManager.getInstance();
      expect(manager.getCount()).toBe(0); // Should be 0 due to beforeEach

      mockLLM().forAnyModel().returns("Stay").register();
      expect(manager.getCount()).toBe(1);
    });
  });

  describe("Guards and Error Cases", () => {
    test("throws when setting properties after withResponse() with a function", () => {
      const builder = mockLLM()
        .forAnyModel()
        .withResponse(() => ({ text: "hi" }));

      expect(() => builder.returns("fail")).toThrow("Cannot use returns() after withResponse()");
      expect(() => builder.returnsGadgetCalls([])).toThrow(
        "Cannot use returnsGadgetCalls() after withResponse()",
      );
      expect(() => builder.returnsGadgetCall("g", {})).toThrow(
        "Cannot use returnsGadgetCall() after withResponse()",
      );
      expect(() => builder.returnsImage(Buffer.from(""), "image/png")).toThrow(
        "Cannot use returnsImage() after withResponse()",
      );
      expect(() => builder.returnsAudio(Buffer.from(""), "audio/mpeg")).toThrow(
        "Cannot use returnsAudio() after withResponse()",
      );
      expect(() => builder.withUsage({ inputTokens: 0, outputTokens: 0, totalTokens: 0 })).toThrow(
        "Cannot use withUsage() after withResponse()",
      );
      expect(() => builder.withFinishReason("stop")).toThrow(
        "Cannot use withFinishReason() after withResponse()",
      );
      expect(() => builder.withDelay(100)).toThrow("Cannot use withDelay() after withResponse()");
      expect(() => builder.withStreamDelay(10)).toThrow(
        "Cannot use withStreamDelay() after withResponse()",
      );
    });

    test("withUsage() validates token counts", () => {
      const builder = mockLLM().forAnyModel();

      expect(() =>
        builder.withUsage({ inputTokens: -1, outputTokens: 0, totalTokens: -1 }),
      ).toThrow("Token counts cannot be negative");
      expect(() => builder.withUsage({ inputTokens: 5, outputTokens: 5, totalTokens: 11 })).toThrow(
        "totalTokens must equal inputTokens + outputTokens",
      );
    });

    test("withDelay() and withStreamDelay() validate non-negative values", () => {
      const builder = mockLLM().forAnyModel();

      expect(() => builder.withDelay(-100)).toThrow("Delay must be non-negative");
      expect(() => builder.withStreamDelay(-10)).toThrow("Stream delay must be non-negative");
    });

    test("returnsImage() and returnsAudio() validate base64 mimeType", () => {
      const builder = mockLLM().forAnyModel();

      expect(() => builder.returnsImage("base64-data")).toThrow(
        "MIME type is required when providing base64 string data",
      );
      expect(() => builder.returnsAudio("base64-data")).toThrow(
        "MIME type is required when providing base64 string data",
      );
    });
  });

  describe("Advanced Response Properties", () => {
    test("withDelay() and withStreamDelay() set response delays", () => {
      const reg = mockLLM().forAnyModel().withDelay(500).withStreamDelay(50).build();

      const response = reg.response as any;
      expect(response.delayMs).toBe(500);
      expect(response.streamDelayMs).toBe(50);
    });

    test("returnsAudio() with Buffer detects mimeType", () => {
      const reg = mockLLM()
        .forAnyModel()
        // Mocking Buffer to look like MP3 (very basic)
        .returnsAudio(Buffer.from([0xff, 0xfb, 0x90, 0x44]))
        .build();

      const response = reg.response as any;
      // Note: detectAudioMimeType returns audio/mp3 for this basic header
      expect(response.audio.mimeType).toBe("audio/mp3");
    });

    test("returnsImages() sets multiple images and revised prompt", () => {
      const reg = mockLLM()
        .forAnyModel()
        .returnsImages([
          { data: Buffer.from("img1"), mimeType: "image/png", revisedPrompt: "prompt 1" },
          { data: Buffer.from("img2"), mimeType: "image/jpeg" },
        ])
        .build();

      const response = reg.response as any;
      expect(response.images).toHaveLength(2);
      expect(response.images[0].revisedPrompt).toBe("prompt 1");
      expect(response.images[1].mimeType).toBe("image/jpeg");
    });

    test("returnsAudio() with Buffer detects mimeType and revised prompt on images", () => {
      // Test revised prompt on images via returnsImages
      const regImages = mockLLM()
        .forAnyModel()
        .returnsImages([{ data: Buffer.from(""), mimeType: "image/png", revisedPrompt: "revised" }])
        .build();
      expect((regImages.response as any).images[0].revisedPrompt).toBe("revised");

      // Test audio detection
      const regAudio = mockLLM()
        .forAnyModel()
        .returnsAudio(Buffer.from([0xff, 0xfb]))
        .build();
      expect((regAudio.response as any).audio.mimeType).toBeDefined();
    });

    test("returnsAudio() and returnsImage() error paths", () => {
      const builder = mockLLM().forAnyModel();

      // Trigger could not detect MIME type
      expect(() => builder.returnsAudio(Buffer.from([0x00, 0x00, 0x00]))).toThrow(
        "Could not detect audio MIME type",
      );
      expect(() => builder.returnsImage(Buffer.from([0x00, 0x00, 0x00]))).toThrow(
        "Could not detect image MIME type",
      );
    });

    test("withUsage() and withFinishReason() set response metadata", async () => {
      mockLLM()
        .forModel("metadata")
        .returns("Metadata test")
        .withUsage({ inputTokens: 10, outputTokens: 20, totalTokens: 30 })
        .withFinishReason("length")
        .register();

      const client = createMockClient();
      const res = await completeMock(client, { model: "mock:metadata", messages: [] });

      expect(res.text).toBe("Metadata test");
      expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 20, totalTokens: 30 });
      expect(res.finishReason).toBe("length");
    });

    test("returns() with async function works", async () => {
      mockLLM()
        .forModel("async")
        .returns(async () => {
          await new Promise((r) => setTimeout(r, 10));
          return "Async response";
        })
        .register();

      const client = createMockClient();
      const res = await completeMock(client, { model: "mock:async", messages: [] });
      expect(res.text).toBe("Async response");
    });

    test("returnsGadgetCalls() and returnsGadgetCall() work", async () => {
      mockLLM()
        .forModel("gadgets")
        .returns("Gadget test")
        .returnsGadgetCalls([{ gadgetName: "g1", parameters: { p1: 1 } }])
        .returnsGadgetCall("g2", { p2: 2 })
        .register();

      const client = createMockClient();
      const res = await completeMock(client, { model: "mock:gadgets", messages: [] });

      expect(res.text).toContain("Gadget test");
      expect(res.text).toContain("!!!GADGET_START:g1");
      expect(res.text).toContain("!!!GADGET_START:g2");
    });

    test("whenMessageMatches() works", async () => {
      mockLLM()
        .forAnyModel()
        .whenMessageMatches(/hello \d+/)
        .returns("Matched regex")
        .register();

      const client = createMockClient();
      const res = await completeMock(client, {
        model: "mock:test",
        messages: [{ role: "user", content: "hello 123" }],
      });
      expect(res.text).toBe("Matched regex");
    });

    test("whenRoleContains() works", async () => {
      mockLLM()
        .forAnyModel()
        .whenRoleContains("system", "important")
        .returns("System matched")
        .register();

      const client = createMockClient();
      const res = await completeMock(client, {
        model: "mock:test",
        messages: [
          { role: "system", content: "This is important" },
          { role: "user", content: "hi" },
        ],
      });
      expect(res.text).toBe("System matched");
    });

    test("whenMessageCount() works", async () => {
      mockLLM()
        .forAnyModel()
        .whenMessageCount((n) => n === 2)
        .returns("Two messages")
        .register();

      const client = createMockClient();
      const res = await completeMock(client, {
        model: "mock:test",
        messages: [
          { role: "user", content: "1" },
          { role: "assistant", content: "2" },
        ],
      });
      expect(res.text).toBe("Two messages");
    });

    test("whenLastMessageContains() works", async () => {
      mockLLM().forAnyModel().whenLastMessageContains("bye").returns("Goodbye!").register();

      const client = createMockClient();
      const res = await completeMock(client, {
        model: "mock:test",
        messages: [
          { role: "user", content: "bye" },
          { role: "assistant", content: "wait" }, // this is the last one in a real scenario if assistant just replied, but here messages is what LLM receives
        ],
      });
      // In this test messages[1] is "wait", so it shouldn't match if we are strict.
      // But completeMock calls client.stream with messages.
      // If messages is [{role: 'user', content: 'bye'}], it should match.

      const res2 = await completeMock(client, {
        model: "mock:test",
        messages: [{ role: "user", content: "bye" }],
      });
      expect(res2.text).toBe("Goodbye!");
    });
  });
});
