/**
 * Deep Research module (spec 002-deep-research).
 */

export { ResearchResultCollector } from "./collector.js";
export * from "./constants.js";
export { estimateResearchCost } from "./cost.js";
export {
  ResearchDeprecatedModelError,
  ResearchJobNotResumableError,
  ResearchNotPollableError,
  ResearchNotSupportedError,
  ResearchStreamConsumedError,
  ResearchTimeoutError,
  ResearchValidationError,
} from "./errors.js";
export { ResearchJobImpl } from "./job.js";
export type {
  ResearchCapabilities,
  ResearchModelMetadata,
  ResearchModelSpec,
  ResearchPricing,
} from "./model-spec.js";
export { ResearchNamespace } from "./namespace.js";
export type {
  ResearchCitation,
  ResearchDoneInfo,
  ResearchErrorInfo,
  ResearchEvent,
  ResearchJob,
  ResearchJobRef,
  ResearchOptions,
  ResearchResult,
  ResearchStatus,
  ResearchStatusSnapshot,
  ResearchToolConfig,
  ResearchToolType,
  ResearchUsage,
} from "./types.js";
export { RESEARCH_DATA_SOURCE_TOOL_TYPES } from "./types.js";
