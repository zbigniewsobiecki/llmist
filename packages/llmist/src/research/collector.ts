/**
 * Aggregates a research event stream into a final {@link ResearchResult}.
 *
 * Provider normalizers emit what they know; the collector merges streamed
 * state (text deltas, citations, usage) with the terminal `done` payload:
 * - report: `done.report` wins when non-empty, else accumulated text deltas
 * - citations: union of streamed + done citations, deduplicated
 * - usage: last-write-wins for token fields, max for cumulative counters
 * - costUSD: computed from catalog pricing when a spec is provided
 */

import { estimateResearchCost } from "./cost.js";
import type { ResearchModelSpec } from "./model-spec.js";
import type {
  ResearchCitation,
  ResearchErrorInfo,
  ResearchEvent,
  ResearchResult,
  ResearchStatus,
  ResearchUsage,
} from "./types.js";

const EMPTY_USAGE: ResearchUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

/** Identity key for citation deduplication. */
function citationKey(citation: ResearchCitation): string {
  return `${citation.url}#${citation.startIndex ?? ""}`;
}

export interface ResearchResultContext {
  provider: string;
  model: string;
  jobId: string | null;
}

export class ResearchResultCollector {
  private reportParts: string[] = [];
  private citations = new Map<string, ResearchCitation>();
  private usage: ResearchUsage | undefined;
  private lastStatus: ResearchStatus | undefined;
  private doneReport = "";
  private doneRaw: unknown;
  private hasDone = false;
  private firstEventAt: number | undefined;
  private terminalAt: number | undefined;

  /** Terminal error info from an `error` event, for result() consumers. */
  terminalError: ResearchErrorInfo | undefined;

  constructor(
    private readonly spec?: ResearchModelSpec,
    private readonly now: () => number = Date.now,
  ) {}

  ingest(event: ResearchEvent): void {
    this.firstEventAt ??= this.now();

    switch (event.type) {
      case "text":
        this.reportParts.push(event.delta);
        break;
      case "citation":
        this.addCitation(event.citation);
        break;
      case "usage":
        this.mergeUsage(event.usage);
        break;
      case "status":
        this.lastStatus = event.status;
        break;
      case "error":
        this.terminalError = event.error;
        this.terminalAt = this.now();
        break;
      case "done": {
        this.hasDone = true;
        this.lastStatus = event.result.status;
        this.doneReport = event.result.report;
        this.doneRaw = event.result.raw;
        for (const citation of event.result.citations ?? []) {
          this.addCitation(citation);
        }
        if (event.result.usage) {
          this.mergeUsage(event.result.usage);
        }
        this.terminalAt = this.now();
        break;
      }
      default:
        break;
    }
  }

  toResult(context: ResearchResultContext): ResearchResult {
    const usage: ResearchUsage = { ...(this.usage ?? EMPTY_USAGE) };
    // A provider-reported cost (e.g. OpenRouter usage accounting) is
    // authoritative; fall back to the catalog-based estimate.
    if (usage.costUSD === undefined && this.spec) {
      usage.costUSD = estimateResearchCost(this.spec.pricing, usage);
    }

    const status: ResearchStatus =
      this.lastStatus ?? (this.terminalError ? "failed" : "in_progress");

    return {
      jobId: context.jobId,
      provider: context.provider,
      model: context.model,
      status: this.terminalError && !this.hasDone ? "failed" : status,
      report: this.doneReport !== "" ? this.doneReport : this.reportParts.join(""),
      citations: [...this.citations.values()],
      usage,
      durationMs:
        this.firstEventAt !== undefined && this.terminalAt !== undefined
          ? this.terminalAt - this.firstEventAt
          : undefined,
      raw: this.doneRaw,
    };
  }

  /** Whether a terminal event (`done` or `error`) was ingested. */
  get isTerminal(): boolean {
    return this.hasDone || this.terminalError !== undefined;
  }

  private addCitation(citation: ResearchCitation): void {
    const key = citationKey(citation);
    if (!this.citations.has(key)) {
      this.citations.set(key, citation);
    }
  }

  private mergeUsage(incoming: ResearchUsage): void {
    const current = this.usage ?? { ...EMPTY_USAGE };
    this.usage = {
      ...current,
      ...incoming,
      // Cumulative counters may be re-reported; never let them regress.
      searches: max(current.searches, incoming.searches),
    };
  }
}

function max(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}
