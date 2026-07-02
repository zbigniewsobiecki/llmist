import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GoogleGenAI, Interactions } from "@google/genai";
import { describe, expect, it, vi } from "vitest";
import { ResearchValidationError } from "../research/errors.js";
import type { ResearchEvent, ResearchOptions } from "../research/types.js";
import {
  buildGeminiResearchRequest,
  getGeminiResearchStatus,
  mapInteractionStatus,
  normalizeInteractionsStream,
  resumeGeminiResearch,
  startGeminiResearch,
} from "./gemini-research.js";
import { geminiResearchModels, getGeminiResearchModelSpec } from "./gemini-research-models.js";

type InteractionSSEEvent = Interactions.InteractionSSEEvent;

const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "__fixtures__/gemini-interactions-research.json",
);
const FIXTURE: InteractionSSEEvent[] = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8"));

const AGENT = "deep-research-preview-04-2026";
const SPEC = getGeminiResearchModelSpec(AGENT);

const BASE_OPTIONS: ResearchOptions = {
  model: `gemini:${AGENT}`,
  query: "State of solid-state batteries",
};

async function* replay(events: InteractionSSEEvent[]): AsyncGenerator<InteractionSSEEvent> {
  for (const event of events) {
    yield event;
  }
}

async function drain(iterable: AsyncIterable<ResearchEvent>): Promise<ResearchEvent[]> {
  const events: ResearchEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

function clientWith(interactions: Partial<Interactions>): GoogleGenAI {
  return { interactions } as unknown as GoogleGenAI;
}

describe("gemini research catalog", () => {
  it("registers the three preview agents as kind=agent with the 60-min cap", () => {
    expect(geminiResearchModels.map((s) => s.modelId)).toEqual([
      "deep-research-preview-04-2026",
      "deep-research-max-preview-04-2026",
      "deep-research-pro-preview-12-2025",
    ]);
    for (const spec of geminiResearchModels) {
      expect(spec.kind).toBe("agent");
      expect(spec.contextWindow).toBeUndefined();
      expect(spec.maxDurationMs).toBe(3_600_000);
      expect(spec.capabilities).toMatchObject({
        streaming: true,
        background: true,
        resumable: true,
        followUps: true,
        tools: [],
      });
      expect(spec.pricing.perThousandSearches).toBe(14);
    }
  });
});

describe("buildGeminiResearchRequest", () => {
  it("builds the mandatory-background snake_case request", () => {
    const request = buildGeminiResearchRequest(BASE_OPTIONS, AGENT);
    expect(request).toEqual({
      agent: AGENT,
      input: "State of solid-state batteries",
      background: true,
      store: true,
      agent_config: { type: "deep-research", thinking_summaries: "auto" },
    });
  });

  it("rejects background: false (mandatory for deep research)", () => {
    expect(() => buildGeminiResearchRequest({ ...BASE_OPTIONS, background: false }, AGENT)).toThrow(
      ResearchValidationError,
    );
  });

  it("maps systemPrompt, previousJobId, and thinking opt-out", () => {
    const request = buildGeminiResearchRequest(
      {
        ...BASE_OPTIONS,
        systemPrompt: "Cite primary sources.",
        previousJobId: "int_prior",
        reasoning: { enabled: true, includeThinking: false },
      },
      AGENT,
    );
    expect(request.system_instruction).toBe("Cite primary sources.");
    expect(request.previous_interaction_id).toBe("int_prior");
    expect(request.agent_config.thinking_summaries).toBe("none");
  });

  it("merges extra last (e.g. collaborative planning passthrough)", () => {
    const request = buildGeminiResearchRequest(
      {
        ...BASE_OPTIONS,
        extra: { agent_config: { type: "deep-research", collaborative_planning: true } },
      },
      AGENT,
    );
    expect(request.agent_config).toEqual({ type: "deep-research", collaborative_planning: true });
  });
});

describe("mapInteractionStatus", () => {
  it("maps known statuses 1:1 incl. budget_exceeded and requires_action", () => {
    expect(mapInteractionStatus("completed")).toBe("completed");
    expect(mapInteractionStatus("requires_action")).toBe("requires_action");
    expect(mapInteractionStatus("budget_exceeded")).toBe("budget_exceeded");
  });

  it("falls back to in_progress for unknown statuses", () => {
    expect(mapInteractionStatus("some_new_status")).toBe("in_progress");
    expect(mapInteractionStatus(undefined)).toBe("in_progress");
  });
});

describe("normalizeInteractionsStream", () => {
  it("normalizes the full fixture happy path", async () => {
    const events = await drain(normalizeInteractionsStream(replay(FIXTURE)));
    const types = events.map((e) => e.type);

    expect(types).toEqual([
      "created", // interaction.start
      "status",
      "phase", // thought content.start → reasoning
      "thinking", // thought_summary delta
      // thought_signature ignored
      "phase", // google_search_call content.start → searching
      "search", // call delta → started
      "search", // result delta → completed
      "status", // status_update
      "phase", // text content.start → writing
      "text",
      "text",
      "citation", // annotation on second text delta
      "usage",
      "done",
    ]);

    expect(events[0]).toMatchObject({ type: "created", jobId: "int_abc", cursor: "ev-0" });

    const thinking = events.find((e) => e.type === "thinking");
    if (thinking?.type === "thinking") {
      expect(thinking.delta).toBe("Planning research strategy...");
    }

    const searchStarted = events.find((e) => e.type === "search");
    if (searchStarted?.type === "search") {
      expect(searchStarted.query).toBe("solid state battery 2026");
      expect(searchStarted.status).toBe("started");
    }

    const citation = events.find((e) => e.type === "citation");
    if (citation?.type === "citation") {
      expect(citation.citation).toEqual({
        url: "https://example.com/ssb",
        startIndex: 0,
        endIndex: 45,
      });
    }

    const usage = events.find((e) => e.type === "usage");
    if (usage?.type === "usage") {
      expect(usage.usage).toMatchObject({
        inputTokens: 250_000,
        outputTokens: 60_000,
        totalTokens: 310_000,
        reasoningTokens: 40_000,
        cachedInputTokens: 12_000,
        // Tallied from the single google_search_result delta — drives per-search pricing.
        searches: 1,
      });
    }

    // Report accumulated from text deltas (interaction.complete has empty outputs);
    // the job collector joins them — done.report itself is empty here.
    const done = events.at(-1);
    if (done?.type === "done") {
      expect(done.result.status).toBe("completed");
      expect(done.result.report).toBe("");
      expect(done.result.usage?.searches).toBe(1);
    }

    for (const event of events) {
      expect(event.cursor).toMatch(/^ev-/);
    }
  });

  it("handles the docs' 'thought' delta shape defensively", async () => {
    const events = await drain(
      normalizeInteractionsStream(
        replay([
          {
            event_type: "content.delta",
            event_id: "ev-x",
            index: 0,
            delta: { type: "thought", content: { type: "text", text: "alt shape" } },
          } as unknown as InteractionSSEEvent,
        ]),
      ),
    );
    expect(events).toEqual([expect.objectContaining({ type: "thinking", delta: "alt shape" })]);
  });

  it("handles both 'error' and 'interaction.error' event shapes", async () => {
    const events = await drain(
      normalizeInteractionsStream(
        replay([
          {
            event_type: "error",
            event_id: "ev-e1",
            error: { message: "quota exhausted" },
          } as unknown as InteractionSSEEvent,
          {
            event_type: "interaction.error",
            event_id: "ev-e2",
            error: { message: "alt error shape" },
          } as unknown as InteractionSSEEvent,
        ]),
      ),
    );
    expect(events.map((e) => e.type)).toEqual(["error", "error"]);
    if (events[1]?.type === "error") {
      expect(events[1].error.message).toBe("alt error shape");
    }
  });

  it("maps budget_exceeded status updates", async () => {
    const events = await drain(
      normalizeInteractionsStream(
        replay([
          {
            event_type: "interaction.status_update",
            event_id: "ev-b",
            interaction_id: "int_abc",
            status: "budget_exceeded",
          } as unknown as InteractionSSEEvent,
        ]),
      ),
    );
    expect(events[0]).toMatchObject({ type: "status", status: "budget_exceeded" });
  });

  it("maps url_context_call from the SDK's plural `urls` array", async () => {
    const events = await drain(
      normalizeInteractionsStream(
        replay([
          {
            event_type: "content.delta",
            event_id: "ev-u",
            index: 0,
            delta: { type: "url_context_call", arguments: { urls: ["https://example.com/page"] } },
          } as unknown as InteractionSSEEvent,
        ]),
      ),
    );
    expect(events).toEqual([
      expect.objectContaining({
        type: "search",
        action: "open_page",
        status: "started",
        url: "https://example.com/page",
      }),
    ]);
  });

  it("tallies completed google searches into usage.searches", async () => {
    const searchResult = (id: string): InteractionSSEEvent =>
      ({
        event_type: "content.delta",
        event_id: id,
        index: 0,
        delta: { type: "google_search_result", call_id: id, result: [{ url: "https://x" }] },
      }) as unknown as InteractionSSEEvent;

    const events = await drain(
      normalizeInteractionsStream(
        replay([
          searchResult("ev-r1"),
          searchResult("ev-r2"),
          {
            event_type: "interaction.complete",
            event_id: "ev-done",
            interaction: { id: "int_abc", status: "completed", outputs: [] },
          } as unknown as InteractionSSEEvent,
        ]),
      ),
    );

    const usage = events.find((e) => e.type === "usage");
    expect(usage?.type === "usage" && usage.usage.searches).toBe(2);
    const done = events.at(-1);
    expect(done?.type === "done" && done.result.usage?.searches).toBe(2);
  });
});

describe("startGeminiResearch", () => {
  it("creates a streaming background interaction and normalizes it", async () => {
    const create = vi.fn().mockResolvedValue(replay(FIXTURE));
    const client = clientWith({ create: create as Interactions["create"] });

    const events = await drain(startGeminiResearch(client, BASE_OPTIONS, AGENT, SPEC));

    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      agent: AGENT,
      background: true,
      store: true,
      stream: true,
    });
    // Per-request options: long timeout, SDK retries disabled.
    expect(create.mock.calls[0]?.[1]).toMatchObject({ maxRetries: 0 });
    expect(events.at(-1)?.type).toBe("done");
  });
});

describe("resumeGeminiResearch", () => {
  it("resumes the stream via last_event_id", async () => {
    const get = vi.fn().mockResolvedValue(replay(FIXTURE.slice(9)));
    const client = clientWith({ get: get as Interactions["get"] });

    const events = await drain(
      resumeGeminiResearch(client, {
        provider: "gemini",
        model: AGENT,
        jobId: "int_abc",
        cursor: "ev-8",
      }),
    );

    expect(get).toHaveBeenCalledWith(
      "int_abc",
      { stream: true, last_event_id: "ev-8" },
      expect.anything(),
    );
    expect(events[0]?.cursor).toBe("ev-9");
    expect(events.at(-1)?.type).toBe("done");
  });
});

describe("getGeminiResearchStatus", () => {
  it("returns status-only while running, full result when terminal", async () => {
    const running = { id: "int_abc", status: "in_progress", outputs: [] };
    const completed = {
      id: "int_abc",
      status: "completed",
      outputs: [
        {
          type: "text",
          text: "Final report body.",
          annotations: [{ source: "https://example.com/src", start_index: 0, end_index: 5 }],
        },
      ],
      usage: { total_input_tokens: 10, total_output_tokens: 5, total_tokens: 15 },
    };
    const get = vi.fn().mockResolvedValueOnce(running).mockResolvedValueOnce(completed);
    const client = clientWith({ get: get as Interactions["get"] });
    const ref = { provider: "gemini", model: AGENT, jobId: "int_abc" };

    await expect(getGeminiResearchStatus(client, ref)).resolves.toEqual({
      status: "in_progress",
    });

    const snapshot = await getGeminiResearchStatus(client, ref);
    expect(snapshot.status).toBe("completed");
    expect(snapshot.result?.report).toBe("Final report body.");
    expect(snapshot.result?.citations).toEqual([
      { url: "https://example.com/src", startIndex: 0, endIndex: 5 },
    ]);
  });
});
