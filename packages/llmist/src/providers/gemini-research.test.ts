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

/** The SDK's Interactions is a namespace in v2 — mock the client structurally. */
function clientWith(interactions: Record<string, unknown>): GoogleGenAI {
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
      "created", // interaction.created
      "status",
      "phase", // thought step.start → reasoning
      "thinking", // thought_summary delta
      // thought_signature ignored
      "phase", // google_search_call step.start → searching
      "search", // step.start → started (counted once)
      "search", // duplicate call delta → started again, but NOT double-counted
      "search", // result delta → completed
      "status", // status_update
      "phase", // model_output step.start → writing
      "text",
      "text",
      "citation", // text_annotation_delta
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
        title: "SSB Progress",
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
        // One query, index-guarded across step.start + call delta — drives per-search pricing.
        searches: 1,
      });
    }

    // Report accumulated from text deltas (interaction.completed carries no steps);
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
            event_type: "step.delta",
            event_id: "ev-x",
            index: 0,
            delta: { type: "thought", content: { type: "text", text: "alt shape" } },
          } as unknown as InteractionSSEEvent,
        ]),
      ),
    );
    expect(events).toEqual([expect.objectContaining({ type: "thinking", delta: "alt shape" })]);
  });

  it("drops replayed client_closed_request error markers", async () => {
    // LIVE-observed: a client disconnect is recorded into the interaction's
    // event log; replay streams then end with that marker instead of
    // interaction.completed. It can never describe the CURRENT consumer
    // (who is provably connected, reading it) — never surface it as an error.
    const events = await drain(
      normalizeInteractionsStream(
        replay([
          {
            event_type: "error",
            event_id: "ev-e1",
            error: { message: "The operation was cancelled.", code: "client_closed_request" },
          },
        ] as unknown as InteractionSSEEvent[]),
      ),
    );
    expect(events).toEqual([]);
  });

  it("also drops client_closed_request under the 'interaction.error' shape", async () => {
    // The disconnect marker must be suppressed symmetrically: if it ever
    // arrives under the alternate `interaction.error` shape (handled by the
    // defensive default branch), surfacing it would fail a healthy run just
    // as it would under the `error` shape.
    const events = await drain(
      normalizeInteractionsStream(
        replay([
          {
            event_type: "interaction.error",
            event_id: "ev-e1",
            error: { message: "The operation was cancelled.", code: "client_closed_request" },
          },
        ] as unknown as InteractionSSEEvent[]),
      ),
    );
    expect(events).toEqual([]);
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
            event_type: "step.delta",
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

  it("fetches the stored interaction for usage when the terminal event lacks it", async () => {
    // LIVE-observed: interaction.completed embeds an interaction WITHOUT
    // usage or steps — the stored interaction (free GET) has both.
    const full = {
      id: "int_abc",
      status: "completed",
      usage: { total_input_tokens: 399_725, total_output_tokens: 4_527, total_tokens: 482_868 },
      steps: [
        {
          type: "model_output",
          content: [{ type: "text", text: "Fetched report.", annotations: [] }],
        },
      ],
    } as unknown as Interactions.Interaction;
    const fetchFinal = vi.fn().mockResolvedValue(full);

    const events = await drain(
      normalizeInteractionsStream(
        replay([
          {
            event_type: "interaction.created",
            event_id: "ev-0",
            interaction: { id: "int_abc", status: "in_progress" },
          },
          {
            event_type: "interaction.completed",
            event_id: "ev-1",
            interaction: { id: "int_abc", status: "completed" },
          },
        ] as unknown as InteractionSSEEvent[]),
        fetchFinal,
      ),
    );

    expect(fetchFinal).toHaveBeenCalledExactlyOnceWith("int_abc");
    const usage = events.find((e) => e.type === "usage");
    expect(usage?.type === "usage" && usage.usage.totalTokens).toBe(482_868);
    const done = events.at(-1);
    expect(done?.type === "done" && done.result.report).toBe("Fetched report.");
  });

  it("does not fetch when the terminal event already carries usage", async () => {
    const fetchFinal = vi.fn();
    await drain(normalizeInteractionsStream(replay(FIXTURE), fetchFinal));
    expect(fetchFinal).not.toHaveBeenCalled();
  });

  it("falls back to the embedded interaction when the final fetch fails", async () => {
    const fetchFinal = vi.fn().mockRejectedValue(new Error("GET blew up"));

    const events = await drain(
      normalizeInteractionsStream(
        replay([
          {
            event_type: "interaction.completed",
            event_id: "ev-1",
            interaction: { id: "int_abc", status: "completed" },
          },
        ] as unknown as InteractionSSEEvent[]),
        fetchFinal,
      ),
    );

    const done = events.at(-1);
    expect(done?.type === "done" && done.result.status).toBe("completed");
    const usage = events.find((e) => e.type === "usage");
    expect(usage?.type === "usage" && usage.usage.totalTokens).toBe(0);
  });

  it("tallies search queries (incl. per-call fan-out) into usage.searches", async () => {
    // Google bills per grounding QUERY, and one google_search_call may carry
    // several — count queries from call deltas, not completed results.
    const events = await drain(
      normalizeInteractionsStream(
        replay([
          {
            event_type: "step.delta",
            event_id: "ev-s1",
            index: 0,
            delta: {
              type: "google_search_call",
              id: "g1",
              arguments: { queries: ["a", "b", "c"] },
            },
          },
          {
            event_type: "step.delta",
            event_id: "ev-s2",
            index: 1,
            delta: { type: "google_search_call", id: "g2", arguments: { queries: ["d"] } },
          },
          {
            event_type: "interaction.completed",
            event_id: "ev-done",
            interaction: { id: "int_abc", status: "completed" },
          },
        ] as unknown as InteractionSSEEvent[]),
      ),
    );

    const usage = events.find((e) => e.type === "usage");
    expect(usage?.type === "usage" && usage.usage.searches).toBe(4);
    // The done payload's embedded usage carries the same count.
    const done = events.at(-1);
    expect(done?.type === "done" && done.result.usage?.searches).toBe(4);
  });
});

describe("startGeminiResearch", () => {
  it("creates WITHOUT streaming, then streams events via a separate GET", async () => {
    // LIVE-observed: a streaming create ties the interaction's fate to that
    // connection — the API cancels the whole background run
    // (client_closed_request) when the create stream disconnects, breaking
    // abort≠cancel. Create must be a plain request; events come from GET.
    const create = vi.fn().mockResolvedValue({ id: "int_abc", status: "in_progress" });
    const get = vi.fn().mockResolvedValue(replay(FIXTURE));
    const client = clientWith({ create, get });

    const events = await drain(startGeminiResearch(client, BASE_OPTIONS, AGENT, SPEC));

    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      agent: AGENT,
      background: true,
      store: true,
    });
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty("stream");
    // Per-request options: long timeout, SDK retries disabled.
    expect(create.mock.calls[0]?.[1]).toMatchObject({ maxRetries: 0 });
    expect(get).toHaveBeenCalledWith("int_abc", { stream: true }, expect.anything());

    // created comes from the create response; the GET stream's replayed
    // interaction.created is deduped.
    expect(events.filter((e) => e.type === "created")).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "created", jobId: "int_abc" });
    expect(events[1]).toMatchObject({ type: "status", status: "in_progress" });
    expect(events.at(-1)?.type).toBe("done");
  });

  it("polls the stored interaction to terminal when the stream ends without done", async () => {
    // LIVE-observed: after a prior client disconnect, replay streams end with
    // a client_closed_request marker and never deliver interaction.completed,
    // while the interaction itself completes fine server-side.
    const create = vi.fn().mockResolvedValue({ id: "int_abc", status: "in_progress" });
    const full = {
      id: "int_abc",
      status: "completed",
      usage: { total_input_tokens: 311_967, total_output_tokens: 6_536, total_tokens: 376_067 },
      steps: [{ type: "model_output", content: [{ type: "text", text: "Recovered report." }] }],
    };
    const get = vi.fn().mockImplementation((_id: string, params?: { stream?: boolean }) =>
      params?.stream
        ? Promise.resolve(
            replay([
              {
                event_type: "step.delta",
                event_id: "ev-1",
                index: 0,
                delta: { type: "text", text: "partial " },
              },
              {
                event_type: "error",
                event_id: "ev-2",
                error: { message: "The operation was cancelled.", code: "client_closed_request" },
              },
            ] as unknown as InteractionSSEEvent[]),
          )
        : Promise.resolve(full),
    );
    const client = clientWith({ create, get });

    const events = await drain(startGeminiResearch(client, BASE_OPTIONS, AGENT, SPEC));

    expect(events.some((e) => e.type === "error")).toBe(false);
    const done = events.at(-1);
    expect(done?.type === "done" && done.result.status).toBe("completed");
    expect(done?.type === "done" && done.result.report).toBe("Recovered report.");
    expect(done?.type === "done" && done.result.usage?.totalTokens).toBe(376_067);
  });

  it("fetches the stored interaction when the live terminal event omits usage", async () => {
    const create = vi.fn().mockResolvedValue({ id: "int_abc", status: "in_progress" });
    const full = {
      id: "int_abc",
      status: "completed",
      usage: { total_input_tokens: 10, total_output_tokens: 2, total_tokens: 12 },
      steps: [{ type: "model_output", content: [{ type: "text", text: "Full report." }] }],
    };
    const get = vi.fn().mockImplementation((_id: string, params?: { stream?: boolean }) =>
      params?.stream
        ? Promise.resolve(
            replay([
              {
                event_type: "interaction.completed",
                event_id: "ev-1",
                interaction: { id: "int_abc", status: "completed" },
              },
            ] as unknown as InteractionSSEEvent[]),
          )
        : Promise.resolve(full),
    );
    const client = clientWith({ create, get });

    const events = await drain(startGeminiResearch(client, BASE_OPTIONS, AGENT, SPEC));

    expect(get).toHaveBeenCalledWith("int_abc", undefined, expect.anything());
    const done = events.at(-1);
    expect(done?.type === "done" && done.result.report).toBe("Full report.");
    expect(done?.type === "done" && done.result.usage?.totalTokens).toBe(12);
  });
});

describe("resumeGeminiResearch", () => {
  it("polls status first, then resumes the stream via last_event_id when still running", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ id: "int_abc", status: "in_progress", steps: [] })
      .mockResolvedValueOnce(replay(FIXTURE.slice(9)));
    const client = clientWith({ get });

    const events = await drain(
      resumeGeminiResearch(client, {
        provider: "gemini",
        model: AGENT,
        jobId: "int_abc",
        cursor: "ev-8",
      }),
    );

    expect(get).toHaveBeenNthCalledWith(1, "int_abc", undefined, expect.anything());
    expect(get).toHaveBeenNthCalledWith(
      2,
      "int_abc",
      { stream: true, last_event_id: "ev-8" },
      expect.anything(),
    );
    expect(events[0]?.cursor).toBe("ev-9");
    expect(events.at(-1)?.type).toBe("done");
  });

  it("reconciles a resumed stream that ends without done against the stored interaction", async () => {
    const completed = {
      id: "int_abc",
      status: "completed",
      usage: { total_input_tokens: 5, total_output_tokens: 5, total_tokens: 10 },
      steps: [{ type: "model_output", content: [{ type: "text", text: "Recovered." }] }],
    };
    const get = vi
      .fn()
      // Status-first probe: still running → open the stream.
      .mockResolvedValueOnce({ id: "int_abc", status: "in_progress", steps: [] })
      // The stream ends with the disconnect marker, no interaction.completed.
      .mockResolvedValueOnce(
        replay([
          {
            event_type: "error",
            event_id: "ev-2",
            error: { message: "The operation was cancelled.", code: "client_closed_request" },
          },
        ] as unknown as InteractionSSEEvent[]),
      )
      // Reconciliation poll finds the terminal interaction.
      .mockResolvedValueOnce(completed);
    const client = clientWith({ get });

    const events = await drain(
      resumeGeminiResearch(client, { provider: "gemini", model: AGENT, jobId: "int_abc" }),
    );

    expect(events.some((e) => e.type === "error")).toBe(false);
    const done = events.at(-1);
    expect(done?.type === "done" && done.result.status).toBe("completed");
    expect(done?.type === "done" && done.result.report).toBe("Recovered.");
  });

  it("emits the terminal sequence without streaming when the job finished while detached", async () => {
    const completed = {
      id: "int_abc",
      status: "completed",
      steps: [
        { type: "google_search_call", id: "g1", arguments: { queries: ["q1"] } },
        {
          type: "model_output",
          content: [
            {
              type: "text",
              text: "Finished while detached.",
              annotations: [
                { type: "url_citation", url: "https://done.example", start_index: 0, end_index: 8 },
              ],
            },
          ],
        },
      ],
      usage: { total_input_tokens: 5, total_output_tokens: 5, total_tokens: 10 },
    };
    const get = vi.fn().mockResolvedValue(completed);
    const client = clientWith({ get });

    const events = await drain(
      resumeGeminiResearch(client, {
        provider: "gemini",
        model: AGENT,
        jobId: "int_abc",
        cursor: "ev-2",
      }),
    );

    expect(get).toHaveBeenCalledTimes(1);
    expect(events.map((e) => e.type)).toEqual(["status", "text", "citation", "usage", "done"]);
    const usage = events.find((e) => e.type === "usage");
    if (usage?.type === "usage") {
      expect(usage.usage.searches).toBe(1);
    }
  });
});

describe("getGeminiResearchStatus", () => {
  it("returns status-only while running, full result when terminal", async () => {
    const running = { id: "int_abc", status: "in_progress", steps: [] };
    const completed = {
      id: "int_abc",
      status: "completed",
      steps: [
        {
          type: "model_output",
          content: [
            {
              type: "text",
              text: "Final report body.",
              annotations: [
                {
                  type: "url_citation",
                  url: "https://example.com/src",
                  title: "Src",
                  start_index: 0,
                  end_index: 5,
                },
              ],
            },
          ],
        },
      ],
      usage: { total_input_tokens: 10, total_output_tokens: 5, total_tokens: 15 },
    };
    const get = vi.fn().mockResolvedValueOnce(running).mockResolvedValueOnce(completed);
    const client = clientWith({ get });
    const ref = { provider: "gemini", model: AGENT, jobId: "int_abc" };

    await expect(getGeminiResearchStatus(client, ref)).resolves.toEqual({
      status: "in_progress",
    });

    const snapshot = await getGeminiResearchStatus(client, ref);
    expect(snapshot.status).toBe("completed");
    expect(snapshot.result?.report).toBe("Final report body.");
    expect(snapshot.result?.citations).toEqual([
      { url: "https://example.com/src", title: "Src", startIndex: 0, endIndex: 5 },
    ]);
  });
});
