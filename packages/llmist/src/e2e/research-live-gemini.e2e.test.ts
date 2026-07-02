/**
 * LIVE e2e: Gemini research via the Interactions API (preview agents).
 *
 * 💸 Costs real money (~$1–3 per run at Gemini 3.1 Pro token rates) and
 * requires a PAID-TIER Gemini API key — free-tier keys are rejected for the
 * deep-research agents.
 *
 *   RUN_LIVE_RESEARCH_TESTS=1 GEMINI_API_KEY=... \
 *     npx vitest run --config vitest.e2e.config.ts packages/llmist/src/e2e/research-live-gemini.e2e.test.ts
 *
 * This test also validates our normalizer against the LIVE preview API —
 * SDK 1.43.0's wire schema differs from some preview docs, so unknown-shape
 * warnings in the event log here matter (see gemini-research.ts).
 */

import { describe, expect, it } from "vitest";
import type { ResearchEvent } from "../index.js";
import { LLMist } from "../index.js";

const LIVE = process.env.RUN_LIVE_RESEARCH_TESTS === "1" && !!process.env.GEMINI_API_KEY;

const AGENT = "gemini:deep-research-preview-04-2026";

/** Interactions enforces a 60-min cap; leave headroom for polling overhead. */
const RUN_TIMEOUT_MS = 65 * 60 * 1000;

describe.skipIf(!LIVE)("LIVE research: gemini (Interactions API)", () => {
  it(
    "runs a background agent with mid-run detach, status poll, and cursor resume",
    async () => {
      const client = new LLMist();
      const detach = new AbortController();
      const job = client.research.start({
        model: AGENT,
        query:
          "What were the two or three most significant solid-state battery manufacturing " +
          "announcements in the first half of 2026? Keep the report under 400 words.",
        signal: detach.signal,
      });

      // Consume a few events (created + early progress), then detach.
      let consumed = 0;
      const preDetach: ResearchEvent[] = [];
      try {
        for await (const event of job) {
          preDetach.push(event);
          consumed += 1;
          if (event.type === "created") {
            console.log("[live gemini] interaction id:", event.jobId);
          }
          if (consumed >= 4) {
            detach.abort();
          }
        }
      } catch (error) {
        if (!(error instanceof Error) || error.name !== "AbortError") throw error;
      }

      const ref = job.toRef();
      console.log("[live gemini] detached at cursor:", ref.cursor);
      expect(ref.jobId.length).toBeGreaterThan(0);

      // While detached: one-shot status poll must work (abort ≠ cancel).
      const snapshot = await client.research.get(ref);
      console.log("[live gemini] status while detached:", snapshot.status);
      expect(["queued", "in_progress", "requires_action", "completed"]).toContain(snapshot.status);

      // Re-attach with the cursor and drain to completion.
      const revived = new LLMist().research.attach(JSON.parse(JSON.stringify(ref)));
      const counts: Record<string, number> = {};
      for await (const event of revived) {
        counts[event.type] = (counts[event.type] ?? 0) + 1;
      }
      console.log("[live gemini] resumed event counts:", counts);

      const result = await revived.result();
      console.log("[live gemini] status:", result.status);
      console.log("[live gemini] report chars:", result.report.length);
      console.log("[live gemini] citations:", result.citations.length);
      console.log("[live gemini] usage:", result.usage);

      expect(result.status).toBe("completed");
      expect(result.report.length).toBeGreaterThan(200);
      // Citations arrive as annotations on text deltas — expected but flagged
      // unverified against the preview API in the spec; log-only if absent.
      if (result.citations.length === 0) {
        console.warn(
          "[live gemini] no citations extracted — check rawEvent annotation shapes " +
            "against gemini-research.ts (preview API drift?)",
        );
      }
      expect(result.usage.totalTokens).toBeGreaterThan(0);
      expect(result.usage.costUSD).toBeDefined();
      expect(result.usage.costUSD ?? 0).toBeLessThan(8);
    },
    RUN_TIMEOUT_MS,
  );
});
