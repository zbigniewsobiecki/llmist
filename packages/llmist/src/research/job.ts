/**
 * Research job handle implementation.
 *
 * Wraps a provider's normalized event stream with:
 * - lazy stream opening (nothing happens until first iteration / result())
 * - cursor + jobId tracking and result aggregation (collector)
 * - automatic cursor-based reconnect on transient stream drops (resumable providers)
 * - a client-side time budget (aborts transport only; server-side job survives)
 * - abort-vs-cancel semantics (see ResearchOptions.signal / ResearchJob.cancel)
 */

import { isAbortError } from "../core/errors.js";
import type { ModelDescriptor } from "../core/options.js";
import type { ProviderAdapter } from "../providers/provider.js";
import { ResearchResultCollector } from "./collector.js";
import {
  RESEARCH_DEFAULT_TIMEOUT_MS,
  RESEARCH_STREAM_RECONNECT_MAX_ATTEMPTS,
} from "./constants.js";
import {
  ResearchJobNotResumableError,
  ResearchNotPollableError,
  ResearchStreamConsumedError,
  ResearchTimeoutError,
} from "./errors.js";
import type { ResearchModelSpec } from "./model-spec.js";
import type {
  ResearchEvent,
  ResearchJob,
  ResearchJobRef,
  ResearchOptions,
  ResearchResult,
  ResearchStatus,
} from "./types.js";

interface ResearchJobInit {
  adapter: ProviderAdapter;
  descriptor: ModelDescriptor;
  spec?: ResearchModelSpec;
  /** Present in start mode. */
  options?: ResearchOptions;
  /** Present in attach mode. */
  resumeFrom?: ResearchJobRef;
}

type JobState = "idle" | "streaming" | "finished";

export class ResearchJobImpl implements ResearchJob {
  private readonly adapter: ProviderAdapter;
  private readonly descriptor: ModelDescriptor;
  private readonly spec?: ResearchModelSpec;
  private readonly options?: ResearchOptions;
  private readonly resumeFrom?: ResearchJobRef;

  private readonly collector: ResearchResultCollector;
  private readonly controller = new AbortController();
  private readonly timeoutMs: number;

  private state: JobState = "idle";
  private currentJobId: string | null;
  private cursor?: string;
  private startedAt?: string;
  private timedOut = false;
  private cancelRequested = false;
  private finalResult?: ResearchResult;
  private failure?: Error;
  private completion?: { promise: Promise<void>; resolve: () => void };

  constructor(init: ResearchJobInit) {
    this.adapter = init.adapter;
    this.descriptor = init.descriptor;
    this.spec = init.spec;
    this.options = init.options;
    this.resumeFrom = init.resumeFrom;
    this.collector = new ResearchResultCollector(init.spec);
    this.currentJobId = init.resumeFrom?.jobId ?? null;
    this.cursor = init.resumeFrom?.cursor;
    this.startedAt = init.resumeFrom?.startedAt;

    const specCap = init.spec?.maxDurationMs ?? Number.POSITIVE_INFINITY;
    this.timeoutMs = init.options?.timeoutMs ?? Math.min(RESEARCH_DEFAULT_TIMEOUT_MS, specCap);

    if (init.options?.signal) {
      const external = init.options.signal;
      if (external.aborted) {
        this.controller.abort(external.reason);
      } else {
        external.addEventListener("abort", () => this.controller.abort(external.reason), {
          once: true,
        });
      }
    }
  }

  get jobId(): string | null {
    return this.currentJobId;
  }

  get provider(): string {
    return this.adapter.providerId;
  }

  get model(): string {
    return this.descriptor.name;
  }

  [Symbol.asyncIterator](): AsyncIterator<ResearchEvent> {
    return this.events()[Symbol.asyncIterator]();
  }

  events(): AsyncIterable<ResearchEvent> {
    if (this.state !== "idle") {
      throw new ResearchStreamConsumedError();
    }
    this.state = "streaming";
    let resolveCompletion: () => void = () => {};
    const promise = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });
    this.completion = { promise, resolve: resolveCompletion };
    return this.run();
  }

  async result(): Promise<ResearchResult> {
    if (this.state === "idle") {
      // Drain internally.
      for await (const _event of this.events()) {
        // collector ingests inside run()
      }
    } else if (this.state === "streaming" && this.completion) {
      await this.completion.promise;
    }

    if (this.failure) {
      throw this.failure;
    }
    this.finalResult ??= this.collector.toResult(this.resultContext());
    return this.finalResult;
  }

  async status(): Promise<ResearchStatus> {
    if (!this.adapter.getResearchStatus) {
      throw new ResearchNotPollableError(
        `Provider "${this.provider}" does not support research status polling.`,
      );
    }
    if (this.currentJobId === null) {
      throw new ResearchNotPollableError(
        `Research run on "${this.provider}" has no server-side job id to poll.`,
      );
    }
    const snapshot = await this.adapter.getResearchStatus(this.buildRef());
    return snapshot.status;
  }

  async cancel(): Promise<void> {
    this.cancelRequested = true;
    if (this.adapter.cancelResearch && this.currentJobId !== null) {
      await this.adapter.cancelResearch(this.buildRef());
    }
    this.controller.abort();
  }

  toRef(): ResearchJobRef {
    if (this.currentJobId === null) {
      throw new ResearchJobNotResumableError(
        `Research run on "${this.provider}" has no server-side job id — ` +
          `the provider does not support background jobs, so it cannot be re-attached.`,
      );
    }
    return this.buildRef();
  }

  private buildRef(): ResearchJobRef {
    if (this.currentJobId === null) {
      throw new ResearchJobNotResumableError("Research job has no server-side job id.");
    }
    return {
      provider: this.provider,
      model: this.descriptor.name,
      jobId: this.currentJobId,
      cursor: this.cursor,
      startedAt: this.startedAt,
    };
  }

  private resultContext() {
    return { provider: this.provider, model: this.descriptor.name, jobId: this.currentJobId };
  }

  private openStream(resume: boolean): AsyncIterable<ResearchEvent> {
    if (resume) {
      if (!this.adapter.resumeResearch) {
        throw new ResearchJobNotResumableError(
          `Provider "${this.provider}" does not support resuming research jobs.`,
        );
      }
      return this.adapter.resumeResearch(this.buildRef(), this.controller.signal);
    }
    if (!this.adapter.startResearch || !this.options) {
      throw new ResearchJobNotResumableError(
        `Provider "${this.provider}" cannot start this research job.`,
      );
    }
    return this.adapter.startResearch(
      { ...this.options, signal: this.controller.signal },
      this.descriptor,
      this.spec,
    );
  }

  private observe(event: ResearchEvent): void {
    if (event.cursor !== undefined) {
      this.cursor = event.cursor;
    }
    if (event.type === "created") {
      if (event.jobId !== null) {
        this.currentJobId = event.jobId;
      }
      this.startedAt ??= new Date().toISOString();
    }
    this.collector.ingest(event);
  }

  private canResume(): boolean {
    if (this.adapter.resumeResearch === undefined || this.currentJobId === null) {
      return false;
    }
    // Catalog spec is authoritative; without one (mocks, custom models) the
    // presence of resumeResearch on the adapter decides.
    return this.spec ? this.spec.capabilities.resumable : true;
  }

  private async *run(): AsyncGenerator<ResearchEvent> {
    const timer = setTimeout(() => {
      this.timedOut = true;
      this.controller.abort(new ResearchTimeoutError(this.timeoutMs));
    }, this.timeoutMs);
    // Don't keep the process alive for the time budget (Node-only API).
    (timer as { unref?: () => void }).unref?.();

    let reconnectAttempts = 0;
    let source = this.openStream(this.resumeFrom !== undefined);

    try {
      while (true) {
        const iterator = source[Symbol.asyncIterator]();
        try {
          while (true) {
            const next = await iterator.next();
            if (next.done) {
              return;
            }
            reconnectAttempts = 0;
            this.observe(next.value);
            yield next.value;
            if (this.collector.isTerminal) {
              return;
            }
          }
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));

          if (this.timedOut) {
            this.failure = new ResearchTimeoutError(this.timeoutMs);
            const info = { message: this.failure.message, code: "timeout", retryable: false };
            this.collector.ingest({ type: "error", error: info });
            yield { type: "error", error: info };
            return;
          }

          if (this.cancelRequested && isAbortError(err)) {
            const event: ResearchEvent = { type: "status", status: "cancelled" };
            this.observe(event);
            yield event;
            return;
          }

          if (isAbortError(err)) {
            // External abort: transport-only teardown; surface to the caller.
            this.failure = err;
            throw err;
          }

          if (this.canResume() && reconnectAttempts < RESEARCH_STREAM_RECONNECT_MAX_ATTEMPTS) {
            reconnectAttempts += 1;
            source = this.openStream(true);
            continue;
          }

          const info = { message: err.message, retryable: false };
          this.collector.ingest({ type: "error", error: info });
          yield { type: "error", error: info };
          return;
        }
      }
    } finally {
      clearTimeout(timer);
      this.state = "finished";
      this.finalResult = this.collector.toResult(this.resultContext());
      this.completion?.resolve();
    }
  }
}
