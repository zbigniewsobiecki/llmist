/**
 * OpenRouter deep research over chat completions.
 *
 * Research models on OpenRouter (Perplexity Sonar Deep Research, OpenAI's
 * research models) run their agentic loop server-side and stream reasoning
 * followed by the cited report through the ordinary chat-completions SSE
 * surface. Peculiarities handled here:
 *
 * - reasoning arrives as `delta.reasoning` and/or `delta.reasoning_details[]`
 *   (both may be present — details win to avoid double-emitting)
 * - citations arrive as `annotations[].url_citation` (delta or final message)
 *   AND/OR a legacy top-level `citations: [urls]` array — read both, dedupe
 * - keep-alive comment lines (`: OPENROUTER PROCESSING`) are stripped by the
 *   openai SDK's SSE parser before chunks reach us
 * - there is no job id: `created` carries `jobId: null`, refs/resume are
 *   unavailable, and a dropped stream is surfaced as a non-retryable error
 */

import type { ChatCompletionChunk } from "openai/resources/chat/completions";
import { ResearchValidationError } from "../research/errors.js";
import type {
  ResearchCitation,
  ResearchEvent,
  ResearchOptions,
  ResearchStatus,
  ResearchUsage,
} from "../research/types.js";

// =============================================================================
// Request building
// =============================================================================

export interface OpenRouterResearchMessages {
  messages: Array<{ role: "system" | "user"; content: string }>;
}

/**
 * Validate research options for the OpenRouter surface and produce the chat
 * messages. (The full request is assembled by the provider, which owns
 * headers, reasoning mapping, and extra handling.)
 */
export function buildOpenRouterResearchMessages(
  options: ResearchOptions,
): OpenRouterResearchMessages {
  if (options.background === true) {
    throw new ResearchValidationError(
      "OpenRouter has no background mode for research runs — the stream must stay open.",
    );
  }
  if (options.tools !== undefined && options.tools.length > 0) {
    throw new ResearchValidationError(
      "OpenRouter research models manage their tools server-side — omit the tools option.",
    );
  }

  const messages: OpenRouterResearchMessages["messages"] = [];
  if (options.systemPrompt) {
    messages.push({ role: "system", content: options.systemPrompt });
  }
  messages.push({ role: "user", content: options.query });
  return { messages };
}

// =============================================================================
// Chunk normalization
// =============================================================================

/** Extended delta shape OpenRouter emits beyond the OpenAI typings. */
interface OpenRouterDelta {
  content?: string | null;
  reasoning?: string | null;
  reasoning_details?: Array<{ type?: string; text?: string }>;
  annotations?: OpenRouterAnnotation[];
}

interface OpenRouterAnnotation {
  type?: string;
  url_citation?: {
    url?: string;
    title?: string;
    content?: string;
    start_index?: number;
    end_index?: number;
  };
}

/** Extended chunk shape: legacy top-level citations + usage extras. */
interface OpenRouterChunkExtras {
  citations?: string[];
  usage?: ChatCompletionChunk["usage"] & {
    num_search_queries?: number;
    server_tool_use?: { web_search_requests?: number };
    /** OpenRouter usage accounting: authoritative billed cost in USD credits
     *  (requires `usage: {include: true}` on the request). Covers per-search
     *  and reasoning fees our token-based estimate cannot see. */
    cost?: number;
  };
}

function citationKey(citation: ResearchCitation): string {
  return `${citation.url}#${citation.startIndex ?? ""}`;
}

function mapFinishReason(reason: string | null | undefined): ResearchStatus {
  switch (reason) {
    case "length":
      return "incomplete";
    case "error":
      return "failed";
    default:
      return "completed";
  }
}

/**
 * Normalize an OpenRouter chat-completions chunk stream into research events.
 * No cursors — OpenRouter research runs are not resumable.
 */
export async function* normalizeOpenRouterResearchStream(
  stream: AsyncIterable<ChatCompletionChunk>,
): AsyncGenerator<ResearchEvent> {
  let createdEmitted = false;
  const seenCitations = new Set<string>();
  // Legacy top-level citations are bare urls — dedupe those by url alone.
  const seenCitationUrls = new Set<string>();
  let usage: ResearchUsage | undefined;
  let terminalStatus: ResearchStatus | undefined;
  let lastRaw: unknown;

  for await (const chunk of stream) {
    lastRaw = chunk;
    if (!createdEmitted) {
      createdEmitted = true;
      yield { type: "created", jobId: null, rawEvent: chunk };
      yield { type: "status", status: "in_progress" };
    }

    const choice = chunk.choices?.[0];
    const delta = (choice?.delta ?? {}) as OpenRouterDelta;

    // Reasoning: prefer typed reasoning_details; fall back to the plain
    // reasoning string. Never emit both for the same chunk.
    const detailTexts = (delta.reasoning_details ?? [])
      .filter((detail) => typeof detail.text === "string" && detail.text.length > 0)
      .map((detail) => detail.text as string);
    if (detailTexts.length > 0) {
      for (const text of detailTexts) {
        yield { type: "thinking", delta: text, rawEvent: chunk };
      }
    } else if (typeof delta.reasoning === "string" && delta.reasoning.length > 0) {
      yield { type: "thinking", delta: delta.reasoning, rawEvent: chunk };
    }

    if (typeof delta.content === "string" && delta.content.length > 0) {
      yield { type: "text", delta: delta.content, rawEvent: chunk };
    }

    // Citations: annotations on the delta (and, on some providers, the final
    // message object), deduplicated by url + offset.
    const annotationSources: OpenRouterAnnotation[] = [
      ...(delta.annotations ?? []),
      ...(((choice as { message?: { annotations?: OpenRouterAnnotation[] } } | undefined)?.message
        ?.annotations ?? []) as OpenRouterAnnotation[]),
    ];
    for (const annotation of annotationSources) {
      if (annotation.type !== "url_citation" || !annotation.url_citation?.url) continue;
      const citation: ResearchCitation = {
        url: annotation.url_citation.url,
        title: annotation.url_citation.title,
        content: annotation.url_citation.content,
        startIndex: annotation.url_citation.start_index,
        endIndex: annotation.url_citation.end_index,
      };
      const key = citationKey(citation);
      if (!seenCitations.has(key)) {
        seenCitations.add(key);
        seenCitationUrls.add(citation.url);
        yield { type: "citation", citation, rawEvent: chunk };
      }
    }

    // Legacy top-level citations array (Perplexity passthrough): bare urls,
    // deduplicated against any annotation-derived citation for the same url.
    const legacyCitations = (chunk as OpenRouterChunkExtras).citations;
    if (Array.isArray(legacyCitations)) {
      for (const url of legacyCitations) {
        if (!seenCitationUrls.has(url)) {
          seenCitationUrls.add(url);
          yield { type: "citation", citation: { url }, rawEvent: chunk };
        }
      }
    }

    if (choice?.finish_reason) {
      terminalStatus = mapFinishReason(choice.finish_reason);
    }

    const chunkUsage = (chunk as OpenRouterChunkExtras).usage;
    if (chunkUsage) {
      usage = {
        inputTokens: chunkUsage.prompt_tokens ?? 0,
        outputTokens: chunkUsage.completion_tokens ?? 0,
        totalTokens: chunkUsage.total_tokens ?? 0,
        cachedInputTokens: chunkUsage.prompt_tokens_details?.cached_tokens ?? undefined,
        reasoningTokens: chunkUsage.completion_tokens_details?.reasoning_tokens ?? undefined,
        searches:
          chunkUsage.num_search_queries ??
          chunkUsage.server_tool_use?.web_search_requests ??
          undefined,
        // Authoritative billed cost from OpenRouter usage accounting —
        // preferred over the catalog estimate (collector keeps it).
        costUSD: typeof chunkUsage.cost === "number" ? chunkUsage.cost : undefined,
      };
    }
  }

  if (usage) {
    yield { type: "usage", usage };
  }
  yield {
    type: "done",
    result: {
      status: terminalStatus ?? "completed",
      // Report text was streamed as deltas; the collector joins them.
      report: "",
      usage,
      raw: lastRaw,
    },
  };
}
