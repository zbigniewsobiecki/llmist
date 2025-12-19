import { describe, expect, it } from "bun:test";
import { Readable, Writable } from "node:stream";
import type { LLMist } from "llmist";
import type { ImageModelSpec, SpeechModelSpec } from "llmist";
import type { ModelSpec } from "llmist";
import { ModelRegistry } from "llmist";
import { createLogger } from "llmist";
import type { CLIEnvironment } from "./environment.js";
import { runCLI } from "./program.js";

/**
 * Helper to create a readable stream.
 */
function createReadable(content: string, { isTTY = false } = {}): Readable & { isTTY?: boolean } {
  const stream = Readable.from([content]) as Readable & { isTTY?: boolean };
  stream.isTTY = isTTY;
  return stream;
}

/**
 * Helper to create a writable stream that captures output.
 */
function createWritable(isTTY = true) {
  let data = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      data += chunk.toString();
      callback();
    },
  });
  (stream as NodeJS.WriteStream & { isTTY: boolean }).isTTY = isTTY;
  return { stream, read: () => data };
}

/**
 * Helper to create a minimal CLI environment for testing.
 */
function createEnv(overrides: Partial<CLIEnvironment> = {}): CLIEnvironment {
  const stdin = createReadable("", { isTTY: false });
  const stdout = createWritable();
  const stderr = createWritable();

  return {
    argv: ["node", "llmist"],
    stdin,
    stdout: stdout.stream,
    stderr: stderr.stream,
    createClient: () => {
      throw new Error("Client not provided");
    },
    setExitCode: () => {},
    createLogger: (name: string) => createLogger({ type: "hidden", name }),
    isTTY: false,
    prompt: async () => {
      throw new Error("Cannot prompt in test environment");
    },
    ...overrides,
  };
}

/**
 * Helper to create a test model spec.
 */
function createModelSpec(
  provider: string,
  modelId: string,
  displayName: string,
  contextWindow: number,
  maxOutputTokens: number,
  inputPrice: number,
  outputPrice: number,
  cachedInputPrice?: number,
): ModelSpec {
  return {
    provider,
    modelId,
    displayName,
    contextWindow,
    maxOutputTokens,
    pricing: {
      input: inputPrice,
      output: outputPrice,
      cachedInput: cachedInputPrice,
    },
    features: {
      streaming: true,
      functionCalling: true,
      vision: false,
    },
    metadata: {
      family: "Test Family",
      releaseDate: "2024-01-01",
    },
  };
}

/**
 * Helper to create a mock client with test model specs.
 */
function createTestClient(models: ModelSpec[]): LLMist {
  const registry = new ModelRegistry();
  registry.registerModels(models);

  return {
    modelRegistry: registry,
    // Mock image and speech namespaces for multimodal support
    image: {
      listModels: () => [],
    },
    speech: {
      listModels: () => [],
    },
  } as unknown as LLMist;
}

describe("models command", () => {
  const testModels = [
    createModelSpec("openai", "gpt-4o", "GPT-4o", 128_000, 16_384, 2.5, 10.0),
    createModelSpec("openai", "gpt-5-nano", "GPT-5 Nano", 200_000, 32_768, 0.5, 1.5),
    createModelSpec(
      "anthropic",
      "claude-sonnet-4-5",
      "Claude Sonnet 4.5",
      200_000,
      64_000,
      3.0,
      15.0,
      0.3,
    ),
    createModelSpec(
      "anthropic",
      "claude-haiku-4-5",
      "Claude Haiku 4.5",
      200_000,
      64_000,
      1.0,
      5.0,
      0.1,
    ),
    createModelSpec("gemini", "gemini-2.5-pro", "Gemini 2.5 Pro", 1_000_000, 65_536, 1.25, 5.0),
  ];

  describe("table output (default)", () => {
    it("should display models grouped by provider", async () => {
      const stdout = createWritable();
      const stderr = createWritable();
      const client = createTestClient(testModels);

      const env = createEnv({
        argv: ["node", "llmist", "models"],
        stdout: stdout.stream,
        stderr: stderr.stream,
        createClient: () => client,
      });

      await runCLI(env);

      const output = stdout.read();

      // Should have header
      expect(output).toContain("Available Models");

      // Should group by provider (capitalized)
      expect(output).toContain("Openai");
      expect(output).toContain("Anthropic");
      expect(output).toContain("Gemini");

      // Should show model names
      expect(output).toContain("gpt-4o");
      expect(output).toContain("gpt-5-nano");
      expect(output).toContain("claude-sonnet-4-5");
      expect(output).toContain("claude-haiku-4-5");
      expect(output).toContain("gemini-2.5-pro");
    });

    it("should display pricing and context information", async () => {
      const stdout = createWritable();
      const stderr = createWritable();
      const client = createTestClient(testModels);

      const env = createEnv({
        argv: ["node", "llmist", "models"],
        stdout: stdout.stream,
        stderr: stderr.stream,
        createClient: () => client,
      });

      await runCLI(env);

      const output = stdout.read();

      // Should show prices
      expect(output).toContain("$2.50");
      expect(output).toContain("$10.00");

      // Should show pricing note
      expect(output).toContain("per 1M tokens");

      // Should show context windows
      expect(output).toContain("128K tokens");
      expect(output).toContain("200K tokens");
      expect(output).toContain("1.0M tokens");
    });

    it("should display model shortcuts", async () => {
      const stdout = createWritable();
      const stderr = createWritable();
      const client = createTestClient(testModels);

      const env = createEnv({
        argv: ["node", "llmist", "models"],
        stdout: stdout.stream,
        stderr: stderr.stream,
        createClient: () => client,
      });

      await runCLI(env);

      const output = stdout.read();

      // Should have shortcuts section
      expect(output).toContain("Model Shortcuts");

      // Should show some common shortcuts
      expect(output).toContain("sonnet");
      expect(output).toContain("haiku");
    });
  });

  describe("provider filtering", () => {
    it("should filter by openai provider", async () => {
      const stdout = createWritable();
      const stderr = createWritable();
      const client = createTestClient(testModels);

      const env = createEnv({
        argv: ["node", "llmist", "models", "--provider", "openai"],
        stdout: stdout.stream,
        stderr: stderr.stream,
        createClient: () => client,
      });

      await runCLI(env);

      const output = stdout.read();

      // Should show OpenAI models section
      expect(output).toContain("Openai");
      expect(output).toContain("gpt-4o");
      expect(output).toContain("gpt-5-nano");

      // Should NOT show other providers' model sections
      expect(output).not.toContain("Anthropic\n");
      expect(output).not.toContain("Gemini\n");

      // Note: model IDs from other providers will appear in shortcuts section,
      // which is expected behavior
    });

    it("should filter by anthropic provider", async () => {
      const stdout = createWritable();
      const stderr = createWritable();
      const client = createTestClient(testModels);

      const env = createEnv({
        argv: ["node", "llmist", "models", "--provider", "anthropic"],
        stdout: stdout.stream,
        stderr: stderr.stream,
        createClient: () => client,
      });

      await runCLI(env);

      const output = stdout.read();

      // Should show Anthropic models section
      expect(output).toContain("Anthropic");
      expect(output).toContain("claude-sonnet-4-5");
      expect(output).toContain("claude-haiku-4-5");

      // Should NOT show other providers' model sections
      expect(output).not.toContain("Openai\n");
      expect(output).not.toContain("Gemini\n");

      // Note: model IDs from other providers will appear in shortcuts section,
      // which is expected behavior
    });
  });

  describe("JSON output", () => {
    it("should output valid JSON with --format json", async () => {
      const stdout = createWritable();
      const stderr = createWritable();
      const client = createTestClient(testModels);

      const env = createEnv({
        argv: ["node", "llmist", "models", "--format", "json"],
        stdout: stdout.stream,
        stderr: stderr.stream,
        createClient: () => client,
      });

      await runCLI(env);

      const output = stdout.read();

      // Should be valid JSON
      expect(() => JSON.parse(output)).not.toThrow();

      const json = JSON.parse(output);

      // Should have textModels array (renamed from models for multimodal support)
      expect(json.textModels).toBeInstanceOf(Array);
      expect(json.textModels.length).toBe(5);

      // Should have shortcuts object
      expect(json.shortcuts).toBeDefined();
      expect(typeof json.shortcuts).toBe("object");
    });

    it("should include all model fields in JSON output", async () => {
      const stdout = createWritable();
      const stderr = createWritable();
      const client = createTestClient(testModels);

      const env = createEnv({
        argv: ["node", "llmist", "models", "--format", "json"],
        stdout: stdout.stream,
        stderr: stderr.stream,
        createClient: () => client,
      });

      await runCLI(env);

      const json = JSON.parse(stdout.read());
      const firstModel = json.textModels[0];

      // Should have all expected fields
      expect(firstModel).toHaveProperty("provider");
      expect(firstModel).toHaveProperty("modelId");
      expect(firstModel).toHaveProperty("displayName");
      expect(firstModel).toHaveProperty("contextWindow");
      expect(firstModel).toHaveProperty("maxOutputTokens");
      expect(firstModel).toHaveProperty("pricing");
      expect(firstModel).toHaveProperty("features");

      // Pricing should have correct structure
      expect(firstModel.pricing).toHaveProperty("currency");
      expect(firstModel.pricing).toHaveProperty("per");
      expect(firstModel.pricing.currency).toBe("USD");
      expect(firstModel.pricing.per).toBe("1M tokens");
    });

    it("should filter models in JSON output", async () => {
      const stdout = createWritable();
      const stderr = createWritable();
      const client = createTestClient(testModels);

      const env = createEnv({
        argv: ["node", "llmist", "models", "--provider", "openai", "--format", "json"],
        stdout: stdout.stream,
        stderr: stderr.stream,
        createClient: () => client,
      });

      await runCLI(env);

      const json = JSON.parse(stdout.read());

      // All models should be from OpenAI
      expect(json.textModels.every((m: ModelSpec) => m.provider === "openai")).toBe(true);
      expect(json.textModels.length).toBe(2);
    });
  });

  describe("verbose mode", () => {
    it("should show detailed information with --verbose", async () => {
      const stdout = createWritable();
      const stderr = createWritable();
      const client = createTestClient(testModels);

      const env = createEnv({
        argv: ["node", "llmist", "models", "--verbose"],
        stdout: stdout.stream,
        stderr: stderr.stream,
        createClient: () => client,
      });

      await runCLI(env);

      const output = stdout.read();

      // Should show detailed fields
      expect(output).toContain("Context:");
      expect(output).toContain("Max Output:");
      expect(output).toContain("Pricing:");
      expect(output).toContain("Features:");
      expect(output).toContain("Family:");
      expect(output).toContain("Released:");
    });

    it("should show cached input pricing when available", async () => {
      const stdout = createWritable();
      const stderr = createWritable();
      const client = createTestClient(testModels);

      const env = createEnv({
        argv: ["node", "llmist", "models", "--verbose", "--provider", "anthropic"],
        stdout: stdout.stream,
        stderr: stderr.stream,
        createClient: () => client,
      });

      await runCLI(env);

      const output = stdout.read();

      // Claude models have cached input pricing
      expect(output).toContain("Cached Input:");
      expect(output).toContain("$0.30");
      expect(output).toContain("$0.10");
    });
  });

  describe("edge cases", () => {
    it("should handle empty model list", async () => {
      const stdout = createWritable();
      const stderr = createWritable();
      const client = createTestClient([]);

      const env = createEnv({
        argv: ["node", "llmist", "models"],
        stdout: stdout.stream,
        stderr: stderr.stream,
        createClient: () => client,
      });

      await runCLI(env);

      const output = stdout.read();

      // Should show "no models found" message
      expect(output).toContain("No models found");
    });

    it("should handle non-existent provider filter", async () => {
      const stdout = createWritable();
      const stderr = createWritable();
      const client = createTestClient(testModels);

      const env = createEnv({
        argv: ["node", "llmist", "models", "--provider", "nonexistent"],
        stdout: stdout.stream,
        stderr: stderr.stream,
        createClient: () => client,
      });

      await runCLI(env);

      const output = stdout.read();

      // Should show "no models found" message when filtering yields no results
      expect(output).toContain("No models found");
    });
  });

  describe("multimodal filtering", () => {
    // Create test image and speech models
    const testImageModels: ImageModelSpec[] = [
      {
        provider: "openai",
        modelId: "dall-e-3",
        displayName: "DALL-E 3",
        supportedSizes: ["1024x1024", "1792x1024"],
        maxImages: 1,
        pricing: { perImage: 0.04 },
      },
      {
        provider: "gemini",
        modelId: "imagen-4.0-generate-001",
        displayName: "Imagen 4",
        supportedSizes: ["1:1", "16:9"],
        maxImages: 4,
        pricing: { perImage: 0.04 },
      },
    ];

    const testSpeechModels: SpeechModelSpec[] = [
      {
        provider: "openai",
        modelId: "tts-1",
        displayName: "TTS-1",
        voices: ["alloy", "echo", "fable", "nova", "onyx", "shimmer"],
        formats: ["mp3", "opus", "wav"],
        maxInputLength: 4096,
        pricing: { perCharacter: 0.000015 },
      },
      {
        provider: "gemini",
        modelId: "gemini-2.5-flash-tts",
        displayName: "Gemini Flash TTS",
        voices: ["Zephyr", "Puck", "Charon"],
        formats: ["wav"],
        maxInputLength: 8000,
        pricing: { perMinute: 0.01 },
      },
    ];

    function createMultimodalClient(): LLMist {
      const registry = new ModelRegistry();
      registry.registerModels(testModels);

      return {
        modelRegistry: registry,
        image: {
          listModels: () => testImageModels,
        },
        speech: {
          listModels: () => testSpeechModels,
        },
      } as unknown as LLMist;
    }

    it("should show only image models with --image flag", async () => {
      const stdout = createWritable();
      const stderr = createWritable();
      const client = createMultimodalClient();

      const env = createEnv({
        argv: ["node", "llmist", "models", "--image"],
        stdout: stdout.stream,
        stderr: stderr.stream,
        createClient: () => client,
      });

      await runCLI(env);

      const output = stdout.read();

      // Should show image models section
      expect(output).toContain("Image Generation Models");
      expect(output).toContain("dall-e-3");
      expect(output).toContain("imagen-4.0-generate-001");

      // Should NOT show text or speech sections
      expect(output).not.toContain("Text/LLM Models");
      expect(output).not.toContain("Speech (TTS) Models");
    });

    it("should show only speech models with --speech flag", async () => {
      const stdout = createWritable();
      const stderr = createWritable();
      const client = createMultimodalClient();

      const env = createEnv({
        argv: ["node", "llmist", "models", "--speech"],
        stdout: stdout.stream,
        stderr: stderr.stream,
        createClient: () => client,
      });

      await runCLI(env);

      const output = stdout.read();

      // Should show speech models section
      expect(output).toContain("Speech (TTS) Models");
      expect(output).toContain("tts-1");
      expect(output).toContain("gemini-2.5-flash-tts");

      // Should NOT show text or image sections
      expect(output).not.toContain("Text/LLM Models");
      expect(output).not.toContain("Image Generation Models");
    });

    it("should show all model types with --all flag", async () => {
      const stdout = createWritable();
      const stderr = createWritable();
      const client = createMultimodalClient();

      const env = createEnv({
        argv: ["node", "llmist", "models", "--all"],
        stdout: stdout.stream,
        stderr: stderr.stream,
        createClient: () => client,
      });

      await runCLI(env);

      const output = stdout.read();

      // Should show all three sections
      expect(output).toContain("Text/LLM Models");
      expect(output).toContain("Image Generation Models");
      expect(output).toContain("Speech (TTS) Models");

      // Should include models from all types
      expect(output).toContain("gpt-4o");
      expect(output).toContain("dall-e-3");
      expect(output).toContain("tts-1");
    });

    it("should default to text models when no type flag is specified", async () => {
      const stdout = createWritable();
      const stderr = createWritable();
      const client = createMultimodalClient();

      const env = createEnv({
        argv: ["node", "llmist", "models"],
        stdout: stdout.stream,
        stderr: stderr.stream,
        createClient: () => client,
      });

      await runCLI(env);

      const output = stdout.read();

      // Should show text models by default
      expect(output).toContain("Text/LLM Models");
      expect(output).toContain("gpt-4o");

      // Should NOT show image or speech sections
      expect(output).not.toContain("Image Generation Models");
      expect(output).not.toContain("Speech (TTS) Models");
    });

    it("should include imageModels and speechModels in JSON with --all", async () => {
      const stdout = createWritable();
      const stderr = createWritable();
      const client = createMultimodalClient();

      const env = createEnv({
        argv: ["node", "llmist", "models", "--all", "--format", "json"],
        stdout: stdout.stream,
        stderr: stderr.stream,
        createClient: () => client,
      });

      await runCLI(env);

      const json = JSON.parse(stdout.read());

      expect(json.textModels).toBeInstanceOf(Array);
      expect(json.imageModels).toBeInstanceOf(Array);
      expect(json.speechModels).toBeInstanceOf(Array);

      expect(json.textModels.length).toBe(5);
      expect(json.imageModels.length).toBe(2);
      expect(json.speechModels.length).toBe(2);
    });

    it("should filter multimodal models by provider", async () => {
      const stdout = createWritable();
      const stderr = createWritable();
      const client = createMultimodalClient();

      const env = createEnv({
        argv: ["node", "llmist", "models", "--image", "--provider", "openai"],
        stdout: stdout.stream,
        stderr: stderr.stream,
        createClient: () => client,
      });

      await runCLI(env);

      const output = stdout.read();

      // Should show OpenAI image models only
      expect(output).toContain("dall-e-3");
      expect(output).not.toContain("imagen-4.0-generate-001");
    });
  });
});
