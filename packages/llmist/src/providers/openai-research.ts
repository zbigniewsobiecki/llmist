/**
 * OpenAI deep research via the Responses API.
 *
 * Generic Responses-API job client: create (with `background`), poll,
 * stream, stream-resume (`starting_after`), cancel — plus the normalizer
 * from Responses SSE events to the llmist `ResearchEvent` union.
 *
 * Deep research is NOT available on Chat Completions; requests must include
 * at least one data-source tool and use `web_search_preview` (the GA
 * `web_search` tool type breaks research models).
 */

import type OpenAI from "openai";
import type {
  Response,
  ResponseCreateParamsBase,
  ResponseStreamEvent,
  Tool,
} from "openai/resources/responses/responses";
import { isAbortError } from "../core/errors.js";
import { extractRetryAfterMs, isRetryableError } from "../core/retry.js";
import {
  OPENAI_RESEARCH_HTTP_TIMEOUT_MS,
  RESEARCH_POLL_BACKOFF_FACTOR,
  RESEARCH_POLL_INTERVAL_MS,
  RESEARCH_POLL_MAX_INTERVAL_MS,
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

/** OpenAI file_search accepts at most this many vector stores. */
const OPENAI_FILE_SEARCH_MAX_VECTOR_STORES = 2;

/** Retries for the create call (no job exists yet — safe to retry). */
const OPENAI_RESEARCH_CREATE_MAX_RETRIES = 3;

/** Retries per poll request (idempotent GET — retried generously). */
const OPENAI_RESEARCH_POLL_MAX_RETRIES = 5;

// =============================================================================
// Request building
// =============================================================================

/** Map llmist research tools to Responses API tool shapes. */
function buildTools(options: ResearchOptions): Tool[] {
  const tools: Tool[] = [];
  for (const tool of options.tools ?? []) {
    switch (tool.type) {
      case "web_search":
        // NOT the GA "web_search" type — research models require the preview type.
        tools.push({ type: "web_search_preview" } as Tool);
        break;
      case "file_search":
        if (tool.vectorStoreIds.length > OPENAI_FILE_SEARCH_MAX_VECTOR_STORES) {
          throw new ResearchValidationError(
            `OpenAI file_search accepts at most ${OPENAI_FILE_SEARCH_MAX_VECTOR_STORES} vector stores ` +
              `(got ${tool.vectorStoreIds.length}).`,
          );
        }
        tools.push({ type: "file_search", vector_store_ids: tool.vectorStoreIds } as Tool);
        break;
      case "mcp":
        tools.push({
          type: "mcp",
          server_label: tool.serverLabel,
          server_url: tool.serverUrl,
          require_approval: tool.requireApproval ?? "never",
        } as Tool);
        break;
      case "code_interpreter":
        tools.push({ type: "code_interpreter", container: { type: "auto" } } as Tool);
        break;
    }
  }
  return tools;
}

/**
 * Build the Responses API request for a research run.
 * The namespace validates tools/background against the catalog spec before
 * this is called; this builder enforces OpenAI-specific constraints.
 */
export function buildResponsesResearchRequest(
  options: ResearchOptions,
  spec: ResearchModelSpec | undefined,
  modelId: string,
): ResponseCreateParamsBase {
  const tools = buildTools(options);
  const hasDataSource = (options.tools ?? []).some((tool) =>
    ["web_search", "file_search", "mcp"].includes(tool.type),
  );
  if (!hasDataSource) {
    throw new ResearchValidationError(
      "OpenAI deep research requires at least one data-source tool " +
        "(web_search, file_search, or mcp).",
    );
  }

  const background = options.background ?? spec?.capabilities.background ?? true;
  // Deep research has no system role — fold the system prompt into the input.
  const input = options.systemPrompt
    ? `${options.systemPrompt}\n\n${options.query}`
    : options.query;

  const request: ResponseCreateParamsBase = {
    model: modelId,
    input,
    background,
    // Background mode requires stored responses; polling/resume need them too.
    ...(background ? { store: true } : {}),
    reasoning: {
      summary: "auto",
      ...(options.reasoning?.effort && options.reasoning.effort !== "none"
        ? { effort: mapEffort(options.reasoning.effort) }
        : {}),
    },
    tools,
    ...(options.maxToolCalls !== undefined ? { max_tool_calls: options.maxToolCalls } : {}),
    ...((options.extra as Partial<ResponseCreateParamsBase>) ?? {}),
  };
  return request;
}

type OpenAIReasoningEffort = "low" | "medium" | "high" | "xhigh";

function mapEffort(
  effort: NonNullable<ResearchOptions["reasoning"]>["effort"],
): OpenAIReasoningEffort {
  // Mirrors OPENAI_EFFORT_MAP in openai.ts (kept local: research accepts a subset).
  switch (effort) {
    case "maximum":
      return "xhigh";
    case "low":
    case "medium":
    case "high":
      return effort;
    default:
      return "medium";
  }
}

// =============================================================================
// Response → result extraction (shared by stream, poll, and status paths)
// =============================================================================

interface ExtractedReport {
  report: string;
  citations: ResearchCitation[];
}

/** Pull the final report text + url citations out of a Response object. */
export function extractReportFromResponse(response: Response): ExtractedReport {
  const citations: ResearchCitation[] = [];
  const parts: string[] = [];

  for (const item of response.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type !== "output_text") continue;
      parts.push(content.text);
      for (const annotation of content.annotations ?? []) {
        const citation = annotationToCitation(annotation);
        if (citation) citations.push(citation);
      }
    }
  }

  return { report: parts.join(""), citations };
}

function annotationToCitation(annotation: unknown): ResearchCitation | undefined {
  if (typeof annotation !== "object" || annotation === null) return undefined;
  const a = annotation as Record<string, unknown>;
  if (a.type !== "url_citation" || typeof a.url !== "string") return undefined;
  return {
    url: a.url,
    title: typeof a.title === "string" ? a.title : undefined,
    startIndex: typeof a.start_index === "number" ? a.start_index : undefined,
    endIndex: typeof a.end_index === "number" ? a.end_index : undefined,
  };
}

/** Count completed web searches in the response output. */
function countSearches(response: Response): number {
  let searches = 0;
  for (const item of response.output ?? []) {
    if (item.type === "web_search_call") searches += 1;
  }
  return searches;
}

export function usageFromResponse(response: Response): ResearchUsage {
  const usage = response.usage;
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    totalTokens: usage?.total_tokens ?? 0,
    cachedInputTokens: usage?.input_tokens_details?.cached_tokens,
    reasoningTokens: usage?.output_tokens_details?.reasoning_tokens,
    searches: countSearches(response),
  };
}

const STATUS_MAP: Record<string, ResearchStatus> = {
  queued: "queued",
  in_progress: "in_progress",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
  incomplete: "incomplete",
};

export function mapResponseStatus(status: string | undefined | null): ResearchStatus {
  return (status && STATUS_MAP[status]) || "in_progress";
}

function doneEventFromResponse(response: Response): ResearchEvent {
  const { report, citations } = extractReportFromResponse(response);
  return {
    type: "done",
    result: {
      status: mapResponseStatus(response.status),
      report,
      citations,
      usage: usageFromResponse(response),
      raw: response,
    },
  };
}

// =============================================================================
// Stream normalization
// =============================================================================

/**
 * Normalize a Responses SSE event stream into research events.
 * Every event's `cursor` is its stringified `sequence_number` (resume token).
 */
export async function* normalizeResponsesStream(
  stream: AsyncIterable<ResponseStreamEvent>,
): AsyncGenerator<ResearchEvent> {
  // web_search_call items report progress via several events; dedupe "started".
  const searchStarted = new Set<string>();

  for await (const event of stream) {
    const cursor = String(event.sequence_number);

    switch (event.type) {
      case "response.created":
        yield { type: "created", jobId: event.response.id, cursor, rawEvent: event };
        yield { type: "status", status: mapResponseStatus(event.response.status), cursor };
        break;
      case "response.queued":
        yield { type: "status", status: "queued", cursor, rawEvent: event };
        break;
      case "response.in_progress":
        yield { type: "status", status: "in_progress", cursor, rawEvent: event };
        break;

      case "response.output_item.added": {
        const item = event.item;
        if (item.type === "reasoning") {
          yield { type: "phase", phase: "reasoning", cursor, rawEvent: event };
        } else if (item.type === "web_search_call") {
          const action = "action" in item ? item.action : undefined;
          searchStarted.add(item.id);
          yield {
            type: "search",
            action: action?.type ?? "search",
            status: "started",
            query: action && "query" in action ? (action.query ?? undefined) : undefined,
            url: action && "url" in action ? (action.url ?? undefined) : undefined,
            cursor,
            rawEvent: event,
          };
        } else if (item.type === "code_interpreter_call") {
          yield {
            type: "tool",
            tool: "code_interpreter",
            status: "started",
            cursor,
            rawEvent: event,
          };
        } else if (item.type === "file_search_call") {
          yield { type: "tool", tool: "file_search", status: "started", cursor, rawEvent: event };
        } else if (item.type === "mcp_call") {
          yield { type: "tool", tool: "mcp", status: "started", cursor, rawEvent: event };
        } else if (item.type === "message") {
          yield { type: "phase", phase: "writing", cursor, rawEvent: event };
        }
        break;
      }

      case "response.web_search_call.in_progress":
      case "response.web_search_call.searching":
        if (!searchStarted.has(event.item_id)) {
          searchStarted.add(event.item_id);
          yield { type: "search", action: "search", status: "started", cursor, rawEvent: event };
        }
        break;
      case "response.web_search_call.completed":
        yield { type: "search", action: "search", status: "completed", cursor, rawEvent: event };
        break;

      case "response.code_interpreter_call.completed":
        yield {
          type: "tool",
          tool: "code_interpreter",
          status: "completed",
          cursor,
          rawEvent: event,
        };
        break;
      case "response.file_search_call.completed":
        yield { type: "tool", tool: "file_search", status: "completed", cursor, rawEvent: event };
        break;
      case "response.mcp_call.completed":
        yield { type: "tool", tool: "mcp", status: "completed", cursor, rawEvent: event };
        break;

      case "response.reasoning_summary_text.delta":
        yield { type: "thinking", delta: event.delta, cursor, rawEvent: event };
        break;

      case "response.output_text.delta":
        yield { type: "text", delta: event.delta, cursor, rawEvent: event };
        break;

      case "response.output_text.annotation.added": {
        const citation = annotationToCitation(event.annotation);
        if (citation) {
          yield { type: "citation", citation, cursor, rawEvent: event };
        }
        break;
      }

      case "response.completed":
      case "response.failed":
      case "response.incomplete": {
        const response = event.response;
        yield { type: "usage", usage: usageFromResponse(response), cursor, rawEvent: event };
        if (event.type === "response.failed") {
          const message = response.error?.message ?? "OpenAI research run failed";
          yield {
            type: "error",
            error: { message, code: response.error?.code ?? undefined, retryable: false },
            cursor,
          };
        }
        yield { ...doneEventFromResponse(response), cursor };
        break;
      }

      case "error": {
        const err = new Error(event.message ?? "OpenAI stream error");
        yield {
          type: "error",
          error: {
            message: event.message ?? "OpenAI stream error",
            code: event.code ?? undefined,
            retryable: isRetryableError(err),
          },
          cursor,
          rawEvent: event,
        };
        break;
      }

      default: {
        // Terminal statuses without a typed SDK event (e.g. response.cancelled).
        const type = (event as { type: string }).type;
        if (type === "response.cancelled") {
          const response = (event as unknown as { response: Response }).response;
          // Parity with the typed terminal branches: a cancelled run may have
          // accrued token/search usage — cost tracking shouldn't be blind here.
          yield { type: "usage", usage: usageFromResponse(response), cursor, rawEvent: event };
          yield { ...doneEventFromResponse(response), cursor };
        }
        // All other events (content_part boundaries, obfuscation padding,
        // reasoning summary part events, ...) carry no research semantics.
        break;
      }
    }
  }
}

// =============================================================================
// Lifecycle: start / resume / status / cancel
// =============================================================================

/** Abortable sleep. */
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

function abortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

/** Retry helper for idempotent-or-safe calls, honoring Retry-After. */
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
      const retryAfter = extractRetryAfterMs(err);
      await sleep(retryAfter ?? RESEARCH_POLL_INTERVAL_MS, signal);
    }
  }
}

const requestOptions = (signal?: AbortSignal) => ({
  timeout: OPENAI_RESEARCH_HTTP_TIMEOUT_MS,
  signal,
});

/**
 * Start a research run. Streaming specs get a live SSE stream; non-streaming
 * specs (gpt-5.5-pro) run background create + poll with status heartbeats.
 */
export function startOpenAIResearch(
  client: OpenAI,
  options: ResearchOptions,
  modelId: string,
  spec: ResearchModelSpec | undefined,
): AsyncIterable<ResearchEvent> {
  const request = buildResponsesResearchRequest(options, spec, modelId);
  const streaming = spec?.capabilities.streaming ?? true;

  if (streaming) {
    return (async function* () {
      const stream = await withRetries(
        () =>
          client.responses.create(
            { ...request, stream: true },
            requestOptions(options.signal),
          ) as Promise<AsyncIterable<ResponseStreamEvent>>,
        OPENAI_RESEARCH_CREATE_MAX_RETRIES,
        options.signal,
      );
      yield* normalizeResponsesStream(stream);
    })();
  }

  return (async function* () {
    const created = await withRetries(
      () =>
        client.responses.create(
          { ...request, background: true, store: true, stream: false },
          requestOptions(options.signal),
        ) as Promise<Response>,
      OPENAI_RESEARCH_CREATE_MAX_RETRIES,
      options.signal,
    );
    yield { type: "created", jobId: created.id, rawEvent: created } as ResearchEvent;
    yield* pollResponseToCompletion(client, created.id, created, options.signal);
  })();
}

/** Emit the terminal event sequence for a finished response. */
function* emitTerminalResponse(response: Response): Generator<ResearchEvent> {
  const status = mapResponseStatus(response.status);
  const { report, citations } = extractReportFromResponse(response);
  if (report.length > 0) {
    yield { type: "text", delta: report };
  }
  for (const citation of citations) {
    yield { type: "citation", citation };
  }
  yield { type: "usage", usage: usageFromResponse(response) };
  if (status === "failed") {
    yield {
      type: "error",
      error: {
        message: response.error?.message ?? "OpenAI research run failed",
        code: response.error?.code ?? undefined,
        retryable: false,
      },
    };
  }
  yield doneEventFromResponse(response);
}

/**
 * Poll a background response until terminal, emitting status heartbeats and
 * a final text + done. Used by the non-streaming path and poll-mode resume.
 */
async function* pollResponseToCompletion(
  client: OpenAI,
  responseId: string,
  initial: Response | undefined,
  signal?: AbortSignal,
): AsyncGenerator<ResearchEvent> {
  let interval = RESEARCH_POLL_INTERVAL_MS;
  let current = initial;

  while (true) {
    const status = mapResponseStatus(current?.status);
    yield { type: "status", status, rawEvent: current };

    if (current && isTerminalStatus(status)) {
      yield* emitTerminalResponse(current);
      return;
    }

    await sleep(interval, signal);
    interval = Math.min(interval * RESEARCH_POLL_BACKOFF_FACTOR, RESEARCH_POLL_MAX_INTERVAL_MS);
    current = await withRetries(
      () => client.responses.retrieve(responseId, {}, requestOptions(signal)) as Promise<Response>,
      OPENAI_RESEARCH_POLL_MAX_RETRIES,
      signal,
    );
  }
}

function isTerminalStatus(status: ResearchStatus): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "incomplete"
  );
}

/**
 * Re-attach to a background run. Streaming-capable models resume the SSE
 * stream from the ref's cursor (`starting_after`); poll-only models re-enter
 * the poll loop.
 */
export function resumeOpenAIResearch(
  client: OpenAI,
  ref: ResearchJobRef,
  spec: ResearchModelSpec | undefined,
  signal?: AbortSignal,
): AsyncIterable<ResearchEvent> {
  const streaming = spec?.capabilities.streaming ?? true;

  if (streaming) {
    return (async function* () {
      // Status-first: a job that finished while detached has nothing left to
      // stream, and OpenAI's stream-resume HANGS on terminal responses
      // (observed live). Emit the terminal sequence directly in that case.
      const current = await withRetries(
        () => client.responses.retrieve(ref.jobId, {}, requestOptions(signal)) as Promise<Response>,
        OPENAI_RESEARCH_POLL_MAX_RETRIES,
        signal,
      );
      if (isTerminalStatus(mapResponseStatus(current.status))) {
        yield { type: "status", status: mapResponseStatus(current.status) } as ResearchEvent;
        yield* emitTerminalResponse(current);
        return;
      }

      const stream = (await client.responses.retrieve(
        ref.jobId,
        {
          stream: true,
          ...(ref.cursor !== undefined ? { starting_after: Number(ref.cursor) } : {}),
        },
        requestOptions(signal),
      )) as AsyncIterable<ResponseStreamEvent>;
      yield* normalizeResponsesStream(stream);
    })();
  }

  return pollResponseToCompletion(client, ref.jobId, undefined, signal);
}

/** One-shot status poll; returns the terminal result when available. */
export async function getOpenAIResearchStatus(
  client: OpenAI,
  ref: ResearchJobRef,
): Promise<ResearchStatusSnapshot> {
  const response = (await client.responses.retrieve(ref.jobId, {})) as Response;
  const status = mapResponseStatus(response.status);
  if (!isTerminalStatus(status)) {
    return { status };
  }
  const { report, citations } = extractReportFromResponse(response);
  return {
    status,
    result: {
      jobId: response.id,
      provider: "openai",
      model: ref.model,
      status,
      report,
      citations,
      usage: usageFromResponse(response),
      raw: response,
    },
  };
}

export async function cancelOpenAIResearch(client: OpenAI, ref: ResearchJobRef): Promise<void> {
  await client.responses.cancel(ref.jobId);
}
