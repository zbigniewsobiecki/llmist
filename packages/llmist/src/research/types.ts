/**
 * Deep Research — normalized types.
 *
 * Deep research runs are long-lived (minutes to an hour), server-side agentic
 * jobs that browse the web and return cited reports. This module defines the
 * provider-independent surface: options, the normalized event union, the final
 * result, and the serializable job reference used to re-attach to a running
 * background job after a disconnect or process restart.
 */

import type { ReasoningConfig, TokenUsage } from "../core/options.js";
import type { ResearchModelSpec } from "./model-spec.js";

/**
 * Lifecycle status of a research job.
 *
 * Superset of provider statuses:
 * - OpenAI Responses: `queued | in_progress | completed | failed | cancelled | incomplete`
 * - Gemini Interactions adds `requires_action` and `budget_exceeded`
 */
export type ResearchStatus =
  | "queued"
  | "in_progress"
  | "requires_action"
  | "completed"
  | "failed"
  | "cancelled"
  | "incomplete"
  | "budget_exceeded";

/**
 * Data-source / auxiliary tools a research run may use.
 *
 * Providers map these to their native tool shapes (e.g. `web_search` becomes
 * OpenAI's `web_search_preview`). Which types a given model accepts is
 * declared in {@link ResearchModelSpec.capabilities.tools}.
 */
export type ResearchToolConfig =
  | { type: "web_search" }
  | { type: "file_search"; vectorStoreIds: string[] }
  | { type: "mcp"; serverLabel: string; serverUrl: string; requireApproval?: "never" }
  | { type: "code_interpreter" };

/** Union of the tool type discriminators. */
export type ResearchToolType = ResearchToolConfig["type"];

/** Tool types that count as a data source (OpenAI requires at least one). */
export const RESEARCH_DATA_SOURCE_TOOL_TYPES: readonly ResearchToolType[] = [
  "web_search",
  "file_search",
  "mcp",
];

/**
 * Options for starting a research run.
 */
export interface ResearchOptions {
  /**
   * Model identifier, optionally provider-prefixed:
   * `"openai:gpt-5.5-pro"`, `"gemini:deep-research-preview-04-2026"`,
   * `"openrouter:perplexity/sonar-deep-research"`.
   */
  model: string;
  /** The research question / brief. */
  query: string;
  /**
   * System-level guidance. Folded into the input on providers without a
   * system slot (OpenAI deep research), mapped to `system_instruction`
   * (Gemini) or a system message (OpenRouter) elsewhere.
   */
  systemPrompt?: string;
  /**
   * Run as a server-side background job (survives disconnects; enables
   * {@link ResearchJob.toRef} / attach). Defaults to the model's
   * `capabilities.background`. Requesting `true` on a provider without
   * background support is a validation error.
   */
  background?: boolean;
  /**
   * Data-source / auxiliary tools. Defaults to the model's
   * `requiredTools`. Tools outside the model's `capabilities.tools`
   * are rejected before any network call.
   */
  tools?: ResearchToolConfig[];
  /** Cap on total built-in tool calls (cost control; OpenAI `max_tool_calls`). */
  maxToolCalls?: number;
  /** Reasoning configuration (mapped per provider: summaries, effort, thinking). */
  reasoning?: ReasoningConfig;
  /**
   * Continue from a previous **completed** research job (Gemini
   * `previous_interaction_id`). Rejected on models without follow-up support.
   */
  previousJobId?: string;
  /**
   * Overall time budget for the run as observed by this client. Expiry aborts
   * the transport (the server-side job keeps running and stays attachable) and
   * surfaces a `ResearchTimeoutError`. Defaults to
   * `min(RESEARCH_DEFAULT_TIMEOUT_MS, spec.maxDurationMs)`.
   */
  timeoutMs?: number;
  /**
   * Aborts the transport only — a background job keeps running server-side
   * and can be re-attached via its ref. Use {@link ResearchJob.cancel} to stop
   * the job on the server.
   */
  signal?: AbortSignal;
  /** Provider-specific passthrough (same spirit as `LLMGenerationOptions.extra`). */
  extra?: Record<string, unknown>;
}

/** A citation attached to the research report. */
export interface ResearchCitation {
  url: string;
  title?: string;
  /** Start offset of the cited span in the report text, when provided. */
  startIndex?: number;
  /** End offset of the cited span in the report text, when provided. */
  endIndex?: number;
  /** Excerpt of the cited source content, when provided (OpenRouter). */
  content?: string;
}

/** Token usage extended with research-specific dimensions. */
export interface ResearchUsage extends TokenUsage {
  /** Number of web searches performed, when the provider reports it. */
  searches?: number;
  /** Estimated cost in USD, computed from catalog pricing when available. */
  costUSD?: number;
}

/** Error payload carried by `error` events. */
export interface ResearchErrorInfo {
  message: string;
  code?: string;
  /** Whether retrying (or resuming) may succeed. */
  retryable: boolean;
}

/**
 * Normalized research event union.
 *
 * Every event may carry a `cursor` (provider stream position: OpenAI
 * `sequence_number`, Gemini `event_id`) used for lossless resume, and a
 * `rawEvent` escape hatch with the provider's original payload.
 */
export type ResearchEvent = { cursor?: string; rawEvent?: unknown } & (
  | {
      type: "created";
      /** Server-side job id; `null` on providers without job handles (OpenRouter). */
      jobId: string | null;
    }
  | { type: "status"; status: ResearchStatus }
  | {
      type: "phase";
      /** Coarse activity phase. Providers may emit additional phase strings. */
      phase: "planning" | "searching" | "reasoning" | "writing" | (string & {});
    }
  | { type: "thinking"; delta: string }
  | {
      type: "search";
      action: "search" | "open_page" | "find_in_page";
      status: "started" | "completed";
      query?: string;
      url?: string;
    }
  | {
      type: "tool";
      tool: "code_interpreter" | "file_search" | "mcp";
      status: "started" | "completed";
      detail?: string;
    }
  | { type: "text"; delta: string }
  | { type: "citation"; citation: ResearchCitation }
  | { type: "usage"; usage: ResearchUsage }
  | { type: "error"; error: ResearchErrorInfo }
  | { type: "done"; result: ResearchDoneInfo }
);

/**
 * Terminal payload emitted by provider normalizers on `done`.
 *
 * Providers fill what they know; the job's collector merges it with
 * accumulated stream state (text deltas, citations, usage) into the final
 * {@link ResearchResult}. `report` may be empty when the report was fully
 * streamed as `text` deltas.
 */
export interface ResearchDoneInfo {
  status: ResearchStatus;
  /** Full report text when the provider returns it wholesale (else ""). */
  report: string;
  citations?: ResearchCitation[];
  usage?: ResearchUsage;
  /** Final provider object (response / interaction / last chunk). */
  raw?: unknown;
}

/** Final result of a research run. */
export interface ResearchResult {
  /** Server-side job id, or `null` on providers without job handles. */
  jobId: string | null;
  /** Adapter provider id that ran the job (e.g. "openai", "mock"). */
  provider: string;
  /** Model / agent id (unprefixed). */
  model: string;
  status: ResearchStatus;
  /** The research report text. */
  report: string;
  /** Deduplicated citations. */
  citations: ResearchCitation[];
  usage: ResearchUsage;
  /** Wall-clock duration observed by this client, when measurable. */
  durationMs?: number;
  /** Final provider payload, when available. */
  raw?: unknown;
}

/**
 * JSON-serializable reference to a background research job.
 *
 * Round-trip contract: `JSON.parse(JSON.stringify(ref))` is a valid ref, and
 * `client.research.attach(ref)` resumes the event stream from `cursor` —
 * across process restarts.
 */
export interface ResearchJobRef {
  /** Adapter provider id (e.g. "openai", "gemini", "mock"). */
  provider: string;
  /** Model / agent id (unprefixed). */
  model: string;
  /** Server-side job id. */
  jobId: string;
  /** Last observed stream cursor; resume yields events strictly after it. */
  cursor?: string;
  /** ISO timestamp of job creation, when known. */
  startedAt?: string;
}

/** Snapshot returned by status polls. */
export interface ResearchStatusSnapshot {
  status: ResearchStatus;
  /** Present when the job reached a terminal state and the result is available. */
  result?: ResearchResult;
}

/**
 * Handle to a research run.
 *
 * The job is itself async-iterable (equivalent to iterating
 * {@link ResearchJob.events}). The event stream may be consumed **once**.
 */
export interface ResearchJob extends AsyncIterable<ResearchEvent> {
  /** Server-side job id once known (`created` event), else `null`. */
  readonly jobId: string | null;
  /** Adapter provider id. */
  readonly provider: string;
  /** Model / agent id (unprefixed). */
  readonly model: string;
  /**
   * Live event stream. Auto-reconnects with the last cursor on transient
   * stream drops when the model is resumable. Single consumption only.
   */
  events(): AsyncIterable<ResearchEvent>;
  /**
   * Final result. Drains the event stream internally when not already
   * consumed; otherwise resolves when iteration completes.
   */
  result(): Promise<ResearchResult>;
  /**
   * One-shot server-side status poll.
   * @throws ResearchNotPollableError on providers without status polling.
   */
  status(): Promise<ResearchStatus>;
  /**
   * Cancel the job server-side where supported; otherwise aborts the
   * transport. See {@link ResearchOptions.signal} for the abort-vs-cancel
   * distinction.
   */
  cancel(): Promise<void>;
  /**
   * Serializable reference for later {@link ResearchNamespaceLike.attach}.
   * @throws ResearchJobNotResumableError when the job has no server-side id.
   */
  toRef(): ResearchJobRef;
}

/**
 * Minimal structural interface of the research namespace (used by docs/tests;
 * the concrete class lives in `namespace.ts`).
 */
export interface ResearchNamespaceLike {
  start(options: ResearchOptions): ResearchJob;
  attach(ref: ResearchJobRef): ResearchJob;
}
