/**
 * LIVE e2e: OpenAI research via the Responses API.
 *
 * 💸 Costs real money. Uses o4-mini-deep-research ($2/$8 per M + $10/1k
 * searches; capped via maxToolCalls — typically well under $1/run) while it
 * exists (upstream shutdown 2026-07-23); afterwards switch MODEL to
 * "openai:gpt-5.5-pro" ($30/$180 — substantially more expensive).
 *
 *   RUN_LIVE_RESEARCH_TESTS=1 OPENAI_API_KEY=... \
 *     npx vitest run --config vitest.e2e.config.ts packages/llmist/src/e2e/research-live-openai.e2e.test.ts
 */

import { describe, expect, it } from "vitest";
import type { ResearchEvent } from "../index.js";
import { LLMist } from "../index.js";

const LIVE = process.env.RUN_LIVE_RESEARCH_TESTS === "1" && !!process.env.OPENAI_API_KEY;

const MODEL = "openai:o4-mini-deep-research";

/** Wall-clock budget for one capped deep-research run. */
const RUN_TIMEOUT_MS = 30 * 60 * 1000;

/** Cap on server-side tool calls — the primary cost control. */
const MAX_TOOL_CALLS = 10;

/** Polling cadence while waiting for the cancel to take effect. */
const CANCEL_POLL_MS = 3_000;
const CANCEL_TIMEOUT_MS = 3 * 60 * 1000;

describe.skipIf(!LIVE)("LIVE research: openai (Responses API)", () => {
  it(
    "runs end-to-end with a mid-run detach + cursor resume",
    async () => {
      const client = new LLMist();
      const detach = new AbortController();
      const job = client.research.start({
        model: MODEL,
        query:
          "What were the two or three most significant solid-state battery manufacturing " +
          "announcements in the first half of 2026? Keep the report under 400 words.",
        maxToolCalls: MAX_TOOL_CALLS,
        signal: detach.signal,
      });

      // Consume a handful of events, then detach mid-run (transport only).
      let consumed = 0;
      try {
        for await (const event of job) {
          consumed += 1;
          if (event.type === "created") {
            console.log("[live openai] job id:", event.jobId);
          }
          if (consumed >= 5) {
            detach.abort();
          }
        }
      } catch (error) {
        // Expected: the detach abort surfaces as an abort error.
        if (!(error instanceof Error) || error.name !== "AbortError") throw error;
      }

      const ref = job.toRef();
      console.log("[live openai] detached at cursor:", ref.cursor);
      expect(ref.jobId).toMatch(/^resp_/);

      // Re-attach (fresh client — simulates a process restart) and drain.
      const client2 = new LLMist();
      const revived = client2.research.attach(JSON.parse(JSON.stringify(ref)));
      const counts: Record<string, number> = {};
      for await (const event of revived) {
        counts[event.type] = (counts[event.type] ?? 0) + 1;
      }
      console.log("[live openai] resumed event counts:", counts);

      const result = await revived.result();
      console.log("[live openai] status:", result.status);
      console.log("[live openai] report chars:", result.report.length);
      console.log("[live openai] citations:", result.citations.length);
      console.log("[live openai] usage:", result.usage);

      // maxToolCalls can end the run as "incomplete" — both are acceptable here;
      // what we're verifying is the lifecycle, report, and citations plumbing.
      expect(["completed", "incomplete"]).toContain(result.status);
      expect(result.report.length).toBeGreaterThan(100);
      expect(result.citations.length).toBeGreaterThan(0);
      expect(result.usage.costUSD).toBeDefined();
      expect(result.usage.costUSD ?? 0).toBeLessThan(5);
    },
    RUN_TIMEOUT_MS,
  );

  it(
    "cancels a background job server-side (bills ~nothing)",
    async () => {
      const client = new LLMist();
      const detach = new AbortController();
      const job = client.research.start({
        model: MODEL,
        query: "Placeholder research run for cancellation testing.",
        maxToolCalls: MAX_TOOL_CALLS,
        signal: detach.signal,
      });

      // Wait for the job id, then detach the stream.
      try {
        for await (const event of job) {
          if (event.type === "created") {
            detach.abort();
          }
        }
      } catch (error) {
        if (!(error instanceof Error) || error.name !== "AbortError") throw error;
      }
      const ref = job.toRef();

      await client.research.cancel(ref);

      // Poll until the cancellation is reflected.
      const deadline = Date.now() + CANCEL_TIMEOUT_MS;
      let status = "";
      while (Date.now() < deadline) {
        const snapshot = await client.research.get(ref);
        status = snapshot.status;
        if (status === "cancelled" || status === "completed" || status === "failed") break;
        await new Promise((resolve) => setTimeout(resolve, CANCEL_POLL_MS));
      }
      console.log("[live openai] post-cancel status:", status);
      expect(status).toBe("cancelled");
    },
    CANCEL_TIMEOUT_MS + 60_000,
  );
});
