import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type OpenAI from "openai";
import type { ChatCompletionChunk } from "openai/resources/chat/completions";
import { describe, expect, it, vi } from "vitest";
import { ModelIdentifierParser } from "../core/options.js";
import { ResearchJobNotResumableError, ResearchValidationError } from "../research/errors.js";
import { ResearchNamespace } from "../research/namespace.js";
import type { ResearchEvent, ResearchOptions } from "../research/types.js";
import { OpenRouterProvider } from "./openrouter.js";
import {
  buildOpenRouterResearchMessages,
  normalizeOpenRouterResearchStream,
} from "./openrouter-research.js";
import {
  getOpenRouterResearchModelSpec,
  openrouterResearchModels,
} from "./openrouter-research-models.js";

const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "__fixtures__/openrouter-sonar-research.json",
);
const FIXTURE: ChatCompletionChunk[] = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8"));

const BASE_OPTIONS: ResearchOptions = {
  model: "openrouter:perplexity/sonar-deep-research",
  query: "State of solid-state batteries",
};

async function* replay(chunks: ChatCompletionChunk[]): AsyncGenerator<ChatCompletionChunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

async function drain(iterable: AsyncIterable<ResearchEvent>): Promise<ResearchEvent[]> {
  const events: ResearchEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

describe("openrouter research catalog", () => {
  it("registers sonar-deep-research with internal-reasoning + per-search pricing", () => {
    const spec = getOpenRouterResearchModelSpec("perplexity/sonar-deep-research");
    expect(spec?.pricing).toEqual({
      input: 2,
      output: 8,
      internalReasoning: 3,
      perThousandSearches: 5,
    });
    expect(spec?.capabilities).toMatchObject({
      streaming: true,
      background: false,
      resumable: false,
      tools: [],
    });
  });

  it("registers sonar-pro-search and the upstream OpenAI research slugs with shutdown metadata", () => {
    expect(getOpenRouterResearchModelSpec("perplexity/sonar-pro-search")?.pricing).toMatchObject({
      perThousandSearches: 18,
    });
    for (const slug of ["openai/o3-deep-research", "openai/o4-mini-deep-research"]) {
      const spec = getOpenRouterResearchModelSpec(slug);
      expect(spec?.metadata?.shutdownDate).toBe("2026-07-23");
      expect(spec?.metadata?.replacement).toBeDefined();
    }
    expect(new Set(openrouterResearchModels.map((s) => s.modelId)).size).toBe(
      openrouterResearchModels.length,
    );
  });
});

describe("buildOpenRouterResearchMessages", () => {
  it("builds system + user messages", () => {
    const { messages } = buildOpenRouterResearchMessages({
      ...BASE_OPTIONS,
      systemPrompt: "Cite everything.",
    });
    expect(messages).toEqual([
      { role: "system", content: "Cite everything." },
      { role: "user", content: "State of solid-state batteries" },
    ]);
  });

  it("rejects background mode (not available on OpenRouter)", () => {
    expect(() => buildOpenRouterResearchMessages({ ...BASE_OPTIONS, background: true })).toThrow(
      ResearchValidationError,
    );
  });

  it("rejects a tools option (tools are managed upstream)", () => {
    expect(() =>
      buildOpenRouterResearchMessages({ ...BASE_OPTIONS, tools: [{ type: "web_search" }] }),
    ).toThrow(ResearchValidationError);
  });
});

describe("normalizeOpenRouterResearchStream", () => {
  it("normalizes the fixture: created(null) → thinking → text → citations → usage → done", async () => {
    const events = await drain(normalizeOpenRouterResearchStream(replay(FIXTURE)));
    const types = events.map((e) => e.type);

    expect(types).toEqual([
      "created",
      "status",
      "thinking", // reasoning_details preferred
      "thinking", // plain reasoning fallback
      "text",
      "text",
      "citation", // annotation
      "citation", // legacy citations array (deduped against annotation)
      "usage",
      "done",
    ]);

    expect(events[0]).toMatchObject({ type: "created", jobId: null });

    // reasoning_details wins over the duplicate plain reasoning string.
    const firstThinking = events.find((e) => e.type === "thinking");
    if (firstThinking?.type === "thinking") {
      expect(firstThinking.delta).toBe("Let me research solid-state batteries. ");
    }

    const citations = events.filter((e) => e.type === "citation");
    expect(citations).toHaveLength(2);
    if (citations[0]?.type === "citation") {
      expect(citations[0].citation).toEqual({
        url: "https://example.com/ssb-news",
        title: "SSB News",
        content: "excerpt text",
        startIndex: 0,
        endIndex: 54,
      });
    }
    if (citations[1]?.type === "citation") {
      // Legacy array: only the URL not already cited via annotations survives...
      expect(citations[1].citation.url).toBe("https://example.com/legacy-source");
    }

    const usage = events.find((e) => e.type === "usage");
    if (usage?.type === "usage") {
      expect(usage.usage).toMatchObject({
        inputTokens: 1200,
        outputTokens: 380_000,
        totalTokens: 381_200,
        reasoningTokens: 350_000,
        searches: 32,
        // Authoritative billed cost from OpenRouter usage accounting.
        costUSD: 1.93,
      });
    }

    const done = events.at(-1);
    if (done?.type === "done") {
      expect(done.result.status).toBe("completed");
    }

    // Not resumable: no cursors anywhere.
    for (const event of events) {
      expect(event.cursor).toBeUndefined();
    }
  });

  it("dedupes the legacy citations url already covered by an annotation", async () => {
    const events = await drain(normalizeOpenRouterResearchStream(replay(FIXTURE)));
    const urls = events
      .filter((e) => e.type === "citation")
      .map((e) => (e.type === "citation" ? e.citation.url : ""));
    // ssb-news appears in both the annotation and the legacy array — once only.
    expect(urls.filter((u) => u === "https://example.com/ssb-news")).toHaveLength(1);
  });

  it("dedupes by url even when the legacy citations array streams before the annotation", async () => {
    // Order-independence guard: the legacy top-level `citations` array arrives
    // BEFORE the matching `url_citation` annotation for the same url. The url
    // must still emit exactly once — as the richer annotation form, not a bare
    // legacy url plus a full annotation (the collector keys by url#startIndex,
    // so `url#` and `url#0` would otherwise both survive as duplicates).
    const chunks = [
      {
        id: "g",
        citations: ["https://example.com/x"],
        choices: [{ index: 0, delta: {}, finish_reason: null }],
      },
      {
        id: "g",
        choices: [
          {
            index: 0,
            delta: {
              content: "hello",
              annotations: [
                {
                  type: "url_citation",
                  url_citation: {
                    url: "https://example.com/x",
                    title: "X",
                    start_index: 0,
                    end_index: 5,
                  },
                },
              ],
            },
            finish_reason: "stop",
          },
        ],
      },
    ] as unknown as ChatCompletionChunk[];

    const events = await drain(normalizeOpenRouterResearchStream(replay(chunks)));
    const citations = events.filter((e) => e.type === "citation");
    expect(citations).toHaveLength(1);
    if (citations[0]?.type === "citation") {
      // The richer annotation form wins over the bare legacy url.
      expect(citations[0].citation).toEqual({
        url: "https://example.com/x",
        title: "X",
        startIndex: 0,
        endIndex: 5,
      });
    }
  });

  it("maps finish_reason length → incomplete", async () => {
    const chunks = [
      {
        id: "gen-2",
        choices: [{ index: 0, delta: { content: "partial" }, finish_reason: "length" }],
      },
    ] as unknown as ChatCompletionChunk[];
    const events = await drain(normalizeOpenRouterResearchStream(replay(chunks)));
    const done = events.at(-1);
    if (done?.type === "done") {
      expect(done.result.status).toBe("incomplete");
    }
  });

  it("tolerates empty-delta keep-alive-adjacent chunks", async () => {
    const chunks = [
      { id: "g", choices: [{ index: 0, delta: {}, finish_reason: null }] },
      { id: "g", choices: [{ index: 0, delta: { content: "hi" }, finish_reason: "stop" }] },
    ] as unknown as ChatCompletionChunk[];
    const events = await drain(normalizeOpenRouterResearchStream(replay(chunks)));
    expect(events.map((e) => e.type)).toEqual(["created", "status", "text", "done"]);
  });
});

describe("OpenRouterProvider research surface", () => {
  function providerWith(create: ReturnType<typeof vi.fn>): OpenRouterProvider {
    const client = { chat: { completions: { create } } } as unknown as OpenAI;
    return new OpenRouterProvider(client, { siteUrl: "https://app.example", appName: "TestApp" });
  }

  it("startResearch streams with mandatory stream:true, long timeout, and analytics headers", async () => {
    const create = vi.fn().mockResolvedValue(replay(FIXTURE));
    const provider = providerWith(create);

    const events = await drain(
      provider.startResearch(
        { ...BASE_OPTIONS, reasoning: { enabled: true, effort: "high" } },
        { provider: "openrouter", name: "perplexity/sonar-deep-research" },
        getOpenRouterResearchModelSpec("perplexity/sonar-deep-research"),
      ),
    );

    expect(create).toHaveBeenCalledOnce();
    const [request, requestOptions] = create.mock.calls[0] ?? [];
    expect(request).toMatchObject({
      model: "perplexity/sonar-deep-research",
      stream: true,
      stream_options: { include_usage: true },
      usage: { include: true },
      reasoning: { effort: "high" },
    });
    expect(requestOptions).toMatchObject({
      timeout: 3_600_000,
      headers: { "HTTP-Referer": "https://app.example", "X-Title": "TestApp" },
    });
    expect(events.at(-1)?.type).toBe("done");
  });

  it("extra cannot clobber mandatory streaming or core request keys", async () => {
    const create = vi.fn().mockResolvedValue(replay(FIXTURE));
    const provider = providerWith(create);

    await drain(
      provider.startResearch(
        {
          ...BASE_OPTIONS,
          extra: {
            stream: false,
            stream_options: null,
            model: "other/model",
            usage: { include: false },
            web_search_options: { search_context_size: "low" },
          },
        },
        { provider: "openrouter", name: "perplexity/sonar-deep-research" },
        getOpenRouterResearchModelSpec("perplexity/sonar-deep-research"),
      ),
    );

    const [request] = create.mock.calls[0] ?? [];
    expect(request).toMatchObject({
      model: "perplexity/sonar-deep-research",
      stream: true,
      stream_options: { include_usage: true },
      usage: { include: true },
      // Non-core extra keys still pass through.
      web_search_options: { search_context_size: "low" },
    });
  });

  it("does not implement resume/status/cancel (money-safety)", () => {
    const provider = providerWith(vi.fn());
    expect(provider.resumeResearch).toBeUndefined();
    expect(provider.getResearchStatus).toBeUndefined();
    expect(provider.cancelResearch).toBeUndefined();
  });

  it("a job's toRef() throws and a stream drop is a non-retryable error, never a re-run", async () => {
    const dropped = FIXTURE.slice(0, 3);
    async function* dropAfter(): AsyncGenerator<ChatCompletionChunk> {
      yield* replay(dropped);
      throw new Error("ECONNRESET: stream dropped");
    }
    const create = vi.fn().mockResolvedValue(dropAfter());
    const provider = providerWith(create);

    const ns = new ResearchNamespace([provider], new ModelIdentifierParser("openrouter"));
    const job = ns.start(BASE_OPTIONS);
    const events = await drain(job as AsyncIterable<ResearchEvent>);

    const last = events.at(-1);
    expect(last?.type).toBe("error");
    if (last?.type === "error") {
      expect(last.error.retryable).toBe(false);
    }
    expect(create).toHaveBeenCalledTimes(1); // never re-ran the paid request
    expect(() => job.toRef()).toThrow(ResearchJobNotResumableError);
  });
});
