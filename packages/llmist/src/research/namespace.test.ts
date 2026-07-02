import { describe, expect, it, vi } from "vitest";
import { ModelIdentifierParser } from "../core/options.js";
import type { ProviderAdapter } from "../providers/provider.js";
import {
  ResearchDeprecatedModelError,
  ResearchJobNotResumableError,
  ResearchNotPollableError,
  ResearchNotSupportedError,
  ResearchValidationError,
} from "./errors.js";
import type { ResearchModelSpec } from "./model-spec.js";
import { ResearchNamespace } from "./namespace.js";
import type { ResearchEvent, ResearchJobRef, ResearchOptions } from "./types.js";

const PARSER = new ModelIdentifierParser("openai");

function spec(overrides: Partial<ResearchModelSpec> = {}): ResearchModelSpec {
  return {
    provider: "fake",
    modelId: "fake-research",
    kind: "model",
    displayName: "Fake Research",
    pricing: { input: 1, output: 2 },
    capabilities: {
      streaming: true,
      background: true,
      resumable: true,
      tools: ["web_search", "file_search"],
    },
    requiredTools: [{ type: "web_search" }],
    ...overrides,
  };
}

interface AdapterOverrides extends Partial<ProviderAdapter> {
  capturedOptions?: ResearchOptions[];
}

function researchAdapter(
  providerId: string,
  specs: ResearchModelSpec[],
  overrides: AdapterOverrides = {},
): ProviderAdapter & { capturedOptions: ResearchOptions[] } {
  const capturedOptions: ResearchOptions[] = [];
  async function* noEvents(): AsyncGenerator<ResearchEvent> {
    yield { type: "created", jobId: "job-1" };
    yield { type: "done", result: { status: "completed", report: "ok" } };
  }
  return {
    providerId,
    capturedOptions,
    supports: (descriptor) => descriptor.provider === providerId,
    stream: () => {
      throw new Error("not used");
    },
    supportsResearch: (modelId: string) => specs.some((s) => s.modelId === modelId),
    getResearchModelSpecs: () => specs,
    startResearch: (options: ResearchOptions) => {
      capturedOptions.push(options);
      return noEvents();
    },
    resumeResearch: () => noEvents(),
    getResearchStatus: async () => ({ status: "in_progress" as const }),
    cancelResearch: async () => {},
    ...overrides,
  } as ProviderAdapter & { capturedOptions: ResearchOptions[] };
}

describe("ResearchNamespace", () => {
  describe("dispatch", () => {
    it("routes to the adapter that supports the model", async () => {
      const adapter = researchAdapter("fake", [spec()]);
      const ns = new ResearchNamespace([adapter], PARSER);
      const job = ns.start({ model: "fake:fake-research", query: "q" });
      const result = await job.result();
      expect(result.report).toBe("ok");
      expect(result.provider).toBe("fake");
    });

    it("throws ResearchNotSupportedError listing available models", () => {
      const adapter = researchAdapter("fake", [spec()]);
      const ns = new ResearchNamespace([adapter], PARSER);
      expect(() => ns.start({ model: "fake:unknown-model", query: "q" })).toThrow(
        ResearchNotSupportedError,
      );
      expect(() => ns.start({ model: "fake:unknown-model", query: "q" })).toThrow(
        /fake:fake-research/,
      );
    });

    it("respects adapter order (priority-sorted upstream) — first match wins", async () => {
      const interceptor = researchAdapter("mock", [spec({ provider: "mock" })], {
        supports: () => true,
        supportsResearch: () => true,
      });
      const real = researchAdapter("fake", [spec()]);
      const ns = new ResearchNamespace([interceptor, real], PARSER);
      const job = ns.start({ model: "fake:fake-research", query: "q" });
      expect(job.provider).toBe("mock");
    });
  });

  describe("validation", () => {
    it("defaults background from the spec", () => {
      const adapter = researchAdapter("fake", [spec()]);
      const ns = new ResearchNamespace([adapter], PARSER);
      const job = ns.start({ model: "fake:fake-research", query: "q" });
      return job.result().then(() => {
        expect(adapter.capturedOptions[0]?.background).toBe(true);
      });
    });

    it("rejects background on non-background specs", () => {
      const noBg = spec({
        capabilities: { streaming: true, background: false, resumable: false, tools: [] },
        requiredTools: undefined,
      });
      const ns = new ResearchNamespace([researchAdapter("fake", [noBg])], PARSER);
      expect(() => ns.start({ model: "fake:fake-research", query: "q", background: true })).toThrow(
        ResearchValidationError,
      );
    });

    it("injects requiredTools when none are given", async () => {
      const adapter = researchAdapter("fake", [spec()]);
      const ns = new ResearchNamespace([adapter], PARSER);
      await ns.start({ model: "fake:fake-research", query: "q" }).result();
      expect(adapter.capturedOptions[0]?.tools).toEqual([{ type: "web_search" }]);
    });

    it("injects requiredTools when tools lack a data source", async () => {
      const withCodeInterpreter = spec({
        capabilities: {
          streaming: true,
          background: true,
          resumable: true,
          tools: ["web_search", "file_search", "code_interpreter"],
        },
      });
      const adapter = researchAdapter("fake", [withCodeInterpreter]);
      const ns = new ResearchNamespace([adapter], PARSER);
      await ns
        .start({
          model: "fake:fake-research",
          query: "q",
          tools: [{ type: "code_interpreter" }],
        })
        .result();
      expect(adapter.capturedOptions[0]?.tools).toEqual([
        { type: "web_search" },
        { type: "code_interpreter" },
      ]);
    });

    it("rejects tools outside the spec's capabilities", () => {
      const ns = new ResearchNamespace([researchAdapter("fake", [spec()])], PARSER);
      expect(() =>
        ns.start({
          model: "fake:fake-research",
          query: "q",
          tools: [{ type: "code_interpreter" }],
        }),
      ).toThrow(ResearchValidationError);
    });

    it("rejects previousJobId on specs without follow-up support", () => {
      const ns = new ResearchNamespace([researchAdapter("fake", [spec()])], PARSER);
      expect(() =>
        ns.start({ model: "fake:fake-research", query: "q", previousJobId: "prior" }),
      ).toThrow(ResearchValidationError);
    });

    it("allows previousJobId when the spec supports follow-ups", async () => {
      const followUps = spec({
        capabilities: {
          streaming: true,
          background: true,
          resumable: true,
          followUps: true,
          tools: ["web_search"],
        },
      });
      const adapter = researchAdapter("fake", [followUps]);
      const ns = new ResearchNamespace([adapter], PARSER);
      await ns.start({ model: "fake:fake-research", query: "q", previousJobId: "prior" }).result();
      expect(adapter.capturedOptions[0]?.previousJobId).toBe("prior");
    });
  });

  describe("deprecation lifecycle", () => {
    const shutdownSpec = spec({
      metadata: { shutdownDate: "2026-07-23", replacement: "next-model" },
    });

    it("throws past the shutdown date, naming the replacement", () => {
      const ns = new ResearchNamespace([researchAdapter("fake", [shutdownSpec])], PARSER, () =>
        Date.parse("2026-08-01"),
      );
      let error: unknown;
      try {
        ns.start({ model: "fake:fake-research", query: "q" });
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(ResearchDeprecatedModelError);
      expect((error as ResearchDeprecatedModelError).replacement).toBe("next-model");
    });

    it("warns inside the warning window", () => {
      const warn = vi.fn();
      const logger = { warn } as unknown as ConstructorParameters<typeof ResearchNamespace>[3];
      const ns = new ResearchNamespace(
        [researchAdapter("fake", [shutdownSpec])],
        PARSER,
        () => Date.parse("2026-07-10"),
        logger,
      );
      ns.start({ model: "fake:fake-research", query: "q" });
      expect(warn).toHaveBeenCalledOnce();
      expect(String(warn.mock.calls[0]?.[0])).toContain("2026-07-23");
    });

    it("stays silent outside the warning window", () => {
      const warn = vi.fn();
      const logger = { warn } as unknown as ConstructorParameters<typeof ResearchNamespace>[3];
      const ns = new ResearchNamespace(
        [researchAdapter("fake", [shutdownSpec])],
        PARSER,
        () => Date.parse("2026-01-01"),
        logger,
      );
      ns.start({ model: "fake:fake-research", query: "q" });
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe("attach / get / cancel", () => {
    const REF: ResearchJobRef = {
      provider: "fake",
      model: "fake-research",
      jobId: "job-1",
      cursor: "3",
    };

    it("attach() resumes through the ref's provider", async () => {
      const adapter = researchAdapter("fake", [spec()]);
      const ns = new ResearchNamespace([adapter], PARSER);
      const job = ns.attach(REF);
      expect(job.jobId).toBe("job-1");
      const result = await job.result();
      expect(result.status).toBe("completed");
    });

    it("attach() throws for unknown providers", () => {
      const ns = new ResearchNamespace([researchAdapter("fake", [spec()])], PARSER);
      expect(() => ns.attach({ ...REF, provider: "nope" })).toThrow(ResearchNotSupportedError);
    });

    it("attach() throws on providers without resume", () => {
      const adapter = researchAdapter("fake", [spec()], { resumeResearch: undefined });
      const ns = new ResearchNamespace([adapter], PARSER);
      expect(() => ns.attach(REF)).toThrow(ResearchJobNotResumableError);
    });

    it("get() delegates to getResearchStatus", async () => {
      const ns = new ResearchNamespace([researchAdapter("fake", [spec()])], PARSER);
      await expect(ns.get(REF)).resolves.toEqual({ status: "in_progress" });
    });

    it("get() throws ResearchNotPollableError without polling support", async () => {
      const adapter = researchAdapter("fake", [spec()], { getResearchStatus: undefined });
      const ns = new ResearchNamespace([adapter], PARSER);
      await expect(ns.get(REF)).rejects.toBeInstanceOf(ResearchNotPollableError);
    });

    it("cancel() delegates to cancelResearch", async () => {
      const cancelResearch = vi.fn(async () => {});
      const adapter = researchAdapter("fake", [spec()], { cancelResearch });
      const ns = new ResearchNamespace([adapter], PARSER);
      await ns.cancel(REF);
      expect(cancelResearch).toHaveBeenCalledWith(REF);
    });
  });

  describe("catalog queries", () => {
    it("listModels() unions adapter catalogs", () => {
      const a = researchAdapter("fake", [spec()]);
      const b = researchAdapter("other", [spec({ provider: "other", modelId: "other-research" })]);
      const ns = new ResearchNamespace([a, b], PARSER);
      expect(ns.listModels().map((s) => s.modelId)).toEqual(["fake-research", "other-research"]);
    });

    it("supportsModel() works with and without provider prefix", () => {
      const ns = new ResearchNamespace(
        [researchAdapter("openai", [spec({ provider: "openai" })])],
        PARSER,
      );
      expect(ns.supportsModel("openai:fake-research")).toBe(true);
      expect(ns.supportsModel("fake-research")).toBe(true); // default provider = openai
      expect(ns.supportsModel("openai:nope")).toBe(false);
    });
  });
});
