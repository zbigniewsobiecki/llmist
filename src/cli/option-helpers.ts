import { type Command, InvalidArgumentError } from "commander";
import type { ParameterFormat } from "../gadgets/parser.js";
import type { AgentConfig, CompleteConfig, CustomCommandConfig } from "./config.js";
import {
  DEFAULT_MODEL,
  DEFAULT_PARAMETER_FORMAT,
  OPTION_DESCRIPTIONS,
  OPTION_FLAGS,
} from "./constants.js";
import { createNumericParser } from "./utils.js";

/**
 * Options for the complete command (camelCase, matching Commander output).
 */
export interface CompleteCommandOptions {
  model: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Options for the agent command (camelCase, matching Commander output).
 */
export interface AgentCommandOptions {
  model: string;
  system?: string;
  temperature?: number;
  maxIterations?: number;
  gadget?: string[];
  parameterFormat: ParameterFormat;
  builtins: boolean;
  builtinInteraction: boolean;
}

const PARAMETER_FORMAT_VALUES: ParameterFormat[] = ["json", "yaml", "toml", "auto"];

/**
 * Parses and validates the parameter format option value.
 */
function parseParameterFormat(value: string): ParameterFormat {
  const normalized = value.toLowerCase() as ParameterFormat;
  if (!PARAMETER_FORMAT_VALUES.includes(normalized)) {
    throw new InvalidArgumentError(
      `Parameter format must be one of: ${PARAMETER_FORMAT_VALUES.join(", ")}`,
    );
  }
  return normalized;
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
    );
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
  const defaultGadgets = defaults?.gadget ?? [];

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
    .option(
      OPTION_FLAGS.parameterFormat,
      OPTION_DESCRIPTIONS.parameterFormat,
      parseParameterFormat,
      defaults?.["parameter-format"] ?? DEFAULT_PARAMETER_FORMAT,
    )
    .option(OPTION_FLAGS.noBuiltins, OPTION_DESCRIPTIONS.noBuiltins, defaults?.builtins !== false)
    .option(
      OPTION_FLAGS.noBuiltinInteraction,
      OPTION_DESCRIPTIONS.noBuiltinInteraction,
      defaults?.["builtin-interaction"] !== false,
    );
}

/**
 * Converts kebab-case config to camelCase command options for complete command.
 */
export function configToCompleteOptions(config: CustomCommandConfig): Partial<CompleteCommandOptions> {
  const result: Partial<CompleteCommandOptions> = {};
  if (config.model !== undefined) result.model = config.model;
  if (config.system !== undefined) result.system = config.system;
  if (config.temperature !== undefined) result.temperature = config.temperature;
  if (config["max-tokens"] !== undefined) result.maxTokens = config["max-tokens"];
  return result;
}

/**
 * Converts kebab-case config to camelCase command options for agent command.
 */
export function configToAgentOptions(config: CustomCommandConfig): Partial<AgentCommandOptions> {
  const result: Partial<AgentCommandOptions> = {};
  if (config.model !== undefined) result.model = config.model;
  if (config.system !== undefined) result.system = config.system;
  if (config.temperature !== undefined) result.temperature = config.temperature;
  if (config["max-iterations"] !== undefined) result.maxIterations = config["max-iterations"];
  if (config.gadget !== undefined) result.gadget = config.gadget;
  if (config["parameter-format"] !== undefined) result.parameterFormat = config["parameter-format"];
  if (config.builtins !== undefined) result.builtins = config.builtins;
  if (config["builtin-interaction"] !== undefined)
    result.builtinInteraction = config["builtin-interaction"];
  return result;
}
