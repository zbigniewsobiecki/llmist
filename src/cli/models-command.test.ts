import { describe, expect, it } from "bun:test";
import { Readable, Writable } from "node:stream";
import { runCLI } from "./program.js";
import type { CLIEnvironment } from "./environment.js";
import type { LLMist } from "../core/client.js";
import type { ModelSpec } from "../core/model-catalog.js";
import { ModelRegistry } from "../core/model-registry.js";
import { createLogger } from "../logging/logger.js";

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
      expect(output).toContain("Openai Models");
      expect(output).toContain("gpt-4o");
      expect(output).toContain("gpt-5-nano");

      // Should NOT show other providers' model sections
      expect(output).not.toContain("Anthropic Models");
      expect(output).not.toContain("Gemini Models");

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
      expect(output).toContain("Anthropic Models");
      expect(output).toContain("claude-sonnet-4-5");
      expect(output).toContain("claude-haiku-4-5");

      // Should NOT show other providers' model sections
      expect(output).not.toContain("Openai Models");
      expect(output).not.toContain("Gemini Models");

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

      // Should have models array
      expect(json.models).toBeInstanceOf(Array);
      expect(json.models.length).toBe(5);

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
      const firstModel = json.models[0];

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
      expect(json.models.every((m: ModelSpec) => m.provider === "openai")).toBe(true);
      expect(json.models.length).toBe(2);
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

      // Should still show header
      expect(output).toContain("Available Models");

      // Should show shortcuts even with no models
      expect(output).toContain("Model Shortcuts");
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

      // Should show header
      expect(output).toContain("Available Models");

      // Should not show any provider model sections
      expect(output).not.toContain("Openai Models");
      expect(output).not.toContain("Anthropic Models");
      expect(output).not.toContain("Gemini Models");

      // Should still show shortcuts (global shortcuts are always shown)
      expect(output).toContain("Model Shortcuts");

      // Note: model IDs will appear in shortcuts section, which is expected
    });
  });
});
