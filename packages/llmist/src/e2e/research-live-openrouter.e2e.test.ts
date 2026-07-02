/**
 * LIVE e2e: OpenRouter research (perplexity/sonar-deep-research).
 *
 * 💸 Costs real money (~$0.50–2 per run: $2/$8 per M tokens + $3/M internal
 * reasoning + $5/1k searches). Gated twice — set both to run:
 *
 *   RUN_LIVE_RESEARCH_TESTS=1 OPENROUTER_API_KEY=... \
 *     npx vitest run --config vitest.e2e.config.ts packages/llmist/src/e2e/research-live-openrouter.e2e.test.ts
 *
 * Runs take minutes (long reasoning phase before report text) — the test
 * timeout is set accordingly.
 */

import { describe, expect, it } from "vitest";
import type { ResearchEvent } from "../index.js";
import { LLMist } from "../index.js";

const LIVE = process.env.RUN_LIVE_RESEARCH_TESTS === "1" && !!process.env.OPENROUTER_API_KEY;

/** Wall-clock budget for one sonar-deep-research run. */
const RUN_TIMEOUT_MS = 40 * 60 * 1000;

describe.skipIf(!LIVE)("LIVE research: openrouter/perplexity/sonar-deep-research", () => {
  it(
    "streams reasoning then a cited report over chat completions",
    async () => {
      const client = new LLMist();
      const job = client.research.start({
        model: "openrouter:perplexity/sonar-deep-research",
        query:
          "What were the two or three most significant solid-state battery manufacturing " +
          "announcements in the first half of 2026? Keep the report under 400 words.",
        // Low effort keeps searches/reasoning (and cost) down for the smoke run.
        reasoning: { enabled: true, effort: "low" },
      });

      const counts: Record<string, number> = {};
      const events: ResearchEvent[] = [];
      for await (const event of job) {
        counts[event.type] = (counts[event.type] ?? 0) + 1;
        events.push(event);
      }
      console.log("[live openrouter] event counts:", counts);

      // No job handle on OpenRouter.
      const created = events.find((e) => e.type === "created");
      expect(created).toMatchObject({ type: "created", jobId: null });
      expect(() => job.toRef()).toThrow();

      const result = await job.result();
      console.log("[live openrouter] status:", result.status);
      console.log("[live openrouter] report chars:", result.report.length);
      console.log("[live openrouter] citations:", result.citations.length);
      console.log("[live openrouter] usage:", result.usage);

      expect(result.status).toBe("completed");
      expect(result.report.length).toBeGreaterThan(200);
      expect(result.citations.length).toBeGreaterThan(0);
      expect(result.usage.outputTokens).toBeGreaterThan(0);
      // Reasoning volume depends on effort/query — observed zero thinking
      // deltas on low-effort runs; log rather than assert.
      if ((counts.thinking ?? 0) === 0) {
        console.warn("[live openrouter] no thinking deltas (expected at higher effort)");
      }
      expect(result.usage.costUSD).toBeDefined();
      expect(result.usage.costUSD ?? 0).toBeGreaterThan(0);
      expect(result.usage.costUSD ?? 0).toBeLessThan(5);
    },
    RUN_TIMEOUT_MS,
  );
});
