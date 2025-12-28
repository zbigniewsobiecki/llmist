import type { Command } from "commander";
import type {
  AgentConfig,
  CompleteConfig,
  CustomCommandConfig,
  GadgetPermissionPolicy,
  GlobalSubagentConfig,
  InitialGadget,
  SubagentConfigMap,
} from "./config.js";
import { DEFAULT_MODEL, OPTION_DESCRIPTIONS, OPTION_FLAGS } from "./constants.js";
import { createNumericParser } from "./utils.js";

/**
 * CLI options for the complete command (camelCase, matching Commander output).
 */
export interface CLICompleteOptions {
  model: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
  quiet?: boolean;
  logLlmRequests?: boolean;
  /** Path to image file to include with the prompt */
  image?: string;
  /** Path to audio file to include with the prompt */
  audio?: string;
}

/**
 * CLI options for the agent command (camelCase, matching Commander output).
 */
export interface CLIAgentOptions {
  model: string;
  system?: string;
  temperature?: number;
  maxIterations?: number;
  gadget?: string[];
  builtins: boolean;
  builtinInteraction: boolean;
  gadgetStartPrefix?: string;
  gadgetEndPrefix?: string;
  gadgetArgPrefix?: string;
  gadgetApproval?: GadgetPermissionPolicy;
  quiet?: boolean;
  logLlmRequests?: boolean;
  /** Path to image file to include with the initial prompt */
  image?: string;
  /** Path to audio file to include with the initial prompt */
  audio?: string;
  /** Profile-level subagent configuration overrides */
  subagents?: SubagentConfigMap;
  /** Global subagent configuration (from [subagents] section) */
  globalSubagents?: GlobalSubagentConfig;
  /** Pre-seeded gadget results to inject into conversation history */
  initialGadgets?: InitialGadget[];
}

/**
 * Adds complete command options to a Commander command.
 *
 * @param cmd - Command to add options to
 * @param defaults - Optional defaults from config file
 * @returns The command with options added
 */
export function addCompleteOptions(cmd: Command, defaults?: CompleteConfig): Command {
  return cmd
    .option(OPTION_FLAGS.model, OPTION_DESCRIPTIONS.model, defaults?.model ?? DEFAULT_MODEL)
    .option(OPTION_FLAGS.systemPrompt, OPTION_DESCRIPTIONS.systemPrompt, defaults?.system)
    .option(
      OPTION_FLAGS.temperature,
      OPTION_DESCRIPTIONS.temperature,
      createNumericParser({ label: "Temperature", min: 0, max: 2 }),
      defaults?.temperature,
    )
    .option(
      OPTION_FLAGS.maxTokens,
      OPTION_DESCRIPTIONS.maxTokens,
      createNumericParser({ label: "Max tokens", integer: true, min: 1 }),
      defaults?.["max-tokens"],
    )
    .option(OPTION_FLAGS.quiet, OPTION_DESCRIPTIONS.quiet, defaults?.quiet)
    .option(
      OPTION_FLAGS.logLlmRequests,
      OPTION_DESCRIPTIONS.logLlmRequests,
      defaults?.["log-llm-requests"],
    )
    .option(OPTION_FLAGS.inputImage, OPTION_DESCRIPTIONS.inputImage)
    .option(OPTION_FLAGS.inputAudio, OPTION_DESCRIPTIONS.inputAudio);
}

/**
 * Adds agent command options to a Commander command.
 *
 * @param cmd - Command to add options to
 * @param defaults - Optional defaults from config file
 * @returns The command with options added
 */
export function addAgentOptions(cmd: Command, defaults?: AgentConfig): Command {
  // Gadget accumulator needs special handling for defaults
  const gadgetAccumulator = (value: string, previous: string[] = []): string[] => [
    ...previous,
    value,
  ];
  const defaultGadgets = defaults?.gadgets ?? defaults?.gadget ?? [];

  return cmd
    .option(OPTION_FLAGS.model, OPTION_DESCRIPTIONS.model, defaults?.model ?? DEFAULT_MODEL)
    .option(OPTION_FLAGS.systemPrompt, OPTION_DESCRIPTIONS.systemPrompt, defaults?.system)
    .option(
      OPTION_FLAGS.temperature,
      OPTION_DESCRIPTIONS.temperature,
      createNumericParser({ label: "Temperature", min: 0, max: 2 }),
      defaults?.temperature,
    )
    .option(
      OPTION_FLAGS.maxIterations,
      OPTION_DESCRIPTIONS.maxIterations,
      createNumericParser({ label: "Max iterations", integer: true, min: 1 }),
      defaults?.["max-iterations"],
    )
    .option(OPTION_FLAGS.gadgetModule, OPTION_DESCRIPTIONS.gadgetModule, gadgetAccumulator, [
      ...defaultGadgets,
    ])
    .option(OPTION_FLAGS.noBuiltins, OPTION_DESCRIPTIONS.noBuiltins, defaults?.builtins !== false)
    .option(
      OPTION_FLAGS.noBuiltinInteraction,
      OPTION_DESCRIPTIONS.noBuiltinInteraction,
      defaults?.["builtin-interaction"] !== false,
    )
    .option(OPTION_FLAGS.quiet, OPTION_DESCRIPTIONS.quiet, defaults?.quiet)
    .option(
      OPTION_FLAGS.logLlmRequests,
      OPTION_DESCRIPTIONS.logLlmRequests,
      defaults?.["log-llm-requests"],
    )
    .option(OPTION_FLAGS.inputImage, OPTION_DESCRIPTIONS.inputImage)
    .option(OPTION_FLAGS.inputAudio, OPTION_DESCRIPTIONS.inputAudio);
}

/**
 * Converts kebab-case config to camelCase command options for complete command.
 */
export function configToCompleteOptions(
  config: CustomCommandConfig,
): Partial<CLICompleteOptions> {
  const result: Partial<CLICompleteOptions> = {};
  if (config.model !== undefined) result.model = config.model;
  if (config.system !== undefined) result.system = config.system;
  if (config.temperature !== undefined) result.temperature = config.temperature;
  if (config["max-tokens"] !== undefined) result.maxTokens = config["max-tokens"];
  if (config.quiet !== undefined) result.quiet = config.quiet;
  if (config["log-llm-requests"] !== undefined) result.logLlmRequests = config["log-llm-requests"];
  return result;
}

/**
 * Converts kebab-case config to camelCase command options for agent command.
 */
export function configToAgentOptions(config: CustomCommandConfig): Partial<CLIAgentOptions> {
  const result: Partial<CLIAgentOptions> = {};
  if (config.model !== undefined) result.model = config.model;
  if (config.system !== undefined) result.system = config.system;
  if (config.temperature !== undefined) result.temperature = config.temperature;
  if (config["max-iterations"] !== undefined) result.maxIterations = config["max-iterations"];
  // Prefer gadgets (plural) from resolved config, fall back to legacy gadget (singular)
  const gadgets = config.gadgets ?? config.gadget;
  if (gadgets !== undefined) result.gadget = gadgets;
  if (config.builtins !== undefined) result.builtins = config.builtins;
  if (config["builtin-interaction"] !== undefined)
    result.builtinInteraction = config["builtin-interaction"];
  if (config["gadget-start-prefix"] !== undefined)
    result.gadgetStartPrefix = config["gadget-start-prefix"];
  if (config["gadget-end-prefix"] !== undefined)
    result.gadgetEndPrefix = config["gadget-end-prefix"];
  if (config["gadget-arg-prefix"] !== undefined)
    result.gadgetArgPrefix = config["gadget-arg-prefix"];
  if (config["gadget-approval"] !== undefined) result.gadgetApproval = config["gadget-approval"];
  if (config.quiet !== undefined) result.quiet = config.quiet;
  if (config["log-llm-requests"] !== undefined) result.logLlmRequests = config["log-llm-requests"];
  if (config.subagents !== undefined) result.subagents = config.subagents;
  if (config["initial-gadgets"] !== undefined) result.initialGadgets = config["initial-gadgets"];
  return result;
}
