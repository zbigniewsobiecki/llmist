/**
 * Typed errors for the research surface.
 *
 * Follows the core error convention (plain `Error` subclasses with `name`
 * set) — see `core/errors.ts`.
 */

/** Thrown when no registered provider supports research for the given model. */
export class ResearchNotSupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchNotSupportedError";
  }
}

/**
 * Thrown when a job cannot produce a serializable ref (no server-side job id —
 * e.g. OpenRouter research runs) or a ref cannot be resumed on its provider.
 */
export class ResearchJobNotResumableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchJobNotResumableError";
  }
}

/** Thrown when status polling is requested on a provider without it. */
export class ResearchNotPollableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchNotPollableError";
  }
}

/**
 * Thrown when the client-side time budget expires. The transport is aborted;
 * a background job keeps running server-side and its ref stays valid.
 */
export class ResearchTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(
      `Research run exceeded the client-side time budget of ${timeoutMs}ms. ` +
        `A background job keeps running server-side — re-attach via its ref.`,
    );
    this.name = "ResearchTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/** Thrown when starting a run on a model past its announced shutdown date. */
export class ResearchDeprecatedModelError extends Error {
  readonly modelId: string;
  readonly shutdownDate: string;
  readonly replacement?: string;

  constructor(params: { modelId: string; shutdownDate: string; replacement?: string }) {
    super(
      `Research model "${params.modelId}" was shut down by its provider on ${params.shutdownDate}.` +
        (params.replacement ? ` Use "${params.replacement}" instead.` : ""),
    );
    this.name = "ResearchDeprecatedModelError";
    this.modelId = params.modelId;
    this.shutdownDate = params.shutdownDate;
    this.replacement = params.replacement;
  }
}

/** Thrown when options fail pre-flight validation against the model's spec. */
export class ResearchValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchValidationError";
  }
}

/** Thrown when a job's event stream is consumed more than once. */
export class ResearchStreamConsumedError extends Error {
  constructor() {
    super(
      "This research job's event stream was already consumed. " +
        "Iterate events() (or the job itself) once; use result() for the aggregated outcome.",
    );
    this.name = "ResearchStreamConsumedError";
  }
}
