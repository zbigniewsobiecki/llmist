import type { Command } from "commander";
import type { ContentPart, ReasoningConfig, ReasoningEffort, TokenUsage } from "llmist";
import {
  FALLBACK_CHARS_PER_TOKEN,
  formatLlmRequest,
  LLMMessageBuilder,
  resolveModel,
  text,
} from "llmist";
import type { CompleteConfig } from "./config.js";
import { COMMANDS } from "./constants.js";
import type { CLIEnvironment } from "./environment.js";
import { readAudioFile, readImageFile, readSystemPromptFile } from "./file-utils.js";
import { writeLogFile } from "./llm-logging.js";
import { addCompleteOptions, type CLICompleteOptions } from "./option-helpers.js";
import {
  executeAction,
  renderSummary,
  resolvePrompt,
  StreamPrinter,
  StreamProgress,
} from "./utils.js";

/**
 * Executes the complete command.
 * Streams a single LLM response without agent loop or gadgets.
 *
 * @param promptArg - User prompt from command line argument (optional if using stdin)
 * @param options - Complete command options (model, system prompt, temperature, etc.)
 * @param env - CLI environment for I/O operations
 */
export async function executeComplete(
  promptArg: string | undefined,
  options: CLICompleteOptions,
  env: CLIEnvironment,
): Promise<void> {
  const prompt = await resolvePrompt(promptArg, env);
  const client = env.createClient();
  const model = resolveModel(options.model);

  const builder = new LLMMessageBuilder();

  // Resolve system prompt (inline or from file)
  let systemPrompt = options.system;
  if (options.systemFile) {
    if (options.system) {
      throw new Error("Cannot use both --system and --system-file options");
    }
    systemPrompt = await readSystemPromptFile(options.systemFile);
  }

  if (systemPrompt) {
    builder.addSystem(systemPrompt);
  }

  // Build multimodal message if --image or --audio flags are present
  if (options.image || options.audio) {
    const parts: ContentPart[] = [text(prompt)];

    if (options.image) {
      parts.push(await readImageFile(options.image));
    }
    if (options.audio) {
      parts.push(await readAudioFile(options.audio));
    }

    builder.addUserMultimodal(parts);
  } else {
    builder.addUser(prompt);
  }

  const messages = builder.build();

  // LLM request logging: use session directory if enabled
  const llmLogsEnabled = options.logLlmRequests === true;
  const llmLogDir = llmLogsEnabled ? env.session?.logDir : undefined;

  // Log request before streaming
  if (llmLogDir) {
    const filename = "0001.request";
    const content = formatLlmRequest(messages);
    await writeLogFile(llmLogDir, filename, content);
  }

  // Resolve reasoning configuration
  // Precedence: --no-reasoning > --reasoning/--reasoning-budget > config > auto-detect
  let reasoning: ReasoningConfig | undefined;
  if (options.reasoning === false) {
    reasoning = { enabled: false };
  } else if (options.reasoning !== undefined || options.reasoningBudget !== undefined) {
    const effort = typeof options.reasoning === "string" ? options.reasoning : undefined;
    reasoning = {
      enabled: true,
      ...(effort && { effort: effort as ReasoningEffort }),
      ...(options.reasoningBudget && { budgetTokens: options.reasoningBudget }),
    };
  } else if (options.profileReasoning) {
    const cfg = options.profileReasoning;
    if (cfg.enabled === false) {
      reasoning = { enabled: false };
    } else {
      reasoning = {
        enabled: true,
        ...(cfg.effort && { effort: cfg.effort as ReasoningEffort }),
        ...(cfg["budget-tokens"] && { budgetTokens: cfg["budget-tokens"] }),
      };
    }
  }

  const stream = client.stream({
    model,
    messages,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    ...(reasoning && { reasoning }),
  });

  const printer = new StreamPrinter(env.stdout);
  const stderrTTY = (env.stderr as NodeJS.WriteStream).isTTY === true;
  const progress = new StreamProgress(env.stderr, stderrTTY, client.modelRegistry);

  // Calculate estimated tokens from all message content (system + user)
  let estimatedInputTokens = 0;
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      estimatedInputTokens += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text") {
          estimatedInputTokens += part.text.length;
        }
        // Note: image/audio parts aren't easily estimable, skip for now
      }
    }
  }
  estimatedInputTokens = Math.round(estimatedInputTokens / FALLBACK_CHARS_PER_TOKEN);
  progress.startCall(model, estimatedInputTokens);

  let finishReason: string | null | undefined;
  let usage: TokenUsage | undefined;
  let accumulatedResponse = "";

  try {
    for await (const chunk of stream) {
      // Capture actual usage from stream
      if (chunk.usage) {
        usage = chunk.usage;
        if (chunk.usage.inputTokens) {
          progress.setInputTokens(chunk.usage.inputTokens, false);
        }
        if (chunk.usage.outputTokens) {
          progress.setOutputTokens(chunk.usage.outputTokens, false);
        }
      }
      if (chunk.thinking?.content) {
        // Show thinking content on stderr in dim styling
        if (stderrTTY && !options.quiet) {
          progress.pause();
          env.stderr.write(`\x1b[2m${chunk.thinking.content}\x1b[0m`);
        }
      }
      if (chunk.text) {
        progress.pause(); // Must pause to avoid stderr/stdout interleaving
        accumulatedResponse += chunk.text;
        progress.update(accumulatedResponse.length); // Update token estimate from chars
        printer.write(chunk.text);
      }
      if (chunk.finishReason !== undefined) {
        finishReason = chunk.finishReason;
      }
    }
    progress.endCall(usage); // Calculate cost before completing
  } finally {
    progress.complete(); // Always stop spinner, even on error
  }
  printer.ensureNewline();

  // Log response after streaming
  if (llmLogDir) {
    const filename = "0001.response";
    await writeLogFile(llmLogDir, filename, accumulatedResponse);
  }

  // Only show summary if stderr is a TTY (not redirected) and not in quiet mode
  if (stderrTTY && !options.quiet) {
    const summary = renderSummary({ finishReason, usage, cost: progress.getTotalCost() });
    if (summary) {
      env.stderr.write(`${summary}\n`);
    }
  }
}

/**
 * Registers the complete command with the CLI program.
 * Configures options for model, system prompt, temperature, and max tokens.
 *
 * @param program - Commander program to register the command with
 * @param env - CLI environment for dependencies and I/O
 * @param config - Optional configuration defaults from config file
 */
export function registerCompleteCommand(
  program: Command,
  env: CLIEnvironment,
  config?: CompleteConfig,
  globalRateLimits?: import("./config.js").RateLimitsConfig,
  globalRetry?: import("./config.js").RetryConfigCLI,
): void {
  const cmd = program
    .command(COMMANDS.complete)
    .description("Stream a single completion from a specified model.")
    .argument("[prompt]", "Prompt to send to the LLM. If omitted, stdin is used when available.");

  addCompleteOptions(cmd, config);

  cmd.action((prompt, options) =>
    executeAction(() => {
      const mergedOptions: CLICompleteOptions = {
        ...(options as CLICompleteOptions),
        globalRateLimits,
        globalRetry,
        profileReasoning: config?.reasoning,
      };
      return executeComplete(prompt, mergedOptions, env);
    }, env),
  );
}
