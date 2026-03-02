import { describe, expect, test, vi } from "vitest";
import { createTextToSpeech, textToSpeech } from "./text-to-speech.js";

describe("TextToSpeech gadget", () => {
  describe("factory function", () => {
    test("creates gadget with default configuration", () => {
      const gadget = createTextToSpeech();
      expect(gadget.name).toBe("TextToSpeech");
      expect(gadget.description).toContain("tts-1");
      expect(gadget.description).toContain("nova");
      expect(gadget.description).toContain("mp3");
    });

    test("creates gadget with custom configuration", () => {
      const gadget = createTextToSpeech({
        model: "tts-1-hd",
        voice: "alloy",
        format: "wav",
        speed: 0.8,
      });
      expect(gadget.description).toContain("tts-1-hd");
      expect(gadget.description).toContain("alloy");
      expect(gadget.description).toContain("wav");
    });

    test("partial config uses defaults for missing values", () => {
      const gadget = createTextToSpeech({ voice: "onyx" });
      expect(gadget.description).toContain("tts-1"); // default model
      expect(gadget.description).toContain("onyx"); // custom voice
      expect(gadget.description).toContain("mp3"); // default format
    });

    test("throws error for invalid voice in config", () => {
      expect(() => createTextToSpeech({ voice: "invalid" })).toThrow('Invalid TTS voice "invalid"');
      expect(() => createTextToSpeech({ voice: "invalid" })).toThrow(
        "Valid voices: alloy, echo, fable, onyx, nova, shimmer",
      );
    });

    test("throws error for invalid format in config", () => {
      expect(() => createTextToSpeech({ format: "ogg" })).toThrow('Invalid TTS format "ogg"');
      expect(() => createTextToSpeech({ format: "ogg" })).toThrow(
        "Valid formats: mp3, opus, aac, flac, wav",
      );
    });

    test("throws error for speed out of range in config", () => {
      expect(() => createTextToSpeech({ speed: 0.1 })).toThrow('Invalid TTS speed "0.1"');
      expect(() => createTextToSpeech({ speed: 5.0 })).toThrow('Invalid TTS speed "5"');
      expect(() => createTextToSpeech({ speed: -1 })).toThrow("Must be between 0.25 and 4.0");
    });

    test("accepts valid edge case speeds", () => {
      expect(() => createTextToSpeech({ speed: 0.25 })).not.toThrow();
      expect(() => createTextToSpeech({ speed: 4.0 })).not.toThrow();
    });
  });

  describe("execute", () => {
    test("returns error when no context is provided", async () => {
      const result = await textToSpeech.execute({ text: "Hello" });
      expect(result).toContain("status=1");
      expect(result).toContain("Speech generation requires LLMist client with speech capability");
    });

    test("returns error when context has no llmist client", async () => {
      const result = await textToSpeech.execute({ text: "Hello" }, {} as any);
      expect(result).toContain("status=1");
      expect(result).toContain("Speech generation requires LLMist client with speech capability");
    });

    test("returns error when context.llmist is null", async () => {
      const result = await textToSpeech.execute({ text: "Hello" }, { llmist: null } as any);
      expect(result).toContain("status=1");
      expect(result).toContain("Speech generation requires LLMist client with speech capability");
    });

    test("returns error when context.llmist.speech is missing", async () => {
      const result = await textToSpeech.execute({ text: "Hello" }, { llmist: {} } as any);
      expect(result).toContain("status=1");
      expect(result).toContain("Speech generation requires LLMist client with speech capability");
    });

    test("returns error when context.llmist.speech.generate is missing", async () => {
      const result = await textToSpeech.execute({ text: "Hello" }, {
        llmist: { speech: {} },
      } as any);
      expect(result).toContain("status=1");
      expect(result).toContain("Speech generation requires LLMist client with speech capability");
    });

    test("calls speech.generate with correct parameters", async () => {
      const mockGenerate = vi.fn().mockResolvedValue({
        audio: new ArrayBuffer(100),
        model: "tts-1",
        usage: { characterCount: 5 },
        cost: 0.000075,
        format: "mp3",
      });

      const mockCtx = {
        llmist: {
          speech: {
            generate: mockGenerate,
          },
        },
      };

      const gadget = createTextToSpeech();
      await gadget.execute({ text: "Hello" }, mockCtx as any);

      expect(mockGenerate).toHaveBeenCalledWith({
        model: "tts-1",
        input: "Hello",
        voice: "nova",
        responseFormat: "mp3",
        speed: 1.0,
      });
    });

    test("uses config defaults when parameters not provided", async () => {
      const mockGenerate = vi.fn().mockResolvedValue({
        audio: new ArrayBuffer(100),
        model: "tts-1-hd",
        usage: { characterCount: 5 },
        cost: 0.00015,
        format: "wav",
      });

      const mockCtx = {
        llmist: {
          speech: {
            generate: mockGenerate,
          },
        },
      };

      const gadget = createTextToSpeech({
        model: "tts-1-hd",
        voice: "alloy",
        format: "wav",
        speed: 0.8,
      });
      await gadget.execute({ text: "Test" }, mockCtx as any);

      expect(mockGenerate).toHaveBeenCalledWith({
        model: "tts-1-hd",
        input: "Test",
        voice: "alloy",
        responseFormat: "wav",
        speed: 0.8,
      });
    });

    test("overrides config defaults with explicit parameters", async () => {
      const mockGenerate = vi.fn().mockResolvedValue({
        audio: new ArrayBuffer(100),
        model: "tts-1",
        usage: { characterCount: 5 },
        cost: 0.000075,
        format: "opus",
      });

      const mockCtx = {
        llmist: {
          speech: {
            generate: mockGenerate,
          },
        },
      };

      const gadget = createTextToSpeech({
        model: "tts-1-hd",
        voice: "nova",
        format: "mp3",
        speed: 1.0,
      });
      await gadget.execute(
        {
          text: "Override test",
          model: "tts-1",
          voice: "echo",
          format: "opus",
          speed: 1.5,
        },
        mockCtx as any,
      );

      expect(mockGenerate).toHaveBeenCalledWith({
        model: "tts-1",
        input: "Override test",
        voice: "echo",
        responseFormat: "opus",
        speed: 1.5,
      });
    });

    test("returns media result with audio on success", async () => {
      const mockGenerate = vi.fn().mockResolvedValue({
        audio: new ArrayBuffer(100),
        model: "tts-1",
        usage: { characterCount: 12 },
        cost: 0.00018,
        format: "mp3",
      });

      const mockCtx = {
        llmist: {
          speech: {
            generate: mockGenerate,
          },
        },
      };

      const result = await textToSpeech.execute({ text: "Hello world!" }, mockCtx as any);

      // Result should be a GadgetExecuteResultWithMedia object
      expect(typeof result).toBe("object");
      expect((result as any).result).toContain("Generated audio");
      expect((result as any).result).toContain("mp3");
      expect((result as any).result).toContain("12 chars");
      expect((result as any).result).toContain("$0.000180");
      expect((result as any).media).toBeDefined();
      expect((result as any).media[0].kind).toBe("audio");
      expect((result as any).media[0].mimeType).toBe("audio/mp3");
      expect((result as any).cost).toBe(0.00018);
    });

    test("handles generate errors gracefully", async () => {
      const mockGenerate = vi.fn().mockRejectedValue(new Error("API rate limit exceeded"));

      const mockCtx = {
        llmist: {
          speech: {
            generate: mockGenerate,
          },
        },
      };

      const result = await textToSpeech.execute({ text: "Hello" }, mockCtx as any);
      expect(result).toContain("status=1");
      expect(result).toContain("API rate limit exceeded");
    });

    test("handles undefined cost gracefully", async () => {
      const mockGenerate = vi.fn().mockResolvedValue({
        audio: new ArrayBuffer(100),
        model: "tts-1",
        usage: { characterCount: 5 },
        cost: undefined,
        format: "mp3",
      });

      const mockCtx = {
        llmist: {
          speech: {
            generate: mockGenerate,
          },
        },
      };

      const result = await textToSpeech.execute({ text: "Hello" }, mockCtx as any);
      expect((result as any).result).toContain("$N/A");
    });

    test("truncates description for long text", async () => {
      const mockGenerate = vi.fn().mockResolvedValue({
        audio: new ArrayBuffer(100),
        model: "tts-1",
        usage: { characterCount: 100 },
        cost: 0.0015,
        format: "mp3",
      });

      const mockCtx = {
        llmist: {
          speech: {
            generate: mockGenerate,
          },
        },
      };

      const longText = "A".repeat(100);
      const result = await textToSpeech.execute({ text: longText }, mockCtx as any);

      // Description should be truncated with ellipsis
      expect((result as any).media[0].description).toContain("...");
      expect((result as any).media[0].description.length).toBeLessThan(100);
    });
  });

  describe("schema", () => {
    test("has correct gadget name", () => {
      expect(textToSpeech.name).toBe("TextToSpeech");
    });

    test("has description", () => {
      expect(textToSpeech.description).toContain("Convert text to speech");
    });

    test("has examples", () => {
      expect(textToSpeech.examples.length).toBeGreaterThan(0);
    });

    test("validates required text parameter", () => {
      const schema = textToSpeech.parameterSchema;
      expect(schema).toBeDefined();
      // Verify empty text fails validation
      const emptyResult = schema!.safeParse({ text: "" });
      expect(emptyResult.success).toBe(false);
      // Verify non-empty text passes
      const validResult = schema!.safeParse({ text: "Hello" });
      expect(validResult.success).toBe(true);
    });

    test("validates speed range", () => {
      const schema = textToSpeech.parameterSchema;
      expect(schema).toBeDefined();
      // Speed below minimum should fail
      const tooSlow = schema!.safeParse({ text: "test", speed: 0.1 });
      expect(tooSlow.success).toBe(false);
      // Speed above maximum should fail
      const tooFast = schema!.safeParse({ text: "test", speed: 5.0 });
      expect(tooFast.success).toBe(false);
      // Valid speeds should pass
      const validSlow = schema!.safeParse({ text: "test", speed: 0.25 });
      expect(validSlow.success).toBe(true);
      const validFast = schema!.safeParse({ text: "test", speed: 4.0 });
      expect(validFast.success).toBe(true);
    });
  });

  describe("default export", () => {
    test("textToSpeech is a valid gadget instance", () => {
      expect(textToSpeech.name).toBe("TextToSpeech");
      expect(typeof textToSpeech.execute).toBe("function");
      expect(textToSpeech.parameterSchema).toBeDefined();
    });
  });
});
