import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CompactionConfig,
  DEFAULT_COMPACTION_CONFIG,
  DEFAULT_SUMMARIZATION_PROMPT,
  resolveCompactionConfig,
} from "./config.js";

describe("CompactionConfig", () => {
  describe("DEFAULT_COMPACTION_CONFIG", () => {
    it("should have enabled=true by default", () => {
      expect(DEFAULT_COMPACTION_CONFIG.enabled).toBe(true);
    });

    it("should use hybrid strategy by default", () => {
      expect(DEFAULT_COMPACTION_CONFIG.strategy).toBe("hybrid");
    });

    it("should set triggerThresholdPercent to 80", () => {
      expect(DEFAULT_COMPACTION_CONFIG.triggerThresholdPercent).toBe(80);
    });

    it("should set targetPercent to 50", () => {
      expect(DEFAULT_COMPACTION_CONFIG.targetPercent).toBe(50);
    });

    it("should preserve 5 recent turns by default", () => {
      expect(DEFAULT_COMPACTION_CONFIG.preserveRecentTurns).toBe(5);
    });
  });

  describe("DEFAULT_SUMMARIZATION_PROMPT", () => {
    it("should contain key guidance items", () => {
      expect(DEFAULT_SUMMARIZATION_PROMPT).toContain("Key decisions");
      expect(DEFAULT_SUMMARIZATION_PROMPT).toContain("Important facts");
      expect(DEFAULT_SUMMARIZATION_PROMPT).toContain("Errors encountered");
      expect(DEFAULT_SUMMARIZATION_PROMPT).toContain("Current task context");
    });
  });

  describe("resolveCompactionConfig", () => {
    const originalWarn = console.warn;
    let warnMock: ReturnType<typeof mock>;

    afterEach(() => {
      console.warn = originalWarn;
    });

    it("should use defaults when no config provided", () => {
      const resolved = resolveCompactionConfig();

      expect(resolved.enabled).toBe(true);
      expect(resolved.strategy).toBe("hybrid");
      expect(resolved.triggerThresholdPercent).toBe(80);
      expect(resolved.targetPercent).toBe(50);
      expect(resolved.preserveRecentTurns).toBe(5);
      expect(resolved.summarizationPrompt).toBe(DEFAULT_SUMMARIZATION_PROMPT);
      expect(resolved.summarizationModel).toBeUndefined();
      expect(resolved.onCompaction).toBeUndefined();
    });

    it("should use defaults when empty config provided", () => {
      const resolved = resolveCompactionConfig({});

      expect(resolved.enabled).toBe(true);
      expect(resolved.strategy).toBe("hybrid");
    });

    it("should merge partial config with defaults", () => {
      const config: CompactionConfig = {
        triggerThresholdPercent: 70,
        preserveRecentTurns: 10,
      };

      const resolved = resolveCompactionConfig(config);

      expect(resolved.triggerThresholdPercent).toBe(70);
      expect(resolved.preserveRecentTurns).toBe(10);
      // Defaults should still apply
      expect(resolved.enabled).toBe(true);
      expect(resolved.strategy).toBe("hybrid");
      expect(resolved.targetPercent).toBe(50);
    });

    it("should allow disabling compaction", () => {
      const resolved = resolveCompactionConfig({ enabled: false });
      expect(resolved.enabled).toBe(false);
    });

    it("should allow different strategies", () => {
      expect(resolveCompactionConfig({ strategy: "sliding-window" }).strategy).toBe(
        "sliding-window",
      );
      expect(resolveCompactionConfig({ strategy: "summarization" }).strategy).toBe("summarization");
      expect(resolveCompactionConfig({ strategy: "hybrid" }).strategy).toBe("hybrid");
    });

    it("should handle custom strategy instances", () => {
      const customStrategy = {
        name: "custom" as const,
        compact: async () => ({
          messages: [],
          strategyName: "custom",
          metadata: { originalCount: 0, compactedCount: 0, tokensBefore: 0, tokensAfter: 0 },
        }),
      };

      // Type assertion needed because custom strategy name isn't in the union
      const resolved = resolveCompactionConfig({
        strategy: customStrategy as CompactionConfig["strategy"],
      });

      // The resolved strategy name should be extracted from the custom strategy
      expect(resolved.strategy).toBe("custom");
    });

    it("should preserve summarizationModel when specified", () => {
      const resolved = resolveCompactionConfig({
        summarizationModel: "gpt-4o-mini",
      });

      expect(resolved.summarizationModel).toBe("gpt-4o-mini");
    });

    it("should allow custom summarizationPrompt", () => {
      const customPrompt = "Please summarize this conversation briefly.";
      const resolved = resolveCompactionConfig({
        summarizationPrompt: customPrompt,
      });

      expect(resolved.summarizationPrompt).toBe(customPrompt);
    });

    it("should preserve onCompaction callback", () => {
      const callback = () => {};
      const resolved = resolveCompactionConfig({
        onCompaction: callback,
      });

      expect(resolved.onCompaction).toBe(callback);
    });

    it("should warn when targetPercent >= triggerThresholdPercent", () => {
      warnMock = vi.fn(() => {});
      console.warn = warnMock;

      resolveCompactionConfig({
        triggerThresholdPercent: 50,
        targetPercent: 60,
      });

      expect(warnMock).toHaveBeenCalled();
      const message = warnMock.mock.calls[0][0] as string;
      expect(message).toContain("targetPercent");
      expect(message).toContain("triggerThresholdPercent");
    });

    it("should warn when targetPercent equals triggerThresholdPercent", () => {
      warnMock = vi.fn(() => {});
      console.warn = warnMock;

      resolveCompactionConfig({
        triggerThresholdPercent: 70,
        targetPercent: 70,
      });

      expect(warnMock).toHaveBeenCalled();
    });

    it("should not warn when targetPercent < triggerThresholdPercent", () => {
      warnMock = vi.fn(() => {});
      console.warn = warnMock;

      resolveCompactionConfig({
        triggerThresholdPercent: 80,
        targetPercent: 50,
      });

      expect(warnMock).not.toHaveBeenCalled();
    });
  });
});
