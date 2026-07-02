/**
 * Gemini deep research via the Interactions API (`client.interactions.*`).
 *
 * Deep research is exclusive to the Interactions API — it cannot run through
 * generateContent. Runs are agents (`agent` field), background execution is
 * mandatory, streams resume via `last_event_id`, and follow-ups chain through
 * `previous_interaction_id`.
 *
 * Wire schema: the current (May-2026) Interactions schema via
 * `@google/genai` >= 2.x — `interaction.created/completed/status_update`,
 * `step.start/delta/stop` over `steps[]`. The pre-2.0 SDK schema
 * (`interaction.start`, `content.*`, `outputs[]`) is rejected by the live
 * API ("The legacy Interactions API schema is no longer supported").
 *
 * Transport is isolated behind small functions consuming/returning the SDK's
 * `InteractionSSEEvent` stream so a raw-fetch SSE fallback can be swapped in
 * if the preview API drifts from the installed SDK again.
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
type Step = Interactions.Step;
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
  if (annotation.type !== "url_citation" || !annotation.url) return undefined;
  return {
    url: annotation.url,
    title: annotation.title,
    startIndex: annotation.start_index,
    endIndex: annotation.end_index,
  };
}

interface ExtractedReport {
  report: string;
  citations: ResearchCitation[];
}

/** Pull report text + citations out of an interaction's model_output steps. */
export function extractReportFromInteraction(interaction: Interaction): ExtractedReport {
  const parts: string[] = [];
  const citations: ResearchCitation[] = [];
  for (const step of interaction.steps ?? []) {
    if (step.type !== "model_output") continue;
    for (const content of step.content ?? []) {
      if (content.type !== "text") continue;
      parts.push(content.text);
      for (const annotation of content.annotations ?? []) {
        const citation = annotationToCitation(annotation);
        if (citation) citations.push(citation);
      }
    }
  }
  return { report: parts.join(""), citations };
}

/**
 * Count search queries in an interaction's steps (poll/status path).
 * The SDK's Usage carries no search count, so this client-side count is what
 * makes the catalog's perThousandSearches pricing apply to Gemini runs. Each
 * google_search_call may fan out multiple queries; count queries, not calls.
 */
function countSearchesInSteps(interaction: Interaction): number {
  let searches = 0;
  for (const step of interaction.steps ?? []) {
    if (step.type === "google_search_call") {
      searches += step.arguments?.queries?.length ?? 1;
    }
  }
  return searches;
}

/**
 * Map an interaction's usage to ResearchUsage. `streamedSearches` (query
 * fan-out tallied off the stream) takes precedence; the poll/status paths
 * fall back to counting from steps, which a non-stream GET populates.
 */
export function usageFromInteraction(
  interaction: Interaction,
  streamedSearches?: number,
): ResearchUsage {
  const usage = interaction.usage;
  const searches = streamedSearches ?? countSearchesInSteps(interaction);
  return {
    inputTokens: usage?.total_input_tokens ?? 0,
    outputTokens: usage?.total_output_tokens ?? 0,
    totalTokens: usage?.total_tokens ?? 0,
    cachedInputTokens: usage?.total_cached_tokens,
    reasoningTokens: usage?.total_thought_tokens,
    ...(searches > 0 ? { searches } : {}),
  };
}

function doneEventFromInteraction(
  interaction: Interaction,
  streamedSearches?: number,
): ResearchEvent {
  const { report, citations } = extractReportFromInteraction(interaction);
  return {
    type: "done",
    result: {
      status: mapInteractionStatus(interaction.status),
      report,
      citations,
      usage: usageFromInteraction(interaction, streamedSearches),
      raw: interaction,
    },
  };
}

// =============================================================================
// Stream normalization
// =============================================================================

/**
 * Normalize an Interactions SSE stream into research events.
 *
 * Every event's `cursor` is its `event_id` (the `last_event_id` resume
 * token) — when the API populates it. Live agent streams have been observed
 * omitting `event_id` from the data payload (the token rides the SSE `id:`
 * line, which the SDK's flattened stream drops), so cursors may be absent;
 * resume then falls back to a full replay, which is safe.
 *
 * `fetchFinal` covers another live-observed gap: `interaction.completed`
 * embeds an interaction WITHOUT `usage` or `steps`. When provided, the
 * stored interaction is fetched (a free GET) for authoritative usage and
 * report/citations; on fetch failure the embedded payload is used as-is.
 */
export async function* normalizeInteractionsStream(
  stream: AsyncIterable<InteractionSSEEvent>,
  fetchFinal?: (id: string) => Promise<Interaction>,
): AsyncGenerator<ResearchEvent> {
  // The SDK never reports a search count, and the stream's terminal payload
  // carries no steps — tally query fan-out off the stream so the catalog's
  // perThousandSearches pricing applies. Guarded per step index so a
  // google_search_call arriving as BOTH step.start and a delta counts once.
  let streamedSearches = 0;
  const countedSearchSteps = new Set<number>();

  // The lifecycle events carry a partial interaction; SSE-event interactions
  // and full Interactions are structurally compatible for our extractors.
  type LifecycleInteraction = Interaction;

  let interactionId: string | undefined;

  for await (const event of stream) {
    const cursor = event.event_id;

    switch (event.event_type) {
      case "interaction.created": {
        const interaction = event.interaction as LifecycleInteraction;
        interactionId = interaction.id;
        yield { type: "created", jobId: interaction.id, cursor, rawEvent: event };
        yield { type: "status", status: mapInteractionStatus(interaction.status), cursor };
        break;
      }

      case "interaction.status_update":
        yield {
          type: "status",
          status: mapInteractionStatus(event.status),
          cursor,
          rawEvent: event,
        };
        break;

      case "step.start": {
        const step = event.step as Step;
        if (step.type === "thought") {
          yield { type: "phase", phase: "reasoning", cursor, rawEvent: event };
        } else if (step.type === "model_output") {
          yield { type: "phase", phase: "writing", cursor, rawEvent: event };
        } else if (step.type === "google_search_call") {
          if (!countedSearchSteps.has(event.index)) {
            countedSearchSteps.add(event.index);
            streamedSearches += step.arguments?.queries?.length ?? 1;
          }
          yield { type: "phase", phase: "searching", cursor, rawEvent: event };
          yield {
            type: "search",
            action: "search",
            status: "started",
            query: step.arguments?.queries?.join("; "),
            cursor,
          };
        } else if (step.type === "google_search_result") {
          yield { type: "search", action: "search", status: "completed", cursor, rawEvent: event };
        }
        break;
      }

      case "step.delta":
        yield* normalizeDelta(event, cursor, (queries) => {
          if (!countedSearchSteps.has(event.index)) {
            countedSearchSteps.add(event.index);
            streamedSearches += queries;
          }
        });
        break;

      case "step.stop":
        break;

      case "interaction.completed": {
        let interaction = event.interaction as LifecycleInteraction;
        const finalId = interaction.id ?? interactionId;
        if (fetchFinal && finalId !== undefined && !interaction.usage?.total_tokens) {
          try {
            interaction = await fetchFinal(finalId);
          } catch {
            // Free authoritative GET failed — the embedded payload still
            // yields a valid (if usage-less) terminal sequence.
          }
        }
        const searches = streamedSearches > 0 ? streamedSearches : undefined;
        yield {
          type: "usage",
          usage: usageFromInteraction(interaction, searches),
          cursor,
          rawEvent: event,
        };
        yield { ...doneEventFromInteraction(interaction, searches), cursor };
        break;
      }

      case "error":
        // A client_closed_request marker records a PREVIOUS consumer's
        // disconnect in the interaction's event log — it can never describe
        // the current consumer, who is provably connected (reading it).
        // Replay streams opened after a disconnect end with this marker
        // instead of interaction.completed (live-observed); surfacing it
        // would mark a healthy run as failed.
        if (event.error?.code === "client_closed_request") break;
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
  event: Extract<InteractionSSEEvent, { event_type: "step.delta" }>,
  cursor: string | undefined,
  onSearchCall: (queries: number) => void,
): Generator<ResearchEvent> {
  // Widened to a plain discriminator: the preview API has emitted shapes the
  // SDK union didn't know yet (e.g. docs once showed "thought" for
  // "thought_summary").
  const delta = event.delta as { type: string };

  switch (delta.type) {
    case "text": {
      const textDelta = delta as unknown as { text: string };
      yield { type: "text", delta: textDelta.text, cursor, rawEvent: event };
      break;
    }

    // Citations arrive as dedicated annotation deltas in the current schema.
    case "text_annotation_delta": {
      const annotationDelta = delta as unknown as { annotations?: Annotation[] };
      for (const annotation of annotationDelta.annotations ?? []) {
        const citation = annotationToCitation(annotation);
        if (citation) {
          yield { type: "citation", citation, cursor, rawEvent: event };
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
      onSearchCall(call.arguments?.queries?.length ?? 1);
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
      // SDK shape: URLContextCallArguments = { urls?: string[] } (plural).
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

/** Structural view of the SDK's interactions client (methods we use). */
interface InteractionsApi {
  create(params: unknown, options?: unknown): Promise<unknown>;
  get(id: string, params?: unknown, options?: unknown): Promise<unknown>;
  cancel(id: string, params?: unknown, options?: unknown): Promise<unknown>;
}

type InteractionsClient = GoogleGenAI & { interactions: InteractionsApi };

/** Fetch the stored interaction — authoritative usage/steps for terminal events. */
const finalInteractionFetcher =
  (client: GoogleGenAI, signal?: AbortSignal) =>
  (id: string): Promise<Interaction> =>
    (client as InteractionsClient).interactions.get(
      id,
      undefined,
      requestOptions(signal),
    ) as Promise<Interaction>;

/**
 * Follow a normalized stream and, when it ends without a `done` event, poll
 * the stored interaction to a terminal state and emit the real terminal
 * sequence. LIVE-observed: replay streams opened after a client disconnect
 * end with a client_closed_request marker instead of interaction.completed,
 * while the interaction itself runs to completion server-side.
 */
async function* withTerminalReconciliation(
  events: AsyncIterable<ResearchEvent>,
  client: GoogleGenAI,
  jobIdHint: string | undefined,
  signal?: AbortSignal,
): AsyncGenerator<ResearchEvent> {
  let jobId = jobIdHint;
  let sawDone = false;
  for await (const event of events) {
    if (event.type === "created" && event.jobId !== null) jobId = event.jobId;
    if (event.type === "done") sawDone = true;
    yield event;
  }
  if (sawDone || jobId === undefined) return;

  const fetchInteraction = finalInteractionFetcher(client, signal);
  while (true) {
    const interaction = await fetchInteraction(jobId);
    const status = mapInteractionStatus(interaction.status);
    yield { type: "status", status };
    if (isTerminalStatus(status)) {
      yield { type: "usage", usage: usageFromInteraction(interaction) };
      yield doneEventFromInteraction(interaction);
      return;
    }
    await sleep(RESEARCH_POLL_INTERVAL_MS, signal);
  }
}

/**
 * Start a deep research interaction as a normalized event stream.
 *
 * Create is deliberately NOT streamed. LIVE-observed: a streaming create
 * ties the background interaction's fate to that HTTP connection — when the
 * create stream disconnects (client abort, network drop), the API cancels
 * the whole run with `client_closed_request` at its next agent checkpoint,
 * even though status polls keep reporting in_progress in the meantime. That
 * silently breaks the abort≠cancel guarantee and burns the run's spend.
 * A plain create returns once the interaction is registered; events then
 * come from a separate GET stream, which is designed to be dropped and
 * resumed (`last_event_id`).
 */
export function startGeminiResearch(
  client: GoogleGenAI,
  options: ResearchOptions,
  agentId: string,
  _spec: ResearchModelSpec | undefined,
): AsyncIterable<ResearchEvent> {
  const request = buildGeminiResearchRequest(options, agentId);
  return (async function* () {
    const interaction = (await withRetries(
      () =>
        (client as InteractionsClient).interactions.create(request, requestOptions(options.signal)),
      GEMINI_RESEARCH_CREATE_MAX_RETRIES,
      options.signal,
    )) as Interaction;

    if (interaction.id === undefined) {
      throw new Error(
        "Gemini interactions.create returned no interaction id — cannot stream events.",
      );
    }

    yield { type: "created", jobId: interaction.id, rawEvent: interaction };
    yield { type: "status", status: mapInteractionStatus(interaction.status) };

    const stream = (await (client as InteractionsClient).interactions.get(
      interaction.id,
      { stream: true },
      requestOptions(options.signal),
    )) as AsyncIterable<InteractionSSEEvent>;

    // The GET stream replays from the beginning, including interaction.created —
    // drop the duplicate (created was already emitted from the create response).
    for await (const event of withTerminalReconciliation(
      normalizeInteractionsStream(stream, finalInteractionFetcher(client, options.signal)),
      client,
      interaction.id,
      options.signal,
    )) {
      if (event.type === "created") continue;
      yield event;
    }
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

/** Resume a background interaction stream from the ref's `last_event_id`. */
export function resumeGeminiResearch(
  client: GoogleGenAI,
  ref: ResearchJobRef,
  signal?: AbortSignal,
): AsyncIterable<ResearchEvent> {
  return (async function* () {
    // Status-first: a job that finished while detached may have nothing left
    // to stream (OpenAI's stream-resume hangs on terminal responses — apply
    // the same defense here). Emit the terminal sequence from steps instead.
    const current = (await (client as InteractionsClient).interactions.get(
      ref.jobId,
      undefined,
      requestOptions(signal),
    )) as Interaction;
    const status = mapInteractionStatus(current.status);
    if (isTerminalStatus(status)) {
      yield { type: "status", status };
      const { report, citations } = extractReportFromInteraction(current);
      if (report.length > 0) {
        yield { type: "text", delta: report };
      }
      for (const citation of citations) {
        yield { type: "citation", citation };
      }
      yield { type: "usage", usage: usageFromInteraction(current) };
      yield doneEventFromInteraction(current);
      return;
    }

    const stream = (await (client as InteractionsClient).interactions.get(
      ref.jobId,
      { stream: true, ...(ref.cursor !== undefined ? { last_event_id: ref.cursor } : {}) },
      requestOptions(signal),
    )) as AsyncIterable<InteractionSSEEvent>;
    yield* withTerminalReconciliation(
      normalizeInteractionsStream(stream, finalInteractionFetcher(client, signal)),
      client,
      ref.jobId,
      signal,
    );
  })();
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
