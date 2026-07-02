import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelDescriptor } from "../core/options.js";
import type { ProviderAdapter } from "../providers/provider.js";
import { RESEARCH_STREAM_RECONNECT_MAX_ATTEMPTS } from "./constants.js";
import {
  ResearchJobNotResumableError,
  ResearchNotPollableError,
  ResearchStreamConsumedError,
  ResearchTimeoutError,
} from "./errors.js";
import { ResearchJobImpl } from "./job.js";
import type { ResearchModelSpec } from "./model-spec.js";
import type { ResearchEvent, ResearchJobRef, ResearchOptions } from "./types.js";

const DESCRIPTOR: ModelDescriptor = { provider: "fake", name: "fake-research" };

const SPEC: ResearchModelSpec = {
  provider: "fake",
  modelId: "fake-research",
  kind: "model",
  displayName: "Fake Research",
  pricing: { input: 1, output: 2 },
  capabilities: { streaming: true, background: true, resumable: true, tools: ["web_search"] },
};

const NON_RESUMABLE_SPEC: ResearchModelSpec = {
  ...SPEC,
  capabilities: { ...SPEC.capabilities, background: false, resumable: false },
};

const OPTIONS: ResearchOptions = { model: "fake:fake-research", query: "q" };

/** Partial script (no terminal event) for hang/abort/cancel/timeout tests. */
function hangEvents(): ResearchEvent[] {
  return [
    { type: "created", jobId: "job-42", cursor: "0" },
    { type: "status", status: "in_progress", cursor: "1" },
    { type: "thinking", delta: "considering...", cursor: "2" },
  ];
}

/** Standard happy-path event script. */
function happyEvents(): ResearchEvent[] {
  return [
    { type: "created", jobId: "job-42", cursor: "0" },
    { type: "status", status: "in_progress", cursor: "1" },
    { type: "search", action: "search", status: "started", query: "batteries", cursor: "2" },
    { type: "thinking", delta: "considering...", cursor: "3" },
    { type: "text", delta: "Report ", cursor: "4" },
    { type: "text", delta: "body.", cursor: "5" },
    { type: "citation", citation: { url: "https://x.example" }, cursor: "6" },
    {
      type: "usage",
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, searches: 2 },
      cursor: "7",
    },
    { type: "done", result: { status: "completed", report: "" }, cursor: "8" },
  ];
}

interface FakeAdapterConfig {
  events?: ResearchEvent[];
  /** Throw this error after emitting `failAfter` events. */
  failAfter?: number;
  failWith?: () => Error;
  /** Resume replays events with cursor > ref.cursor. */
  resumable?: boolean;
  /** Never end the stream after emitting the scripted events (hang). */
  hang?: boolean;
  cancelResearch?: (ref: ResearchJobRef) => Promise<void>;
  getResearchStatus?: ProviderAdapter["getResearchStatus"];
}

function fakeAdapter(config: FakeAdapterConfig = {}): ProviderAdapter & {
  startCalls: number;
  resumeCalls: ResearchJobRef[];
} {
  const events = config.events ?? happyEvents();

  async function* emit(
    from: ResearchEvent[],
    signal?: AbortSignal,
    failAfter?: number,
  ): AsyncGenerator<ResearchEvent> {
    let emitted = 0;
    for (const event of from) {
      if (signal?.aborted) {
        const abortError = new Error("The operation was aborted");
        abortError.name = "AbortError";
        throw abortError;
      }
      if (failAfter !== undefined && emitted >= failAfter) {
        throw (config.failWith ?? (() => new Error("stream dropped")))();
      }
      yield event;
      emitted += 1;
    }
    if (config.hang) {
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          const abortError = new Error("The operation was aborted");
          abortError.name = "AbortError";
          reject(abortError);
        });
      });
    }
  }

  const adapter = {
    providerId: "fake",
    startCalls: 0,
    resumeCalls: [] as ResearchJobRef[],
    supports: () => true,
    stream: () => {
      throw new Error("not used");
    },
    supportsResearch: () => true,
    startResearch(options: ResearchOptions) {
      adapter.startCalls += 1;
      return emit(events, options.signal, config.failAfter);
    },
    ...(config.resumable !== false
      ? {
          resumeResearch(ref: ResearchJobRef, signal?: AbortSignal) {
            adapter.resumeCalls.push(ref);
            const cursorNum = ref.cursor === undefined ? -1 : Number(ref.cursor);
            const remaining = events.filter(
              (event) => event.cursor !== undefined && Number(event.cursor) > cursorNum,
            );
            // Resumed stream is healthy: failAfter is not re-applied.
            return emit(remaining, signal);
          },
        }
      : {}),
    ...(config.getResearchStatus ? { getResearchStatus: config.getResearchStatus } : {}),
    ...(config.cancelResearch ? { cancelResearch: config.cancelResearch } : {}),
  };

  return adapter as unknown as ProviderAdapter & {
    startCalls: number;
    resumeCalls: ResearchJobRef[];
  };
}

async function drain(job: ResearchJobImpl): Promise<ResearchEvent[]> {
  const seen: ResearchEvent[] = [];
  for await (const event of job) {
    seen.push(event);
  }
  return seen;
}

describe("ResearchJobImpl", () => {
  it("yields all events and aggregates the result", async () => {
    const job = new ResearchJobImpl({
      adapter: fakeAdapter(),
      descriptor: DESCRIPTOR,
      spec: SPEC,
      options: OPTIONS,
    });

    const events = await drain(job);
    expect(events.map((e) => e.type)).toEqual([
      "created",
      "status",
      "search",
      "thinking",
      "text",
      "text",
      "citation",
      "usage",
      "done",
    ]);

    const result = await job.result();
    expect(result.report).toBe("Report body.");
    expect(result.status).toBe("completed");
    expect(result.jobId).toBe("job-42");
    expect(result.citations).toHaveLength(1);
    expect(result.usage.searches).toBe(2);
    expect(result.usage.costUSD).toBeDefined();
  });

  it("result() drains internally when the stream was not consumed", async () => {
    const job = new ResearchJobImpl({
      adapter: fakeAdapter(),
      descriptor: DESCRIPTOR,
      spec: SPEC,
      options: OPTIONS,
    });
    const result = await job.result();
    expect(result.report).toBe("Report body.");
  });

  it("throws on double consumption", async () => {
    const job = new ResearchJobImpl({
      adapter: fakeAdapter(),
      descriptor: DESCRIPTOR,
      spec: SPEC,
      options: OPTIONS,
    });
    await drain(job);
    expect(() => job.events()).toThrow(ResearchStreamConsumedError);
  });

  it("tracks cursor and exposes toRef()", async () => {
    const job = new ResearchJobImpl({
      adapter: fakeAdapter(),
      descriptor: DESCRIPTOR,
      spec: SPEC,
      options: OPTIONS,
    });
    await drain(job);
    const ref = job.toRef();
    expect(ref).toMatchObject({
      provider: "fake",
      model: "fake-research",
      jobId: "job-42",
      cursor: "8",
    });
    expect(ref.startedAt).toBeDefined();
    // JSON round-trip contract
    expect(JSON.parse(JSON.stringify(ref))).toEqual(ref);
  });

  it("toRef() throws when the provider produced no job id", async () => {
    const events: ResearchEvent[] = [
      { type: "created", jobId: null },
      { type: "text", delta: "hi" },
      { type: "done", result: { status: "completed", report: "" } },
    ];
    const job = new ResearchJobImpl({
      adapter: fakeAdapter({ events }),
      descriptor: DESCRIPTOR,
      spec: NON_RESUMABLE_SPEC,
      options: OPTIONS,
    });
    await drain(job);
    expect(() => job.toRef()).toThrow(ResearchJobNotResumableError);
  });

  it("auto-reconnects with the last cursor on resumable specs", async () => {
    const adapter = fakeAdapter({ failAfter: 4 });
    const job = new ResearchJobImpl({
      adapter,
      descriptor: DESCRIPTOR,
      spec: SPEC,
      options: OPTIONS,
    });

    const events = await drain(job);
    // No duplicates, full sequence despite the drop after 4 events.
    expect(events.map((e) => e.cursor)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8"]);
    expect(adapter.resumeCalls).toHaveLength(1);
    expect(adapter.resumeCalls[0]?.cursor).toBe("3");
    const result = await job.result();
    expect(result.status).toBe("completed");
  });

  it("gives up after the reconnect budget and surfaces a non-retryable error", async () => {
    // Adapter whose resume always fails immediately.
    const adapter = fakeAdapter({ failAfter: 2 });
    const failingResume = () => {
      // biome-ignore lint/correctness/useYield: intentionally throwing generator
      return (async function* (): AsyncGenerator<ResearchEvent> {
        throw new Error("still down");
      })();
    };
    (adapter as unknown as Record<string, unknown>).resumeResearch = failingResume;

    const job = new ResearchJobImpl({
      adapter,
      descriptor: DESCRIPTOR,
      spec: SPEC,
      options: OPTIONS,
    });
    const events = await drain(job);
    const last = events.at(-1);
    expect(last?.type).toBe("error");
    if (last?.type === "error") {
      expect(last.error.retryable).toBe(false);
    }
    const result = await job.result();
    expect(result.status).toBe("failed");
  });

  it("does not resume on non-resumable specs — emits a terminal error", async () => {
    const adapter = fakeAdapter({ failAfter: 3, resumable: false });
    const job = new ResearchJobImpl({
      adapter,
      descriptor: DESCRIPTOR,
      spec: NON_RESUMABLE_SPEC,
      options: OPTIONS,
    });
    const events = await drain(job);
    expect(events.at(-1)?.type).toBe("error");
    expect(adapter.resumeCalls).toHaveLength(0);
  });

  describe("timeout", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("aborts transport and surfaces ResearchTimeoutError; ref stays valid", async () => {
      const adapter = fakeAdapter({ events: hangEvents(), hang: true });
      const job = new ResearchJobImpl({
        adapter,
        descriptor: DESCRIPTOR,
        spec: SPEC,
        options: { ...OPTIONS, timeoutMs: 5_000 },
      });

      const consumed: Promise<ResearchEvent[]> = drain(job);
      await vi.advanceTimersByTimeAsync(6_000);
      const events = await consumed;

      const last = events.at(-1);
      expect(last?.type).toBe("error");
      if (last?.type === "error") {
        expect(last.error.code).toBe("timeout");
      }
      await expect(job.result()).rejects.toBeInstanceOf(ResearchTimeoutError);
      expect(job.toRef().jobId).toBe("job-42");
    });
  });

  it("external abort tears down transport and rethrows", async () => {
    const adapter = fakeAdapter({ events: hangEvents(), hang: true });
    const controller = new AbortController();
    const cancelSpy = vi.fn();
    (adapter as unknown as Record<string, unknown>).cancelResearch = cancelSpy;

    const job = new ResearchJobImpl({
      adapter,
      descriptor: DESCRIPTOR,
      spec: SPEC,
      options: { ...OPTIONS, signal: controller.signal },
    });

    const consuming = drain(job);
    setTimeout(() => controller.abort(), 5);
    await expect(consuming).rejects.toSatisfy(
      (error: unknown) => error instanceof Error && error.name === "AbortError",
    );
    expect(cancelSpy).not.toHaveBeenCalled();
  });

  it("cancel() calls the provider cancel endpoint and ends the stream as cancelled", async () => {
    const cancelResearch = vi.fn(async () => {});
    const adapter = fakeAdapter({ events: hangEvents(), hang: true, cancelResearch });
    const job = new ResearchJobImpl({
      adapter,
      descriptor: DESCRIPTOR,
      spec: SPEC,
      options: OPTIONS,
    });

    const consuming = drain(job);
    // Give the stream a tick to emit the scripted events, then cancel.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await job.cancel();
    const events = await consuming;

    expect(cancelResearch).toHaveBeenCalledOnce();
    expect(cancelResearch.mock.calls[0]?.[0]).toMatchObject({ jobId: "job-42" });
    expect(events.at(-1)).toMatchObject({ type: "status", status: "cancelled" });
    const result = await job.result();
    expect(result.status).toBe("cancelled");
  });

  it("status() delegates to getResearchStatus", async () => {
    const getResearchStatus = vi.fn(async () => ({ status: "in_progress" as const }));
    const adapter = fakeAdapter({ events: hangEvents(), hang: true, getResearchStatus });
    const job = new ResearchJobImpl({
      adapter,
      descriptor: DESCRIPTOR,
      spec: SPEC,
      options: OPTIONS,
    });
    const consuming = drain(job);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await expect(job.status()).resolves.toBe("in_progress");
    await job.cancel();
    await consuming;
  });

  it("status() throws ResearchNotPollableError when the adapter lacks polling", async () => {
    const adapter = fakeAdapter();
    const job = new ResearchJobImpl({
      adapter,
      descriptor: DESCRIPTOR,
      spec: SPEC,
      options: OPTIONS,
    });
    await expect(job.status()).rejects.toBeInstanceOf(ResearchNotPollableError);
  });

  it("resume mode opens via resumeResearch with the given ref", async () => {
    const adapter = fakeAdapter();
    const ref: ResearchJobRef = {
      provider: "fake",
      model: "fake-research",
      jobId: "job-42",
      cursor: "3",
    };
    const job = new ResearchJobImpl({
      adapter,
      descriptor: DESCRIPTOR,
      spec: SPEC,
      resumeFrom: ref,
    });
    const events = await drain(job);
    expect(adapter.startCalls).toBe(0);
    expect(adapter.resumeCalls[0]).toEqual(ref);
    expect(events.map((e) => e.cursor)).toEqual(["4", "5", "6", "7", "8"]);
    expect(job.jobId).toBe("job-42");
  });

  it("reconnect budget constant is honored", () => {
    expect(RESEARCH_STREAM_RECONNECT_MAX_ATTEMPTS).toBeGreaterThan(0);
  });
});
