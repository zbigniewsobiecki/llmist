import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type OpenAI from "openai";
import type { ResponseStreamEvent } from "openai/resources/responses/responses";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResearchValidationError } from "../research/errors.js";
import type { ResearchEvent, ResearchOptions } from "../research/types.js";
import {
  buildResponsesResearchRequest,
  getOpenAIResearchStatus,
  normalizeResponsesStream,
  resumeOpenAIResearch,
  startOpenAIResearch,
} from "./openai-research.js";
import { getOpenAIResearchModelSpec } from "./openai-research-models.js";

const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "__fixtures__/openai-responses-research.json",
);
const FIXTURE: ResponseStreamEvent[] = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8"));

const DR_SPEC = getOpenAIResearchModelSpec("o3-deep-research");
const POLL_SPEC = getOpenAIResearchModelSpec("gpt-5.5-pro");

const BASE_OPTIONS: ResearchOptions = {
  model: "openai:o3-deep-research",
  query: "State of solid-state batteries",
  tools: [{ type: "web_search" }],
};

async function* replay(events: ResponseStreamEvent[]): AsyncGenerator<ResponseStreamEvent> {
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

describe("buildResponsesResearchRequest", () => {
  it("assembles the documented deep-research request shape", () => {
    const request = buildResponsesResearchRequest(
      { ...BASE_OPTIONS, maxToolCalls: 50 },
      DR_SPEC,
      "o3-deep-research",
    );
    expect(request).toMatchObject({
      model: "o3-deep-research",
      input: "State of solid-state batteries",
      background: true,
      store: true,
      reasoning: { summary: "auto" },
      tools: [{ type: "web_search_preview" }],
      max_tool_calls: 50,
    });
  });

  it("folds the system prompt into the input (no system role)", () => {
    const request = buildResponsesResearchRequest(
      { ...BASE_OPTIONS, systemPrompt: "You are a battery analyst." },
      DR_SPEC,
      "o3-deep-research",
    );
    expect(request.input).toBe("You are a battery analyst.\n\nState of solid-state batteries");
  });

  it("maps tools: web_search→web_search_preview, file_search, mcp, code_interpreter", () => {
    const request = buildResponsesResearchRequest(
      {
        ...BASE_OPTIONS,
        tools: [
          { type: "web_search" },
          { type: "file_search", vectorStoreIds: ["vs_1", "vs_2"] },
          { type: "mcp", serverLabel: "corp", serverUrl: "https://mcp.example" },
          { type: "code_interpreter" },
        ],
      },
      DR_SPEC,
      "o3-deep-research",
    );
    expect(request.tools).toEqual([
      { type: "web_search_preview" },
      { type: "file_search", vector_store_ids: ["vs_1", "vs_2"] },
      {
        type: "mcp",
        server_label: "corp",
        server_url: "https://mcp.example",
        require_approval: "never",
      },
      { type: "code_interpreter", container: { type: "auto" } },
    ]);
  });

  it("rejects more than 2 vector stores", () => {
    expect(() =>
      buildResponsesResearchRequest(
        {
          ...BASE_OPTIONS,
          tools: [{ type: "file_search", vectorStoreIds: ["a", "b", "c"] }],
        },
        DR_SPEC,
        "o3-deep-research",
      ),
    ).toThrow(ResearchValidationError);
  });

  it("rejects requests without any data-source tool", () => {
    expect(() =>
      buildResponsesResearchRequest(
        { ...BASE_OPTIONS, tools: [{ type: "code_interpreter" }] },
        DR_SPEC,
        "o3-deep-research",
      ),
    ).toThrow(ResearchValidationError);
    expect(() =>
      buildResponsesResearchRequest({ ...BASE_OPTIONS, tools: [] }, DR_SPEC, "o3-deep-research"),
    ).toThrow(ResearchValidationError);
  });

  it("maps reasoning effort (maximum → xhigh) and merges extra last", () => {
    const request = buildResponsesResearchRequest(
      {
        ...BASE_OPTIONS,
        reasoning: { enabled: true, effort: "maximum" },
        extra: { metadata: { run: "42" } },
      },
      DR_SPEC,
      "o3-deep-research",
    );
    expect(request.reasoning).toEqual({ summary: "auto", effort: "xhigh" });
    expect((request as Record<string, unknown>).metadata).toEqual({ run: "42" });
  });
});

describe("normalizeResponsesStream", () => {
  it("normalizes the full fixture happy path", async () => {
    const events = await drain(normalizeResponsesStream(replay(FIXTURE)));
    const types = events.map((e) => e.type);

    expect(types).toEqual([
      "created", // response.created
      "status", //   + status from created
      "status", // response.queued
      "status", // response.in_progress
      "phase", // reasoning item added
      "thinking", // reasoning summary delta
      "search", // web_search_call added (started)
      // searching event deduped (same item id)
      "search", // completed
      "phase", // message item added → writing
      "text",
      "text",
      "citation",
      "usage",
      "done",
    ]);

    const created = events[0];
    expect(created).toMatchObject({ type: "created", jobId: "resp_123", cursor: "0" });

    const search = events.find((e) => e.type === "search");
    if (search?.type === "search") {
      expect(search.query).toBe("solid state batteries 2026");
    }

    const usage = events.find((e) => e.type === "usage");
    if (usage?.type === "usage") {
      expect(usage.usage).toMatchObject({
        inputTokens: 5000,
        outputTokens: 1200,
        totalTokens: 6200,
        cachedInputTokens: 1000,
        reasoningTokens: 800,
        searches: 1,
      });
    }

    const done = events.at(-1);
    if (done?.type === "done") {
      expect(done.result.status).toBe("completed");
      expect(done.result.report).toBe("Solid-state batteries are progressing rapidly.");
      expect(done.result.citations).toEqual([
        {
          url: "https://example.com/battery-progress",
          title: "Battery Progress",
          startIndex: 0,
          endIndex: 22,
        },
      ]);
    }

    // Every event carries its sequence number as cursor.
    for (const event of events) {
      expect(event.cursor).toBeDefined();
    }
  });

  it("maps response.failed to error + done(failed)", async () => {
    const failed = [
      FIXTURE[0],
      {
        type: "response.failed",
        sequence_number: 1,
        response: {
          id: "resp_123",
          status: "failed",
          output: [],
          error: { code: "server_error", message: "something broke" },
        },
      },
    ] as unknown as ResponseStreamEvent[];

    const events = await drain(normalizeResponsesStream(replay(failed)));
    const error = events.find((e) => e.type === "error");
    expect(error).toBeDefined();
    if (error?.type === "error") {
      expect(error.error.message).toBe("something broke");
      expect(error.error.retryable).toBe(false);
    }
    const done = events.at(-1);
    if (done?.type === "done") {
      expect(done.result.status).toBe("failed");
    }
  });

  it("maps response.incomplete to done(incomplete) with partial report", async () => {
    const incomplete = [
      {
        type: "response.incomplete",
        sequence_number: 0,
        response: {
          id: "resp_9",
          status: "incomplete",
          output: [
            {
              type: "message",
              id: "m",
              role: "assistant",
              content: [{ type: "output_text", text: "partial...", annotations: [] }],
            },
          ],
        },
      },
    ] as unknown as ResponseStreamEvent[];
    const events = await drain(normalizeResponsesStream(replay(incomplete)));
    const done = events.at(-1);
    expect(done?.type).toBe("done");
    if (done?.type === "done") {
      expect(done.result.status).toBe("incomplete");
      expect(done.result.report).toBe("partial...");
    }
  });

  it("passes unknown event types through silently", async () => {
    const withUnknown = [
      { type: "response.content_part.added", sequence_number: 0, part: {} },
      { type: "some.future.event", sequence_number: 1 },
    ] as unknown as ResponseStreamEvent[];
    const events = await drain(normalizeResponsesStream(replay(withUnknown)));
    expect(events).toEqual([]);
  });
});

describe("startOpenAIResearch — streaming spec", () => {
  it("creates with stream:true and normalizes; retries a retryable create failure", async () => {
    // retry-after header keeps the retry sleep at ~1ms in this test.
    const rateLimit = Object.assign(new Error("rate limit exceeded"), {
      status: 429,
      headers: { "retry-after": "0.001" },
    });
    const create = vi.fn().mockRejectedValueOnce(rateLimit).mockResolvedValue(replay(FIXTURE));
    const client = { responses: { create } } as unknown as OpenAI;

    const events = await drain(
      startOpenAIResearch(client, BASE_OPTIONS, "o3-deep-research", DR_SPEC),
    );

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]?.[0]).toMatchObject({ stream: true, background: true });
    expect(events.at(-1)?.type).toBe("done");
  });
});

describe("startOpenAIResearch — poll-only spec (gpt-5.5-pro)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates in background then polls to completion with status heartbeats", async () => {
    const completedResponse = {
      id: "resp_poll",
      status: "completed",
      output: [
        {
          type: "message",
          id: "m",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "Full report from polling.",
              annotations: [
                {
                  type: "url_citation",
                  url: "https://poll.example",
                  title: "P",
                  start_index: 0,
                  end_index: 4,
                },
              ],
            },
          ],
        },
      ],
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        total_tokens: 30,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 5 },
      },
    };
    const create = vi.fn().mockResolvedValue({ id: "resp_poll", status: "queued", output: [] });
    const retrieve = vi
      .fn()
      .mockResolvedValueOnce({ id: "resp_poll", status: "in_progress", output: [] })
      .mockResolvedValueOnce(completedResponse);
    const client = { responses: { create, retrieve } } as unknown as OpenAI;

    const collected: ResearchEvent[] = [];
    const consuming = (async () => {
      for await (const event of startOpenAIResearch(
        client,
        { model: "openai:gpt-5.5-pro", query: "q", tools: [{ type: "web_search" }] },
        "gpt-5.5-pro",
        POLL_SPEC,
      )) {
        collected.push(event);
      }
    })();

    await vi.advanceTimersByTimeAsync(60_000);
    await consuming;

    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      background: true,
      store: true,
      stream: false,
    });
    expect(retrieve).toHaveBeenCalledTimes(2);

    const types = collected.map((e) => e.type);
    expect(types[0]).toBe("created");
    expect(types.filter((t) => t === "status").length).toBeGreaterThanOrEqual(2);
    expect(types).toContain("text");
    expect(types).toContain("citation");
    expect(types.at(-1)).toBe("done");

    const text = collected.find((e) => e.type === "text");
    if (text?.type === "text") {
      expect(text.delta).toBe("Full report from polling.");
    }
  });
});

describe("resumeOpenAIResearch", () => {
  it("polls status first, then streams from the cursor when still running", async () => {
    const retrieve = vi
      .fn()
      // Status-first poll: job still in progress → open the resume stream.
      .mockResolvedValueOnce({ id: "resp_123", status: "in_progress", output: [] })
      .mockResolvedValueOnce(replay(FIXTURE.slice(9)));
    const client = { responses: { retrieve } } as unknown as OpenAI;

    const events = await drain(
      resumeOpenAIResearch(
        client,
        { provider: "openai", model: "o3-deep-research", jobId: "resp_123", cursor: "8" },
        DR_SPEC,
      ),
    );

    expect(retrieve).toHaveBeenNthCalledWith(1, "resp_123", {}, expect.anything());
    expect(retrieve).toHaveBeenNthCalledWith(
      2,
      "resp_123",
      { stream: true, starting_after: 8 },
      expect.anything(),
    );
    expect(events[0]?.cursor).toBe("9");
    expect(events.at(-1)?.type).toBe("done");
  });

  it("emits the terminal sequence without streaming when the job finished while detached", async () => {
    // Observed live: stream-resume on an already-completed response HANGS.
    const completed = {
      id: "resp_123",
      status: "completed",
      output: [
        { type: "web_search_call", id: "ws", status: "completed", action: { type: "search" } },
        {
          type: "message",
          id: "m",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "Finished while detached.",
              annotations: [
                {
                  type: "url_citation",
                  url: "https://done.example",
                  title: "D",
                  start_index: 0,
                  end_index: 8,
                },
              ],
            },
          ],
        },
      ],
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        total_tokens: 30,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 5 },
      },
    };
    const retrieve = vi.fn().mockResolvedValue(completed);
    const client = { responses: { retrieve } } as unknown as OpenAI;

    const events = await drain(
      resumeOpenAIResearch(
        client,
        { provider: "openai", model: "o3-deep-research", jobId: "resp_123", cursor: "0" },
        DR_SPEC,
      ),
    );

    // Exactly one non-streaming retrieve; the streaming endpoint is never hit.
    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(retrieve).toHaveBeenCalledWith("resp_123", {}, expect.anything());
    expect(events.map((e) => e.type)).toEqual(["status", "text", "citation", "usage", "done"]);
    const text = events.find((e) => e.type === "text");
    if (text?.type === "text") {
      expect(text.delta).toBe("Finished while detached.");
    }
  });

  it("re-enters the poll loop for poll-only specs", async () => {
    vi.useFakeTimers();
    try {
      const retrieve = vi.fn().mockResolvedValue({
        id: "resp_poll",
        status: "completed",
        output: [],
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          total_tokens: 2,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      });
      const client = { responses: { retrieve } } as unknown as OpenAI;

      const collected: ResearchEvent[] = [];
      const consuming = (async () => {
        for await (const event of resumeOpenAIResearch(
          client,
          { provider: "openai", model: "gpt-5.5-pro", jobId: "resp_poll" },
          POLL_SPEC,
        )) {
          collected.push(event);
        }
      })();
      await vi.advanceTimersByTimeAsync(20_000);
      await consuming;

      expect(collected.at(-1)?.type).toBe("done");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("getOpenAIResearchStatus", () => {
  it("returns status only while running, full result when terminal", async () => {
    const retrieve = vi
      .fn()
      .mockResolvedValueOnce({ id: "r", status: "in_progress", output: [] })
      .mockResolvedValueOnce({
        id: "r",
        status: "completed",
        output: [
          {
            type: "message",
            id: "m",
            role: "assistant",
            content: [{ type: "output_text", text: "done report", annotations: [] }],
          },
        ],
        usage: {
          input_tokens: 1,
          output_tokens: 2,
          total_tokens: 3,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      });
    const client = { responses: { retrieve } } as unknown as OpenAI;
    const ref = { provider: "openai", model: "o3-deep-research", jobId: "r" };

    const running = await getOpenAIResearchStatus(client, ref);
    expect(running).toEqual({ status: "in_progress" });

    const finished = await getOpenAIResearchStatus(client, ref);
    expect(finished.status).toBe("completed");
    expect(finished.result?.report).toBe("done report");
  });
});
