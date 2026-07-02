/**
 * Gemini deep research via the Interactions API (`client.interactions.*`).
 *
 * Deep research is exclusive to the Interactions API — it cannot run through
 * generateContent. Runs are agents (`agent` field), background execution is
 * mandatory, streams resume via `last_event_id`, and follow-ups chain through
 * `previous_interaction_id`.
 *
 * Transport is isolated behind small functions consuming/returning the SDK's
 * `InteractionSSEEvent` stream so a raw-fetch SSE fallback can be swapped in
 * if the preview API drifts from the installed SDK.
 */

import type { GoogleGenAI, Interactions } from "@google/genai";
import { isAbortError } from "../core/errors.js";
import { extractRetryAfterMs, isRetryableError } from "../core/retry.js";
import {
  GEMINI_RESEARCH_MAX_DURATION_MS,
  RESEARCH_POLL_INTERVAL_MS,
} from "../research/constants.js";
import { ResearchValidationError } from "../research/errors.js";
import type { ResearchModelSpec } from "../research/model-spec.js";
import type {
  ResearchCitation,
  ResearchEvent,
  ResearchJobRef,
  ResearchOptions,
  ResearchStatus,
  ResearchStatusSnapshot,
  ResearchUsage,
} from "../research/types.js";

type InteractionSSEEvent = Interactions.InteractionSSEEvent;
type Interaction = Interactions.Interaction;
type ContentDelta = Interactions.ContentDelta;
type Annotation = Interactions.Annotation;

/** Retries for the create call (no interaction exists yet — safe). */
const GEMINI_RESEARCH_CREATE_MAX_RETRIES = 3;

// =============================================================================
// Request building
// =============================================================================

interface GeminiAgentRequest {
  agent: string;
  input: string;
  background: boolean;
  store: boolean;
  agent_config: { type: "deep-research"; thinking_summaries: "auto" | "none" };
  system_instruction?: string;
  previous_interaction_id?: string;
  [key: string]: unknown;
}

/**
 * Build the Interactions create request. Background execution is mandatory
 * for deep research — an explicit `background: false` is rejected.
 */
export function buildGeminiResearchRequest(
  options: ResearchOptions,
  agentId: string,
): GeminiAgentRequest {
  if (options.background === false) {
    throw new ResearchValidationError(
      "Gemini deep research requires background execution — background: false is not supported.",
    );
  }

  return {
    agent: agentId,
    input: options.query,
    background: true,
    store: true,
    agent_config: {
      type: "deep-research",
      thinking_summaries: options.reasoning?.includeThinking === false ? "none" : "auto",
    },
    ...(options.systemPrompt ? { system_instruction: options.systemPrompt } : {}),
    ...(options.previousJobId ? { previous_interaction_id: options.previousJobId } : {}),
    ...(options.extra ?? {}),
  };
}

// =============================================================================
// Interaction → result extraction (poll/status paths)
// =============================================================================

const GEMINI_STATUS_VALUES: ReadonlySet<ResearchStatus> = new Set([
  "queued",
  "in_progress",
  "requires_action",
  "completed",
  "failed",
  "cancelled",
  "incomplete",
  "budget_exceeded",
]);

export function mapInteractionStatus(status: string | undefined | null): ResearchStatus {
  if (status && GEMINI_STATUS_VALUES.has(status as ResearchStatus)) {
    return status as ResearchStatus;
  }
  return "in_progress";
}

function annotationToCitation(annotation: Annotation): ResearchCitation | undefined {
  if (!annotation.source) return undefined;
  return {
    url: annotation.source,
    startIndex: annotation.start_index,
    endIndex: annotation.end_index,
  };
}

interface ExtractedReport {
  report: string;
  citations: ResearchCitation[];
}

/** Pull report text + citations out of a completed interaction's outputs. */
export function extractReportFromInteraction(interaction: Interaction): ExtractedReport {
  const parts: string[] = [];
  const citations: ResearchCitation[] = [];
  for (const content of interaction.outputs ?? []) {
    if (content.type !== "text") continue;
    parts.push(content.text);
    for (const annotation of content.annotations ?? []) {
      const citation = annotationToCitation(annotation);
      if (citation) citations.push(citation);
    }
  }
  return { report: parts.join(""), citations };
}

/**
 * Map an interaction's token usage to {@link ResearchUsage}.
 *
 * The SDK `Usage` has no search-count field, and `interaction.complete` carries
 * empty `outputs`, so the completed google-search count can only be derived by
 * tallying `google_search_result` deltas off the stream; pass that tally as
 * `searches` so per-search pricing (`perThousandSearches`) applies. Omitted on
 * the status-poll path where the stream — and thus the count — is unavailable.
 */
export function usageFromInteraction(interaction: Interaction, searches?: number): ResearchUsage {
  const usage = interaction.usage;
  return {
    inputTokens: usage?.total_input_tokens ?? 0,
    outputTokens: usage?.total_output_tokens ?? 0,
    totalTokens: usage?.total_tokens ?? 0,
    cachedInputTokens: usage?.total_cached_tokens,
    reasoningTokens: usage?.total_thought_tokens,
    ...(searches !== undefined ? { searches } : {}),
  };
}

function doneEventFromInteraction(interaction: Interaction, searches?: number): ResearchEvent {
  const { report, citations } = extractReportFromInteraction(interaction);
  return {
    type: "done",
    result: {
      status: mapInteractionStatus(interaction.status),
      report,
      citations,
      usage: usageFromInteraction(interaction, searches),
      raw: interaction,
    },
  };
}

// =============================================================================
// Stream normalization
// =============================================================================

/**
 * Normalize an Interactions SSE stream into research events.
 * Every event's `cursor` is its `event_id` (the `last_event_id` resume token).
 */
export async function* normalizeInteractionsStream(
  stream: AsyncIterable<InteractionSSEEvent>,
): AsyncGenerator<ResearchEvent> {
  // The SDK never reports a search count, so tally completed google searches
  // off the stream (see usageFromInteraction) to drive per-search pricing.
  let searchCount = 0;
  for await (const event of stream) {
    const cursor = event.event_id;

    switch (event.event_type) {
      case "interaction.start":
        yield { type: "created", jobId: event.interaction.id, cursor, rawEvent: event };
        yield { type: "status", status: mapInteractionStatus(event.interaction.status), cursor };
        break;

      case "interaction.status_update":
        yield {
          type: "status",
          status: mapInteractionStatus(event.status),
          cursor,
          rawEvent: event,
        };
        break;

      case "content.start": {
        const contentType = event.content?.type;
        if (contentType === "thought") {
          yield { type: "phase", phase: "reasoning", cursor, rawEvent: event };
        } else if (contentType === "text") {
          yield { type: "phase", phase: "writing", cursor, rawEvent: event };
        } else if (contentType === "google_search_call") {
          yield { type: "phase", phase: "searching", cursor, rawEvent: event };
        }
        break;
      }

      case "content.delta":
        if ((event.delta as { type?: string }).type === "google_search_result") {
          searchCount += 1;
        }
        yield* normalizeDelta(event, cursor);
        break;

      case "content.stop":
        break;

      case "interaction.complete":
        yield {
          type: "usage",
          usage: usageFromInteraction(event.interaction, searchCount),
          cursor,
          rawEvent: event,
        };
        yield { ...doneEventFromInteraction(event.interaction, searchCount), cursor };
        break;

      case "error":
        yield {
          type: "error",
          error: {
            message: event.error?.message ?? "Gemini interaction error",
            code: event.error?.code !== undefined ? String(event.error.code) : undefined,
            retryable: isRetryableError(new Error(event.error?.message ?? "")),
          },
          cursor,
          rawEvent: event,
        };
        break;

      default: {
        // Defensive: preview docs are inconsistent (e.g. "interaction.error").
        const type = (event as { event_type?: string }).event_type ?? "";
        if (type.endsWith("error")) {
          const err = (event as { error?: { message?: string } }).error;
          yield {
            type: "error",
            error: { message: err?.message ?? "Gemini interaction error", retryable: false },
            cursor,
            rawEvent: event,
          };
        }
        break;
      }
    }
  }
}

function* normalizeDelta(
  event: Extract<InteractionSSEEvent, { event_type: "content.delta" }>,
  cursor: string | undefined,
): Generator<ResearchEvent> {
  // Widened to a plain discriminator: the preview API emits shapes the SDK
  // union doesn't know yet (e.g. docs show "thought" for "thought_summary").
  const delta = event.delta as { type: string };

  switch (delta.type) {
    case "text": {
      const textDelta = delta as unknown as { text: string; annotations?: Annotation[] };
      yield { type: "text", delta: textDelta.text, cursor, rawEvent: event };
      for (const annotation of textDelta.annotations ?? []) {
        const citation = annotationToCitation(annotation);
        if (citation) {
          yield { type: "citation", citation, cursor };
        }
      }
      break;
    }

    // The SDK emits "thought_summary"; some preview docs show "thought" —
    // handle both defensively.
    case "thought_summary":
    case "thought": {
      const thought = delta as unknown as { content?: { type?: string; text?: string } };
      const text = thought.content?.type === "text" ? (thought.content.text ?? "") : "";
      if (text.length > 0) {
        yield { type: "thinking", delta: text, cursor, rawEvent: event };
      }
      break;
    }

    case "thought_signature":
      break;

    case "google_search_call": {
      const call = delta as unknown as { arguments?: { queries?: string[] } };
      yield {
        type: "search",
        action: "search",
        status: "started",
        query: call.arguments?.queries?.join("; "),
        cursor,
        rawEvent: event,
      };
      break;
    }

    case "google_search_result": {
      const result = delta as unknown as { result?: Array<{ url?: string }> };
      yield {
        type: "search",
        action: "search",
        status: "completed",
        url: result.result?.[0]?.url,
        cursor,
        rawEvent: event,
      };
      break;
    }

    case "url_context_call": {
      // SDK 1.43.0: URLContextCallArguments is `{ urls?: string[] }` (plural array).
      const call = delta as unknown as { arguments?: { urls?: string[] } };
      yield {
        type: "search",
        action: "open_page",
        status: "started",
        url: call.arguments?.urls?.[0],
        cursor,
        rawEvent: event,
      };
      break;
    }
    case "url_context_result":
      yield { type: "search", action: "open_page", status: "completed", cursor, rawEvent: event };
      break;

    case "code_execution_call":
      yield { type: "tool", tool: "code_interpreter", status: "started", cursor, rawEvent: event };
      break;
    case "code_execution_result":
      yield {
        type: "tool",
        tool: "code_interpreter",
        status: "completed",
        cursor,
        rawEvent: event,
      };
      break;

    case "file_search_call":
      yield { type: "tool", tool: "file_search", status: "started", cursor, rawEvent: event };
      break;
    case "file_search_result":
      yield { type: "tool", tool: "file_search", status: "completed", cursor, rawEvent: event };
      break;

    case "mcp_server_tool_call":
      yield { type: "tool", tool: "mcp", status: "started", cursor, rawEvent: event };
      break;
    case "mcp_server_tool_result":
      yield { type: "tool", tool: "mcp", status: "completed", cursor, rawEvent: event };
      break;

    default:
      break;
  }
}

// =============================================================================
// Lifecycle: start / resume / status / cancel
// =============================================================================

function abortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    (timer as { unref?: () => void }).unref?.();
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function withRetries<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  signal?: AbortSignal,
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (isAbortError(err) || !isRetryableError(err) || attempt >= maxRetries) {
        throw err;
      }
      attempt += 1;
      await sleep(extractRetryAfterMs(err) ?? RESEARCH_POLL_INTERVAL_MS, signal);
    }
  }
}

const requestOptions = (signal?: AbortSignal) => ({
  timeout: GEMINI_RESEARCH_MAX_DURATION_MS,
  signal,
  // The SDK's own retries would fight llmist's retry policy.
  maxRetries: 0,
});

type InteractionsClient = GoogleGenAI & { interactions: Interactions };

/** Start a deep research interaction as a normalized event stream. */
export function startGeminiResearch(
  client: GoogleGenAI,
  options: ResearchOptions,
  agentId: string,
  _spec: ResearchModelSpec | undefined,
): AsyncIterable<ResearchEvent> {
  const request = buildGeminiResearchRequest(options, agentId);
  return (async function* () {
    const stream = await withRetries(
      () =>
        (client as InteractionsClient).interactions.create(
          { ...request, stream: true } as Parameters<Interactions["create"]>[0],
          requestOptions(options.signal),
        ) as Promise<AsyncIterable<InteractionSSEEvent>>,
      GEMINI_RESEARCH_CREATE_MAX_RETRIES,
      options.signal,
    );
    yield* normalizeInteractionsStream(stream);
  })();
}

/** Resume a background interaction stream from the ref's `last_event_id`. */
export function resumeGeminiResearch(
  client: GoogleGenAI,
  ref: ResearchJobRef,
  signal?: AbortSignal,
): AsyncIterable<ResearchEvent> {
  return (async function* () {
    const stream = (await (client as InteractionsClient).interactions.get(
      ref.jobId,
      { stream: true, ...(ref.cursor !== undefined ? { last_event_id: ref.cursor } : {}) },
      requestOptions(signal),
    )) as AsyncIterable<InteractionSSEEvent>;
    yield* normalizeInteractionsStream(stream);
  })();
}

function isTerminalStatus(status: ResearchStatus): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "incomplete" ||
    status === "budget_exceeded"
  );
}

/** One-shot status poll; returns the terminal result when available. */
export async function getGeminiResearchStatus(
  client: GoogleGenAI,
  ref: ResearchJobRef,
): Promise<ResearchStatusSnapshot> {
  const interaction = (await (client as InteractionsClient).interactions.get(
    ref.jobId,
  )) as Interaction;
  const status = mapInteractionStatus(interaction.status);
  if (!isTerminalStatus(status)) {
    return { status };
  }
  const { report, citations } = extractReportFromInteraction(interaction);
  return {
    status,
    result: {
      jobId: interaction.id,
      provider: "gemini",
      model: ref.model,
      status,
      report,
      citations,
      usage: usageFromInteraction(interaction),
      raw: interaction,
    },
  };
}

export async function cancelGeminiResearch(
  client: GoogleGenAI,
  ref: ResearchJobRef,
): Promise<void> {
  await (client as InteractionsClient).interactions.cancel(ref.jobId);
}
