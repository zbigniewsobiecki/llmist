import { describe, expect, it } from "vitest";
import {
  getOpenAIResearchModelSpec,
  isOpenAIResearchModel,
  openaiResearchModels,
} from "./openai-research-models.js";

describe("openaiResearchModels", () => {
  it("registers o3-deep-research with shutdown metadata and search pricing", () => {
    const spec = getOpenAIResearchModelSpec("o3-deep-research");
    expect(spec).toBeDefined();
    expect(spec?.kind).toBe("model");
    expect(spec?.pricing).toMatchObject({
      input: 10,
      cachedInput: 2.5,
      output: 40,
      perThousandSearches: 10,
    });
    expect(spec?.contextWindow).toBe(200_000);
    expect(spec?.maxOutputTokens).toBe(100_000);
    expect(spec?.metadata).toMatchObject({
      shutdownDate: "2026-07-23",
      replacement: "gpt-5.5-pro",
    });
    expect(spec?.capabilities).toMatchObject({
      streaming: true,
      background: true,
      resumable: true,
    });
    expect(spec?.capabilities.tools).toEqual(
      expect.arrayContaining(["web_search", "file_search", "mcp", "code_interpreter"]),
    );
    expect(spec?.requiredTools).toEqual([{ type: "web_search" }]);
  });

  it("registers the dated snapshots as aliases with identical shape", () => {
    for (const [alias, snapshot] of [
      ["o3-deep-research", "o3-deep-research-2025-06-26"],
      ["o4-mini-deep-research", "o4-mini-deep-research-2025-06-26"],
    ] as const) {
      const aliasSpec = getOpenAIResearchModelSpec(alias);
      const snapshotSpec = getOpenAIResearchModelSpec(snapshot);
      expect(snapshotSpec).toBeDefined();
      expect(snapshotSpec?.pricing).toEqual(aliasSpec?.pricing);
      expect(snapshotSpec?.metadata?.shutdownDate).toBe(aliasSpec?.metadata?.shutdownDate);
    }
  });

  it("registers o4-mini-deep-research at mini pricing", () => {
    const spec = getOpenAIResearchModelSpec("o4-mini-deep-research");
    expect(spec?.pricing).toMatchObject({ input: 2, cachedInput: 0.5, output: 8 });
  });

  it("registers gpt-5.5-pro as the durable poll-only research path", () => {
    const spec = getOpenAIResearchModelSpec("gpt-5.5-pro");
    expect(spec).toBeDefined();
    expect(spec?.pricing).toMatchObject({ input: 30, output: 180, perThousandSearches: 10 });
    expect(spec?.contextWindow).toBe(1_050_000);
    expect(spec?.maxOutputTokens).toBe(128_000);
    expect(spec?.capabilities.streaming).toBe(false);
    expect(spec?.capabilities.background).toBe(true);
    expect(spec?.capabilities.resumable).toBe(true);
    expect(spec?.metadata?.shutdownDate).toBeUndefined();
  });

  it("has unique model ids and consistent provider/kind", () => {
    const ids = openaiResearchModels.map((spec) => spec.modelId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const spec of openaiResearchModels) {
      expect(spec.provider).toBe("openai");
      expect(spec.kind).toBe("model");
    }
  });

  it("isOpenAIResearchModel matches catalog membership", () => {
    expect(isOpenAIResearchModel("o3-deep-research")).toBe(true);
    expect(isOpenAIResearchModel("gpt-5.5-pro")).toBe(true);
    expect(isOpenAIResearchModel("gpt-4o")).toBe(false);
  });
});
