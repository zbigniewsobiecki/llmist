import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { discoverProviderAdapters } from "./discovery.js";

const ORIGINAL_ENV = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  HF_TOKEN: process.env.HF_TOKEN,
  HUGGING_FACE_API_KEY: process.env.HUGGING_FACE_API_KEY,
};

function clearKeys() {
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.HF_TOKEN;
  delete process.env.HUGGING_FACE_API_KEY;
}

describe("discoverProviderAdapters", () => {
  beforeEach(() => {
    clearKeys();
  });

  afterEach(() => {
    if (ORIGINAL_ENV.OPENAI_API_KEY !== undefined) {
      process.env.OPENAI_API_KEY = ORIGINAL_ENV.OPENAI_API_KEY;
    } else {
      delete process.env.OPENAI_API_KEY;
    }

    if (ORIGINAL_ENV.ANTHROPIC_API_KEY !== undefined) {
      process.env.ANTHROPIC_API_KEY = ORIGINAL_ENV.ANTHROPIC_API_KEY;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }

    if (ORIGINAL_ENV.GEMINI_API_KEY !== undefined) {
      process.env.GEMINI_API_KEY = ORIGINAL_ENV.GEMINI_API_KEY;
    } else {
      delete process.env.GEMINI_API_KEY;
    }

    if (ORIGINAL_ENV.HF_TOKEN !== undefined) {
      process.env.HF_TOKEN = ORIGINAL_ENV.HF_TOKEN;
    } else {
      delete process.env.HF_TOKEN;
    }

    if (ORIGINAL_ENV.HUGGING_FACE_API_KEY !== undefined) {
      process.env.HUGGING_FACE_API_KEY = ORIGINAL_ENV.HUGGING_FACE_API_KEY;
    } else {
      delete process.env.HUGGING_FACE_API_KEY;
    }
  });

  it("returns empty array when no keys are present", () => {
    const adapters = discoverProviderAdapters();
    expect(adapters).toHaveLength(0);
  });

  it("discovers openai provider when key is present", () => {
    process.env.OPENAI_API_KEY = "test-key";
    const adapters = discoverProviderAdapters();
    expect(adapters.some((adapter) => adapter.providerId === "openai")).toBe(true);
  });

  it("discovers multiple providers when multiple keys are present", () => {
    process.env.OPENAI_API_KEY = "test-openai";
    process.env.ANTHROPIC_API_KEY = "test-anthropic";
    process.env.GEMINI_API_KEY = "test-gemini";

    const adapters = discoverProviderAdapters();
    const providerIds = adapters.map((adapter) => adapter.providerId);

    expect(providerIds).toContain("openai");
    expect(providerIds).toContain("anthropic");
    expect(providerIds).toContain("gemini");
  });
});
