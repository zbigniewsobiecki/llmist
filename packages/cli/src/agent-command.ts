import chalk from "chalk";
import type { Command } from "commander";
import type { Agent } from "llmist";
import { AgentBuilder } from "llmist";
import { isAbortError } from "llmist";
import type { ContentPart } from "llmist";
import { text } from "llmist";
import type { LLMMessage } from "llmist";
import type { TokenUsage } from "llmist";
import { GadgetRegistry } from "llmist";
import { FALLBACK_CHARS_PER_TOKEN } from "llmist";
import type { ApprovalConfig } from "./approval/index.js";
import { builtinGadgets } from "./builtin-gadgets.js";
import type { AgentConfig, GlobalSubagentConfig } from "./config.js";
import { buildSubagentConfigMap } from "./subagent-config.js";
import { COMMANDS } from "./constants.js";
import type { CLIEnvironment } from "./environment.js";
import { readAudioFile, readImageFile } from "./file-utils.js";
import { loadGadgets } from "./gadgets.js";
import {
  createSessionDir,
  formatCallNumber,
  formatLlmRequest,
  resolveLogDir,
  writeLogFile,
} from "./llm-logging.js";
import { type CLIAgentOptions, addAgentOptions } from "./option-helpers.js";
import { TUIApp, StatusBar } from "./tui/index.js";
import { executeAction, isInteractive, resolvePrompt } from "./utils.js";

/**
 * Executes the agent command.
 *
 * SHOWCASE: This function demonstrates how to build a production-grade CLI
 * on top of llmist's core capabilities:
 *
 * 1. **Dynamic gadget loading** - GadgetRegistry for plugin-like extensibility
 * 2. **Observer hooks** - Custom progress tracking and real-time UI updates
 * 3. **Event-driven execution** - React to agent events (text, gadget results)
 * 4. **ModelRegistry integration** - Automatic cost estimation and tracking
 * 5. **Streaming support** - Display LLM output as it's generated
 * 6. **Human-in-the-loop** - Interactive prompts during agent execution
 * 7. **Clean separation** - stdout for content, stderr for metrics/progress
 *
 * The implementation showcases llmist's flexibility: from simple scripts to
 * polished CLIs with spinners, cost tracking, and real-time feedback.
 *
 * @param promptArg - User prompt from command line argument (optional if using stdin)
 * @param options - Agent command options (model, gadgets, max iterations, etc.)
 * @param env - CLI environment for I/O operations
 */
export async function executeAgent(
  promptArg: string | undefined,
  options: CLIAgentOptions,
  env: CLIEnvironment,
): Promise<void> {
  const client = env.createClient();

  // Detect TUI mode early: use TUI when both stdin and stdout are TTY
  const stdinIsInteractive = isInteractive(env.stdin);
  const stdoutTTY = (env.stdout as NodeJS.WriteStream).isTTY === true;
  const useTUI = stdinIsInteractive && stdoutTTY && !options.quiet;

  // Resolve prompt: required for piped mode, optional for TUI mode (REPL will wait)
  let prompt: string;
  if (useTUI) {
    // TUI mode: prompt is optional (REPL will wait for input if not provided)
    prompt = promptArg ?? "";
  } else {
    // Piped mode: prompt is required
    prompt = await resolvePrompt(promptArg, env);
  }

  // SHOWCASE: llmist's GadgetRegistry for dynamic tool loading
  const registry = new GadgetRegistry();

  // Register built-in gadgets for basic agent interaction
  // AskUser is auto-excluded when stdin/stdout is not interactive (piped input/output)
  if (options.builtins !== false) {
    for (const gadget of builtinGadgets) {
      // Skip AskUser if:
      // 1. --no-builtin-interaction is set, OR
      // 2. stdin is not interactive (piped input), OR
      // 3. stdout is not a TTY (piped output) - can't display questions or collect answers
      if (
        gadget.name === "AskUser" &&
        (options.builtinInteraction === false || !stdinIsInteractive || !stdoutTTY)
      ) {
        continue;
      }
      registry.registerByClass(gadget);
    }
  }

  // Load user-provided gadgets from file paths
  const gadgetSpecifiers = options.gadget ?? [];
  if (gadgetSpecifiers.length > 0) {
    const gadgets = await loadGadgets(gadgetSpecifiers, process.cwd());
    for (const gadget of gadgets) {
      registry.registerByClass(gadget);
    }
  }

  // Create TUI app if in TUI mode
  let tui: TUIApp | null = null;
  if (useTUI) {
    tui = await TUIApp.create({
      model: options.model,
      stdin: env.stdin as NodeJS.ReadStream,
      stdout: env.stdout as NodeJS.WriteStream,
    });
  }

  // Set up cancellation support
  const abortController = new AbortController();
  let wasCancelled = false;

  // Quit handler - cleanup and exit
  const handleQuit = () => {
    if (tui) {
      tui.destroy();
    }
    process.exit(130); // SIGINT convention: 128 + signal number (2)
  };

  // Set up TUI event handlers for ESC and Ctrl+C
  if (tui) {
    tui.onQuit(handleQuit);
    tui.onCancel(() => {
      wasCancelled = true;
      abortController.abort();
    });
  }

  // In piped mode, set up basic SIGINT handler
  if (!useTUI) {
    process.once("SIGINT", () => process.exit(130));
  }

  // Set up gadget approval manager
  // Default: RunCommand, WriteFile, EditFile require approval unless overridden by config
  const DEFAULT_APPROVAL_REQUIRED = ["RunCommand", "WriteFile", "EditFile"];
  const userApprovals = options.gadgetApproval ?? {};

  // Apply defaults for dangerous gadgets if not explicitly configured
  const gadgetApprovals: Record<
    string,
    "allowed" | "denied" | "approval-required"
  > = {
    ...userApprovals,
  };
  for (const gadget of DEFAULT_APPROVAL_REQUIRED) {
    const normalizedGadget = gadget.toLowerCase();
    const isConfigured = Object.keys(userApprovals).some(
      (key) => key.toLowerCase() === normalizedGadget,
    );
    if (!isConfigured) {
      gadgetApprovals[gadget] = "approval-required";
    }
  }

  const approvalConfig: ApprovalConfig = {
    gadgetApprovals,
    defaultMode: "allowed",
  };
  // Approval is handled:
  // - TUI mode: TUI's modal dialogs (in beforeGadgetExecution controller)
  // - Piped mode: auto-deny gadgets requiring approval (can't prompt)

  let usage: TokenUsage | undefined;
  let iterations = 0;

  // Resolve LLM debug log directory (if enabled)
  const llmLogsBaseDir = resolveLogDir(options.logLlmRequests, "requests");
  let llmSessionDir: string | undefined;
  let llmCallCounter = 0;

  // Count tokens accurately using provider-specific methods
  const countMessagesTokens = async (
    model: string,
    messages: LLMMessage[],
  ): Promise<number> => {
    try {
      return await client.countTokens(model, messages);
    } catch {
      // Fallback to character-based estimation if counting fails
      const totalChars = messages.reduce(
        (sum, m) => sum + (m.content?.length ?? 0),
        0,
      );
      return Math.round(totalChars / FALLBACK_CHARS_PER_TOKEN);
    }
  };

  // Count tokens for gadget output text
  const countGadgetOutputTokens = async (
    output: string | undefined,
  ): Promise<number | undefined> => {
    if (!output) return undefined;
    try {
      // Wrap gadget output as assistant message for accurate token counting
      const messages: LLMMessage[] = [{ role: "assistant", content: output }];
      return await client.countTokens(options.model, messages);
    } catch {
      // Fallback: return undefined to trigger byte count fallback in formatter
      return undefined;
    }
  };

  // Build the agent with hooks for progress tracking
  // SHOWCASE: This demonstrates llmist's observer pattern for building custom UIs
  //
  // For simpler use cases, use HookPresets.progressTracking() instead:
  //   .withHooks(HookPresets.progressTracking({
  //     modelRegistry: client.modelRegistry,
  //     onProgress: (stats) => { /* update your UI */ }
  //   }))
  //
  // The CLI uses custom hooks for fine-grained control over the spinner animation
  // and real-time updates, showcasing llmist's flexibility for building polished UIs.
  // Build resolved subagent config map for subagent gadgets to inherit settings
  const resolvedSubagentConfig = buildSubagentConfigMap(
    options.model,
    options.subagents,
    options.globalSubagents,
  );

  const builder = new AgentBuilder(client)
    .withModel(options.model)
    .withSubagentConfig(resolvedSubagentConfig)
    .withLogger(env.createLogger("llmist:cli:agent"))
    .withHooks({
      observers: {
        // onLLMCallStart: Update TUI with LLM call info and estimated input tokens
        onLLMCallStart: async (context) => {
          if (context.subagentContext) return;
          llmCallCounter++;

          if (tui) {
            // Estimate input tokens from messages
            const estimatedInput = await countMessagesTokens(
              context.options.model,
              context.options.messages,
            );
            tui.showLLMCallStart(iterations + 1, context.options.model, estimatedInput);
          }
        },

        // onLLMCallReady: Log the exact request being sent to the LLM
        onLLMCallReady: async (context) => {
          if (context.subagentContext) return;

          // Store raw request in TUI for raw viewer
          if (tui) {
            tui.setLLMCallRequest(context.options.messages);
          }

          if (llmLogsBaseDir) {
            if (!llmSessionDir) {
              llmSessionDir = await createSessionDir(llmLogsBaseDir);
            }
            if (llmSessionDir) {
              const filename = `${formatCallNumber(llmCallCounter)}.request`;
              const content = formatLlmRequest(context.options.messages);
              await writeLogFile(llmSessionDir, filename, content);
            }
          }
        },

        // onStreamChunk: Update status bar with real-time output token estimate
        onStreamChunk: async (context) => {
          if (context.subagentContext) return;
          if (!tui) return;

          // Use accumulated text from context to estimate output tokens
          const estimatedOutputTokens = StatusBar.estimateTokens(context.accumulatedText);
          tui.updateStreamingTokens(estimatedOutputTokens);
        },

        // onLLMCallComplete: Update TUI with completion metrics
        onLLMCallComplete: async (context) => {
          if (context.subagentContext) return;

          // Capture completion metadata
          usage = context.usage;
          iterations = Math.max(iterations, context.iteration + 1);

          // Calculate per-call cost
          let callCost: number | undefined;
          if (context.usage && client.modelRegistry) {
            try {
              const modelName = context.options.model.includes(":")
                ? context.options.model.split(":")[1]
                : context.options.model;
              const costResult = client.modelRegistry.estimateCost(
                modelName,
                context.usage.inputTokens,
                context.usage.outputTokens,
                context.usage.cachedInputTokens ?? 0,
                context.usage.cacheCreationInputTokens ?? 0,
              );
              if (costResult) callCost = costResult.totalCost;
            } catch {
              // Ignore cost calculation errors
            }
          }

          if (tui) {
            tui.showLLMCallComplete({
              iteration: context.iteration + 1,
              model: context.options.model,
              inputTokens: context.usage?.inputTokens,
              outputTokens: context.usage?.outputTokens,
              cachedInputTokens: context.usage?.cachedInputTokens,
              elapsedSeconds: tui.getElapsedSeconds(),
              cost: callCost,
              finishReason: context.finishReason ?? "stop",
              rawResponse: context.rawResponse,
            });
          }

          // Write LLM response to debug log if enabled
          if (llmSessionDir) {
            const filename = `${formatCallNumber(llmCallCounter)}.response`;
            await writeLogFile(llmSessionDir, filename, context.rawResponse);
          }
        },
      },

      // SHOWCASE: Controller-based approval gating for gadgets
      //
      // This demonstrates how to add safety layers WITHOUT modifying gadgets.
      // The ApprovalManager handles approval flows externally via beforeGadgetExecution.
      // Approval modes are configurable via cli.toml:
      //   - "allowed": auto-proceed
      //   - "denied": auto-reject, return message to LLM
      //   - "approval-required": prompt user interactively
      //
      // Default: RunCommand, WriteFile, EditFile require approval unless overridden.
      controllers: {
        beforeGadgetExecution: async (ctx) => {
          // Get approval mode from config
          const normalizedGadgetName = ctx.gadgetName.toLowerCase();
          const configuredMode = Object.entries(gadgetApprovals).find(
            ([key]) => key.toLowerCase() === normalizedGadgetName,
          )?.[1];
          const mode = configuredMode ?? approvalConfig.defaultMode;

          // Fast path: allowed gadgets proceed immediately
          if (mode === "allowed") {
            return { action: "proceed" };
          }

          // Check if we can prompt (interactive mode required for approval-required)
          const stdinTTY = isInteractive(env.stdin);
          const stderrTTY = (env.stderr as NodeJS.WriteStream).isTTY === true;
          const canPrompt = stdinTTY && stderrTTY;

          // Non-interactive mode handling
          if (!canPrompt) {
            if (mode === "approval-required") {
              return {
                action: "skip",
                syntheticResult: `status=denied\n\n${ctx.gadgetName} requires interactive approval. Run in a terminal to approve.`,
              };
            }
            if (mode === "denied") {
              return {
                action: "skip",
                syntheticResult: `status=denied\n\n${ctx.gadgetName} is denied by configuration.`,
              };
            }
            return { action: "proceed" };
          }

          // TUI mode: use TUI's modal approval dialog
          if (tui) {
            const response = await tui.showApproval({
              gadgetName: ctx.gadgetName,
              parameters: ctx.parameters,
            });

            if (response === "yes" || response === "always") {
              // TODO: Handle "always" by updating gadgetApprovals
              return { action: "proceed" };
            }
            return {
              action: "skip",
              syntheticResult: `status=denied\n\nDenied by user`,
            };
          }

          // Piped mode: can't prompt for approval, deny
          return {
            action: "skip",
            syntheticResult: `status=denied\n\n${ctx.gadgetName} requires interactive approval. Run in a terminal to approve.`,
          };
        },
      },
    });

  // Add optional configurations
  if (options.system) {
    builder.withSystem(options.system);
  }
  if (options.maxIterations !== undefined) {
    builder.withMaxIterations(options.maxIterations);
  }
  if (options.temperature !== undefined) {
    builder.withTemperature(options.temperature);
  }

  // Set up human input handler (TUI mode only)
  // In piped mode, AskUser gadget is excluded (see gadget registration above)
  if (tui) {
    builder.onHumanInput(async (question: string) => {
      return tui.waitForInput(question, "AskUser");
    });
  }

  // Pass abort signal for ESC key cancellation
  builder.withSignal(abortController.signal);

  // Add gadgets from the registry
  const gadgets = registry.getAll();
  if (gadgets.length > 0) {
    builder.withGadgets(...gadgets);
  }

  // Set custom gadget markers if configured, otherwise use library defaults
  if (options.gadgetStartPrefix) {
    builder.withGadgetStartPrefix(options.gadgetStartPrefix);
  }
  if (options.gadgetEndPrefix) {
    builder.withGadgetEndPrefix(options.gadgetEndPrefix);
  }
  if (options.gadgetArgPrefix) {
    builder.withGadgetArgPrefix(options.gadgetArgPrefix);
  }

  // Inject synthetic heredoc example for in-context learning
  // This teaches the LLM to use heredoc syntax (<<<EOF...EOF) for multiline strings
  // by showing what "past self" did correctly. LLMs mimic patterns in conversation history.
  builder.withSyntheticGadgetCall(
    "TellUser",
    {
      message:
        "👋 Hello! I'm ready to help.\n\nWhat would you like me to work on?",
      done: false,
      type: "info",
    },
    "ℹ️  👋 Hello! I'm ready to help.\n\nWhat would you like me to work on?",
    "gc_init_1",
  );

  // Continue looping when LLM responds with just text (no gadget calls)
  // This allows multi-turn conversations where the LLM may explain before acting
  builder.withTextOnlyHandler("acknowledge");

  // Wrap text that accompanies gadget calls as TellUser gadget calls
  // This keeps conversation history consistent and gadget-oriented
  builder.withTextWithGadgetsHandler({
    gadgetName: "TellUser",
    parameterMapping: (text) => ({ message: text, done: false, type: "info" }),
    resultMapping: (text) => `ℹ️  ${text}`,
  });

  // Inject ephemeral trailing message to encourage parallel gadget invocations
  // This message is appended to each LLM request but NOT persisted in history
  builder.withTrailingMessage((ctx) =>
    [
      `[Iteration ${ctx.iteration + 1}/${ctx.maxIterations}]`,
      "Think carefully in two steps: 1. what gadget invocations we should be making next? 2. how do they depend on one another so we can run all of them in the right order? Then respond with all the gadget invocations you are able to do now.",
    ].join(" "),
  );

  // Track current agent for REPL session continuity and mid-session injection
  let currentAgent: Agent | null = null;

  // Helper to create and run an agent with a given prompt
  const runAgentWithPrompt = async (userPrompt: string) => {
    // Reset abort controller for new iteration (TUI mode)
    if (tui) {
      tui.resetAbort();
      builder.withSignal(tui.getAbortSignal());
    }

    // Continue from previous agent's conversation history (REPL session continuity)
    if (currentAgent) {
      builder.continueFrom(currentAgent);
    }

    // Build the agent
    let agent: Agent;
    if (options.image || options.audio) {
      const parts: ContentPart[] = [text(userPrompt)];
      if (options.image) {
        parts.push(await readImageFile(options.image));
      }
      if (options.audio) {
        parts.push(await readAudioFile(options.audio));
      }
      agent = builder.askWithContent(parts);
    } else {
      agent = builder.ask(userPrompt);
    }

    // Store reference for mid-session injection and next session's history
    currentAgent = agent;

    // Subscribe TUI to ExecutionTree for automatic block management
    // This handles nested subagent events automatically via tree events
    let unsubscribeTree: (() => void) | undefined;
    if (tui) {
      unsubscribeTree = tui.subscribeToTree(agent.getTree());
    }

    // Run the agent and handle events
    for await (const event of agent.run()) {
      if (tui) {
        // TUI mode: pass all events to TUI
        tui.handleEvent(event);

        // Track gadget costs in TUI status bar
        if (event.type === "gadget_result" && event.result.cost) {
          tui.addGadgetCost(event.result.cost);
        }
      } else {
        // Piped mode: output text events and TellUser messages to stdout
        if (event.type === "text") {
          env.stdout.write(event.content);
        } else if (
          event.type === "gadget_result" &&
          event.result.gadgetName === "TellUser" &&
          event.result.result
        ) {
          // TellUser gadget returns formatted message in result field
          env.stdout.write(`${event.result.result}\n`);
        }
      }
    }

    // Flush any buffered text
    if (tui) {
      tui.flushText();
    }

    // Clean up tree subscription
    if (unsubscribeTree) {
      unsubscribeTree();
    }
  };

  // TUI mode: REPL loop - wait for input, run agent, repeat
  // Piped mode: Run once and exit
  if (tui) {
    // Wire up mid-session input: when user submits input during a running session,
    // echo the message immediately and inject it into the agent's conversation
    tui.onMidSessionInput((message) => {
      // Echo the user's message immediately (before agent processes)
      tui.showUserMessage(message);
      if (currentAgent) {
        currentAgent.injectUserMessage(message);
      }
    });

    // Get initial prompt (from CLI arg or wait for user input)
    let currentPrompt = prompt;
    if (!currentPrompt) {
      tui.setFocusMode("input"); // Start in input mode for fresh sessions
      currentPrompt = await tui.waitForPrompt();
      tui.showUserMessage(currentPrompt); // Echo the user's message
    }

    // REPL loop
    while (true) {
      try {
        await runAgentWithPrompt(currentPrompt);
      } catch (error) {
        // Handle abort gracefully - continue to next prompt
        if (!isAbortError(error)) {
          throw error;
        }
      }

      // Wait for next prompt
      currentPrompt = await tui.waitForPrompt();
      tui.showUserMessage(currentPrompt); // Echo the user's message
    }
  } else {
    // Piped mode: run once and exit
    try {
      await runAgentWithPrompt(prompt);
    } catch (error) {
      if (!isAbortError(error)) {
        throw error;
      }
    }
  }
}

/**
 * Registers the agent command with the CLI program.
 * Configures options for model, gadgets, max iterations, temperature, and parameter format.
 *
 * @param program - Commander program to register the command with
 * @param env - CLI environment for dependencies and I/O
 * @param config - Optional configuration defaults from config file
 */
export function registerAgentCommand(
  program: Command,
  env: CLIEnvironment,
  config?: AgentConfig,
  globalSubagents?: GlobalSubagentConfig,
): void {
  const cmd = program
    .command(COMMANDS.agent)
    .description("Run the llmist agent loop with optional gadgets.")
    .argument(
      "[prompt]",
      "Prompt for the agent loop. Falls back to stdin when available.",
    );

  addAgentOptions(cmd, config);

  cmd.action((prompt, options) =>
    executeAction(() => {
      // Merge config-only options (no CLI flags) into command options
      const mergedOptions: CLIAgentOptions = {
        ...(options as CLIAgentOptions),
        gadgetApproval: config?.["gadget-approval"],
        subagents: config?.subagents,
        globalSubagents,
      };
      return executeAgent(prompt, mergedOptions, env);
    }, env),
  );
}
