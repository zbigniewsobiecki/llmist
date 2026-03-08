import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProviderFromEnv, isNonEmpty, readEnvVar } from "./utils.js";

describe("readEnvVar", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the value when the environment variable exists", () => {
    vi.stubEnv("TEST_API_KEY", "my-secret-key");
    expect(readEnvVar("TEST_API_KEY")).toBe("my-secret-key");
  });

  it("returns undefined when the environment variable is not set", () => {
    // Make sure the key doesn't exist
    vi.stubEnv("MISSING_VAR_XYZ", undefined as unknown as string);
    delete process.env.MISSING_VAR_XYZ;
    expect(readEnvVar("MISSING_VAR_XYZ")).toBeUndefined();
  });

  it("returns an empty string when the variable is set to empty", () => {
    vi.stubEnv("EMPTY_VAR", "");
    expect(readEnvVar("EMPTY_VAR")).toBe("");
  });

  it("returns undefined when process is unavailable", () => {
    // Temporarily override process to simulate a non-Node environment
    const originalProcess = global.process;
    // @ts-expect-error - intentionally setting process to undefined for testing
    global.process = undefined;
    expect(readEnvVar("ANY_KEY")).toBeUndefined();
    global.process = originalProcess;
  });
});

describe("isNonEmpty", () => {
  it("returns true for a non-empty string", () => {
    expect(isNonEmpty("hello")).toBe(true);
  });

  it("returns true for a string with only non-whitespace characters", () => {
    expect(isNonEmpty("sk-abc123")).toBe(true);
  });

  it("returns false for an empty string", () => {
    expect(isNonEmpty("")).toBe(false);
  });

  it("returns false for a string containing only whitespace", () => {
    expect(isNonEmpty("   ")).toBe(false);
  });

  it("returns false for a string containing only tabs and newlines", () => {
    expect(isNonEmpty("\t\n")).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isNonEmpty(undefined)).toBe(false);
  });

  it("returns true for a string with leading/trailing whitespace but non-empty content", () => {
    expect(isNonEmpty("  hello  ")).toBe(true);
  });
});

describe("createProviderFromEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns a provider instance when the API key is present", () => {
    vi.stubEnv("MY_API_KEY", "valid-api-key");

    const mockClient = {};
    const mockProvider = { name: "mock-provider" };

    const MockClient = vi.fn().mockReturnValue(mockClient);
    const MockProvider = vi.fn().mockReturnValue(mockProvider);

    const result = createProviderFromEnv("MY_API_KEY", MockClient, MockProvider);

    expect(result).toBe(mockProvider);
    expect(MockClient).toHaveBeenCalledWith({
      apiKey: "valid-api-key",
      maxRetries: 0,
    });
    expect(MockProvider).toHaveBeenCalledWith(mockClient);
  });

  it("returns null when the API key is not set", () => {
    delete process.env.NONEXISTENT_KEY_XYZ;

    const MockClient = vi.fn();
    const MockProvider = vi.fn();

    const result = createProviderFromEnv("NONEXISTENT_KEY_XYZ", MockClient, MockProvider);

    expect(result).toBeNull();
    expect(MockClient).not.toHaveBeenCalled();
    expect(MockProvider).not.toHaveBeenCalled();
  });

  it("returns null when the API key is an empty string", () => {
    vi.stubEnv("EMPTY_KEY", "");

    const MockClient = vi.fn();
    const MockProvider = vi.fn();

    const result = createProviderFromEnv("EMPTY_KEY", MockClient, MockProvider);

    expect(result).toBeNull();
    expect(MockClient).not.toHaveBeenCalled();
  });

  it("returns null when the API key is only whitespace", () => {
    vi.stubEnv("WHITESPACE_KEY", "   ");

    const MockClient = vi.fn();
    const MockProvider = vi.fn();

    const result = createProviderFromEnv("WHITESPACE_KEY", MockClient, MockProvider);

    expect(result).toBeNull();
    expect(MockClient).not.toHaveBeenCalled();
  });

  it("trims whitespace from the API key before passing to the client", () => {
    vi.stubEnv("PADDED_KEY", "  trimmed-key  ");

    const MockClient = vi.fn().mockReturnValue({});
    const MockProvider = vi.fn().mockReturnValue({});

    createProviderFromEnv("PADDED_KEY", MockClient, MockProvider);

    expect(MockClient).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "trimmed-key" }));
  });

  it("passes additional clientOptions to the client constructor", () => {
    vi.stubEnv("EXTRA_OPTS_KEY", "api-key");

    const MockClient = vi.fn().mockReturnValue({});
    const MockProvider = vi.fn().mockReturnValue({});

    const clientOptions = { baseURL: "https://custom.api.com", timeout: 5000 };
    createProviderFromEnv("EXTRA_OPTS_KEY", MockClient, MockProvider, clientOptions);

    expect(MockClient).toHaveBeenCalledWith({
      apiKey: "api-key",
      maxRetries: 0,
      baseURL: "https://custom.api.com",
      timeout: 5000,
    });
  });

  it("sets maxRetries to 0 by default (clientOptions can override)", () => {
    vi.stubEnv("RETRY_KEY", "api-key");

    const MockClient = vi.fn().mockReturnValue({});
    const MockProvider = vi.fn().mockReturnValue({});

    // When no clientOptions are provided, maxRetries defaults to 0
    createProviderFromEnv("RETRY_KEY", MockClient, MockProvider);

    expect(MockClient).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0 }));
  });
});
