/**
 * Research namespace — `client.research`.
 *
 * Mirrors the image/speech capability namespaces: dispatches to the first
 * adapter (in priority order) that supports the model, after validating the
 * request against the model's catalog spec. Providers plug in via the
 * optional research methods on {@link ProviderAdapter}.
 */

import type { ILogObj, Logger } from "tslog";
import type { ModelDescriptor, ModelIdentifierParser } from "../core/options.js";
import { createLogger } from "../logging/logger.js";
import type { ProviderAdapter } from "../providers/provider.js";
import { MS_PER_DAY, RESEARCH_SHUTDOWN_WARNING_WINDOW_DAYS } from "./constants.js";
import {
  ResearchDeprecatedModelError,
  ResearchJobNotResumableError,
  ResearchNotPollableError,
  ResearchNotSupportedError,
  ResearchValidationError,
} from "./errors.js";
import { ResearchJobImpl } from "./job.js";
import type { ResearchModelSpec } from "./model-spec.js";
import type {
  ResearchJob,
  ResearchJobRef,
  ResearchOptions,
  ResearchStatusSnapshot,
  ResearchToolConfig,
} from "./types.js";
import { RESEARCH_DATA_SOURCE_TOOL_TYPES } from "./types.js";

export class ResearchNamespace {
  private readonly logger: Logger<ILogObj>;

  constructor(
    private readonly adapters: ProviderAdapter[],
    private readonly parser: ModelIdentifierParser,
    private readonly now: () => number = Date.now,
    logger?: Logger<ILogObj>,
  ) {
    this.logger = logger ?? createLogger({ name: "llmist:research" });
  }

  /**
   * Start a research run. Returns immediately; the provider stream opens
   * lazily on first iteration (or on `result()`).
   */
  start(options: ResearchOptions): ResearchJob {
    const descriptor = this.parser.parse(options.model);
    const adapter = this.findResearchAdapter(descriptor);
    if (!adapter) {
      throw new ResearchNotSupportedError(
        `No provider supports deep research for model "${options.model}". ` +
          `Research-capable models: ${this.describeAvailableModels()}`,
      );
    }

    const spec = this.findSpec(adapter, descriptor.name);
    const validated = spec ? this.validate(options, spec) : options;

    return new ResearchJobImpl({ adapter, descriptor, spec, options: validated });
  }

  /**
   * Re-attach to a background research job from a serialized ref.
   * No network happens until the returned job is iterated.
   */
  attach(ref: ResearchJobRef): ResearchJob {
    const adapter = this.findAdapterByProviderId(ref.provider);
    if (!adapter) {
      throw new ResearchNotSupportedError(
        `No registered provider with id "${ref.provider}" to attach research job "${ref.jobId}".`,
      );
    }
    if (!adapter.resumeResearch) {
      throw new ResearchJobNotResumableError(
        `Provider "${ref.provider}" does not support resuming research jobs.`,
      );
    }
    const descriptor: ModelDescriptor = { provider: ref.provider, name: ref.model };
    const spec = this.findSpec(adapter, ref.model);
    return new ResearchJobImpl({ adapter, descriptor, spec, resumeFrom: ref });
  }

  /** One-shot status poll for a job ref. */
  async get(ref: ResearchJobRef): Promise<ResearchStatusSnapshot> {
    const adapter = this.findAdapterByProviderId(ref.provider);
    if (!adapter) {
      throw new ResearchNotSupportedError(`No registered provider with id "${ref.provider}".`);
    }
    if (!adapter.getResearchStatus) {
      throw new ResearchNotPollableError(
        `Provider "${ref.provider}" does not support research status polling.`,
      );
    }
    return adapter.getResearchStatus(ref);
  }

  /** Cancel a background job server-side. */
  async cancel(ref: ResearchJobRef): Promise<void> {
    const adapter = this.findAdapterByProviderId(ref.provider);
    if (!adapter) {
      throw new ResearchNotSupportedError(`No registered provider with id "${ref.provider}".`);
    }
    if (!adapter.cancelResearch) {
      throw new ResearchNotSupportedError(
        `Provider "${ref.provider}" does not support cancelling research jobs.`,
      );
    }
    return adapter.cancelResearch(ref);
  }

  /** All research-capable models/agents across registered providers. */
  listModels(): ResearchModelSpec[] {
    const specs: ResearchModelSpec[] = [];
    for (const adapter of this.adapters) {
      specs.push(...(adapter.getResearchModelSpecs?.() ?? []));
    }
    return specs;
  }

  /** Whether any registered provider supports research for this model. */
  supportsModel(model: string): boolean {
    try {
      return this.findResearchAdapter(this.parser.parse(model)) !== undefined;
    } catch {
      return false;
    }
  }

  private findResearchAdapter(descriptor: ModelDescriptor): ProviderAdapter | undefined {
    return this.adapters.find(
      (adapter) =>
        adapter.supports(descriptor) && (adapter.supportsResearch?.(descriptor.name) ?? false),
    );
  }

  private findAdapterByProviderId(providerId: string): ProviderAdapter | undefined {
    return this.adapters.find((adapter) => adapter.providerId === providerId);
  }

  private findSpec(adapter: ProviderAdapter, modelId: string): ResearchModelSpec | undefined {
    return adapter.getResearchModelSpecs?.().find((spec) => spec.modelId === modelId);
  }

  private describeAvailableModels(): string {
    const models = this.listModels();
    if (models.length === 0) {
      return "(none registered)";
    }
    return models.map((spec) => `${spec.provider}:${spec.modelId}`).join(", ");
  }

  /**
   * Pre-flight validation against the catalog spec — fails fast before any
   * network call and applies spec-driven defaults.
   */
  private validate(options: ResearchOptions, spec: ResearchModelSpec): ResearchOptions {
    this.enforceLifecycle(spec);

    const background = options.background ?? spec.capabilities.background;
    if (background && !spec.capabilities.background) {
      throw new ResearchValidationError(
        `Model "${spec.modelId}" does not support background research jobs.`,
      );
    }

    if (options.previousJobId && !spec.capabilities.followUps) {
      throw new ResearchValidationError(
        `Model "${spec.modelId}" does not support follow-up research runs (previousJobId).`,
      );
    }

    const tools = this.resolveTools(options, spec);

    return { ...options, background, tools };
  }

  private resolveTools(
    options: ResearchOptions,
    spec: ResearchModelSpec,
  ): ResearchToolConfig[] | undefined {
    if (options.tools === undefined) {
      return spec.requiredTools;
    }

    for (const tool of options.tools) {
      if (!spec.capabilities.tools.includes(tool.type)) {
        throw new ResearchValidationError(
          `Model "${spec.modelId}" does not accept the "${tool.type}" tool. ` +
            (spec.capabilities.tools.length > 0
              ? `Accepted tools: ${spec.capabilities.tools.join(", ")}.`
              : "This model manages its research tools itself — omit the tools option."),
        );
      }
    }

    const hasDataSource = options.tools.some((tool) =>
      RESEARCH_DATA_SOURCE_TOOL_TYPES.includes(tool.type),
    );
    if (!hasDataSource && spec.requiredTools) {
      return [...spec.requiredTools, ...options.tools];
    }
    return options.tools;
  }

  private enforceLifecycle(spec: ResearchModelSpec): void {
    const shutdownDate = spec.metadata?.shutdownDate;
    if (!shutdownDate) {
      return;
    }
    const shutdownMs = Date.parse(shutdownDate);
    if (Number.isNaN(shutdownMs)) {
      return;
    }
    const nowMs = this.now();
    if (nowMs >= shutdownMs) {
      throw new ResearchDeprecatedModelError({
        modelId: spec.modelId,
        shutdownDate,
        replacement: spec.metadata?.replacement,
      });
    }
    const warningStartMs = shutdownMs - RESEARCH_SHUTDOWN_WARNING_WINDOW_DAYS * MS_PER_DAY;
    if (nowMs >= warningStartMs) {
      this.logger.warn(
        `Research model "${spec.modelId}" shuts down on ${shutdownDate}` +
          (spec.metadata?.replacement ? ` — migrate to "${spec.metadata.replacement}".` : "."),
      );
    }
  }
}
