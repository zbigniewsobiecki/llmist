/**
 * Tests for OpenAIChatProvider.countTokens() outer catch fallback path.
 *
 * This file isolates the tiktoken module so both encoding_for_model() calls
 * can be forced to throw, exercising the character-based fallback estimation
 * branch (the outer catch block in countTokens).
 */
import { describe, expect, it, vi } from "vitest";

// Mock tiktoken BEFORE importing the provider so both encoding_for_model paths throw.
vi.mock("tiktoken", () => ({
  encoding_for_model: vi.fn().mockImplementation(() => {
    throw new Error("tiktoken unavailable");
  }),
}));

// Dynamic import after mocking to ensure the module is loaded with the mock in place.
const { OpenAIChatProvider } = await import("./openai.js");

describe("OpenAIChatProvider.countTokens – tiktoken fallback (outer catch)", () => {
  it("falls back to character-based estimation when tiktoken is unavailable", async () => {
    const mockClient = {} as import("openai").default;
    const provider = new OpenAIChatProvider(mockClient);

    // "Hello world" = 11 chars → ceil(11 / 2) = 6 tokens (FALLBACK_CHARS_PER_TOKEN = 2)
    const count = await provider.countTokens([{ role: "user" as const, content: "Hello world" }], {
      provider: "openai",
      name: "gpt-4",
    });

    expect(count).toBe(6);
  });

  it("adds 765 tokens per image in the fallback path", async () => {
    const mockClient = {} as import("openai").default;
    const provider = new OpenAIChatProvider(mockClient);

    // "What?" = 5 chars → ceil(5/2) = 3 text tokens + 765 image tokens = 768
    const count = await provider.countTokens(
      [
        {
          role: "user" as const,
          content: [
            { type: "text" as const, text: "What?" },
            {
              type: "image" as const,
              source: { type: "url" as const, url: "https://example.com/img.png" },
            },
          ],
        },
      ],
      { provider: "openai", name: "gpt-4" },
    );

    expect(count).toBe(768); // ceil(5/2) + 765
  });

  it("handles multiple images correctly in the fallback path", async () => {
    const mockClient = {} as import("openai").default;
    const provider = new OpenAIChatProvider(mockClient);

    // "Hi" = 2 chars → ceil(2/2) = 1 token + 2 * 765 = 1531
    const count = await provider.countTokens(
      [
        {
          role: "user" as const,
          content: [
            { type: "text" as const, text: "Hi" },
            {
              type: "image" as const,
              source: { type: "url" as const, url: "https://example.com/img1.png" },
            },
            {
              type: "image" as const,
              source: {
                type: "base64" as const,
                mediaType: "image/png",
                data: "abc123",
              },
            },
          ],
        },
      ],
      { provider: "openai", name: "gpt-4" },
    );

    expect(count).toBe(1531); // ceil(2/2) + 2*765
  });

  it("returns 0 for empty content in the fallback path", async () => {
    const mockClient = {} as import("openai").default;
    const provider = new OpenAIChatProvider(mockClient);

    const count = await provider.countTokens([{ role: "user" as const, content: "" }], {
      provider: "openai",
      name: "gpt-4",
    });

    expect(count).toBe(0); // ceil(0/2) = 0
  });
});
