import { describe, expect, it, mock } from "bun:test";
import type { GoogleGenAI } from "@google/genai";

import { GeminiGenerativeProvider } from "./gemini.js";

describe("GeminiGenerativeProvider", () => {
  const createClient = () => {
    const stream = (async function* () {})();
    const generateContentStream = mock().mockResolvedValue(stream);
    const models = { generateContentStream };
    const client = { models } as unknown as GoogleGenAI;

    return { client, generateContentStream };
  };

  it("maps messages with system instructions and role conversion", async () => {
    const { client, generateContentStream } = createClient();
    const provider = new GeminiGenerativeProvider(client);

    const options = {
      model: "gemini-1.5-flash",
      messages: [
        { role: "system" as const, content: "Primary instruction" },
        { role: "system" as const, content: "Gadget instructions" },
        { role: "user" as const, content: "Initial request" },
        { role: "assistant" as const, content: "Previous answer" },
        { role: "system" as const, content: "Follow-up system note" },
        { role: "user" as const, content: "Latest question" },
      ],
      maxTokens: 256,
      temperature: 0.4,
      topP: 0.8,
      stopSequences: ["STOP"],
      extra: { safetySettings: [{ category: "some-category", threshold: "block-none" }] },
    };

    const descriptor = { provider: "gemini", name: "gemini-1.5-flash" } as const;
    const stream = provider.stream(options, descriptor);
    await stream.next();

    expect(generateContentStream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-1.5-flash",
        contents: [
          { role: "user", parts: [{ text: "Initial request" }] },
          { role: "model", parts: [{ text: "Previous answer" }] },
          {
            role: "user",
            parts: [{ text: "Follow-up system note" }, { text: "Latest question" }],
          },
        ],
        config: expect.objectContaining({
          systemInstruction: "Primary instruction\nGadget instructions",
          maxOutputTokens: 256,
          temperature: 0.4,
          topP: 0.8,
          stopSequences: ["STOP"],
          safetySettings: [{ category: "some-category", threshold: "block-none" }],
        }),
      }),
    );
  });

  it("omits system instruction when no system messages exist", async () => {
    const { client, generateContentStream } = createClient();
    const provider = new GeminiGenerativeProvider(client);

    const options = {
      model: "gemini-1.5-pro",
      messages: [
        { role: "user" as const, content: "Hello" },
        { role: "assistant" as const, content: "Hi there" },
      ],
    };

    const stream = provider.stream(options, { provider: "gemini", name: "gemini-1.5-pro" });
    await stream.next();

    expect(generateContentStream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-1.5-pro",
        contents: [
          { role: "user", parts: [{ text: "Hello" }] },
          { role: "model", parts: [{ text: "Hi there" }] },
        ],
      }),
    );
  });

  it("uses the first system block even when it appears after other roles", async () => {
    const { client, generateContentStream } = createClient();
    const provider = new GeminiGenerativeProvider(client);

    const options = {
      model: "gemini-1.5-pro",
      messages: [
        { role: "user" as const, content: "Earlier user message" },
        { role: "assistant" as const, content: "Earlier assistant message" },
        { role: "system" as const, content: "Inline instruction" },
        { role: "system" as const, content: "Additional inline instruction" },
        { role: "assistant" as const, content: "Later assistant response" },
      ],
    };

    const stream = provider.stream(options, { provider: "gemini", name: "gemini-1.5-pro" });
    await stream.next();

    expect(generateContentStream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-1.5-pro",
        contents: [
          { role: "user", parts: [{ text: "Earlier user message" }] },
          {
            role: "model",
            parts: [{ text: "Earlier assistant message" }, { text: "Later assistant response" }],
          },
        ],
        config: expect.objectContaining({
          systemInstruction: "Inline instruction\nAdditional inline instruction",
        }),
      }),
    );
  });

  it("merges consecutive assistant messages in initialMessages pattern", async () => {
    const { client, generateContentStream } = createClient();
    const provider = new GeminiGenerativeProvider(client);

    const options = {
      model: "gemini-1.5-pro",
      messages: [
        {
          role: "user" as const,
          content: "Here is my recent activity history in this workspace for your context:",
        },
        { role: "assistant" as const, content: "I see that 1 minute ago - Started agent session" },
        {
          role: "assistant" as const,
          content: "I see that just now - Created section at esp32-chip-variants",
        },
        { role: "assistant" as const, content: "I see that just now - Agent called CreateSection" },
        {
          role: "assistant" as const,
          content: "I see that just now - Created section at esp32-chip-variants.classic-esp32",
        },
        { role: "assistant" as const, content: "I see that just now - Agent called CreateSection" },
        {
          role: "assistant" as const,
          content: "I see that just now - Created section at esp32-chip-variants.esp32-s2",
        },
      ],
    };

    const stream = provider.stream(options, { provider: "gemini", name: "gemini-1.5-pro" });
    await stream.next();

    expect(generateContentStream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-1.5-pro",
        contents: [
          {
            role: "user",
            parts: [
              { text: "Here is my recent activity history in this workspace for your context:" },
            ],
          },
          {
            role: "model",
            parts: [
              { text: "I see that 1 minute ago - Started agent session" },
              { text: "I see that just now - Created section at esp32-chip-variants" },
              { text: "I see that just now - Agent called CreateSection" },
              {
                text: "I see that just now - Created section at esp32-chip-variants.classic-esp32",
              },
              { text: "I see that just now - Agent called CreateSection" },
              { text: "I see that just now - Created section at esp32-chip-variants.esp32-s2" },
            ],
          },
        ],
      }),
    );
  });

  describe("countTokens", () => {
    it("counts tokens for simple messages", async () => {
      const mockCountTokens = mock().mockResolvedValue({
        totalTokens: 15,
      });

      const mockClient = {
        models: {
          countTokens: mockCountTokens,
        },
      } as unknown as GoogleGenAI;

      const provider = new GeminiGenerativeProvider(mockClient);

      const count = await provider.countTokens(
        [{ role: "user" as const, content: "Hello world" }],
        { provider: "gemini", name: "gemini-1.5-pro" },
      );

      expect(count).toBe(15);
      expect(mockCountTokens).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "gemini-1.5-pro",
          contents: [{ role: "user", parts: [{ text: "Hello world" }] }],
        }),
      );
    });

    it("includes system instruction in token count", async () => {
      const mockCountTokens = mock().mockResolvedValue({
        totalTokens: 25,
      });

      const mockClient = {
        models: {
          countTokens: mockCountTokens,
        },
      } as unknown as GoogleGenAI;

      const provider = new GeminiGenerativeProvider(mockClient);

      await provider.countTokens(
        [
          { role: "system" as const, content: "You are helpful" },
          { role: "user" as const, content: "Hello" },
        ],
        { provider: "gemini", name: "gemini-1.5-pro" },
      );

      expect(mockCountTokens).toHaveBeenCalledWith(
        expect.objectContaining({
          systemInstruction: "You are helpful",
        }),
      );
    });

    it("merges consecutive messages of same role", async () => {
      const mockCountTokens = mock().mockResolvedValue({
        totalTokens: 30,
      });

      const mockClient = {
        models: {
          countTokens: mockCountTokens,
        },
      } as unknown as GoogleGenAI;

      const provider = new GeminiGenerativeProvider(mockClient);

      await provider.countTokens(
        [
          { role: "user" as const, content: "First" },
          { role: "assistant" as const, content: "Response 1" },
          { role: "assistant" as const, content: "Response 2" },
        ],
        { provider: "gemini", name: "gemini-1.5-pro" },
      );

      expect(mockCountTokens).toHaveBeenCalledWith(
        expect.objectContaining({
          contents: [
            { role: "user", parts: [{ text: "First" }] },
            { role: "model", parts: [{ text: "Response 1" }, { text: "Response 2" }] },
          ],
        }),
      );
    });

    it("uses fallback estimation when API fails", async () => {
      const mockCountTokens = mock().mockRejectedValue(new Error("API error"));

      const mockClient = {
        models: {
          countTokens: mockCountTokens,
        },
      } as unknown as GoogleGenAI;

      const provider = new GeminiGenerativeProvider(mockClient);

      const count = await provider.countTokens(
        [{ role: "user" as const, content: "Hello world" }], // "Hello world" = 11 chars
        { provider: "gemini", name: "gemini-1.5-pro" },
      );

      // Fallback: 11 chars / 4 = 2.75, ceil = 3
      expect(count).toBe(3);
    });

    it("handles empty content with defensive checks", async () => {
      const mockCountTokens = mock().mockResolvedValue({
        totalTokens: 5,
      });

      const mockClient = {
        models: {
          countTokens: mockCountTokens,
        },
      } as unknown as GoogleGenAI;

      const provider = new GeminiGenerativeProvider(mockClient);

      const count = await provider.countTokens([{ role: "user" as const, content: "" }], {
        provider: "gemini",
        name: "gemini-1.5-pro",
      });

      expect(count).toBeGreaterThanOrEqual(0);
    });

    it("handles system messages at different positions", async () => {
      const mockCountTokens = mock().mockResolvedValue({
        totalTokens: 40,
      });

      const mockClient = {
        models: {
          countTokens: mockCountTokens,
        },
      } as unknown as GoogleGenAI;

      const provider = new GeminiGenerativeProvider(mockClient);

      await provider.countTokens(
        [
          { role: "user" as const, content: "First user message" },
          { role: "system" as const, content: "System instruction" },
          { role: "assistant" as const, content: "Response" },
        ],
        { provider: "gemini", name: "gemini-1.5-pro" },
      );

      // System message should be extracted regardless of position
      expect(mockCountTokens).toHaveBeenCalledWith(
        expect.objectContaining({
          systemInstruction: "System instruction",
        }),
      );
    });

    it("returns zero when totalTokens is undefined", async () => {
      const mockCountTokens = mock().mockResolvedValue({
        totalTokens: undefined,
      });

      const mockClient = {
        models: {
          countTokens: mockCountTokens,
        },
      } as unknown as GoogleGenAI;

      const provider = new GeminiGenerativeProvider(mockClient);

      const count = await provider.countTokens([{ role: "user" as const, content: "Hello" }], {
        provider: "gemini",
        name: "gemini-1.5-pro",
      });

      expect(count).toBe(0);
    });
  });
});
