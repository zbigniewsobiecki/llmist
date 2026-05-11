import type { Command } from "commander";
import type { Agent, AgentHooks, ContentPart, TokenUsage } from "llmist";
import { AgentBuilder, GadgetRegistry, HookPresets, isAbortError, text } from "llmist";
import { configureAgentBuilder } from "./agent-builder-config.js";
import type { ApprovalConfig } from "./approval/index.js";
import { getBuiltinGadgets } from "./builtin-gadgets.js";
import type { AgentConfig, CLIConfig, GlobalSubagentConfig } from "./config.js";
import { getCustomCommandNames, loadConfig } from "./config.js";
import { COMMANDS } from "./constants.js";
import type { CLIEnvironment } from "./environment.js";
import { readAudioFile, readImageFile } from "./file-utils.js";
import { loadGadgets } from "./gadgets.js";
import { addAgentOptions, type CLIAgentOptions } from "./option-helpers.js";
import { CLISkillManager } from "./skills/skill-manager.js";
import { parseSlashCommand } from "./skills/slash-handler.js";
import { buildSubagentConfigMap } from "./subagent-config.js";
import { TUIApp } from "./tui/index.js";
import { createTUIHooks } from "./tui/tui-hooks.js";
import { executeAction, isInteractive, resolvePrompt } from "./utils.js";

/**
 * Safely loads the CLI config, returning null if loading fails (e.g., no config file present).
 * Use this instead of calling loadConfig() directly when config is optional.
 */
function loadConfigSafe(): CLIConfig | null {
  try {
    return loadConfig();
  } catch {
    return null;
  }
}

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
  commandName?: string,
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

  // Load config once at the top — all config values are derived from this single result.
  // loadConfigSafe() returns null if no config file exists or loading fails.
  const fullConfig = loadConfigSafe();
  const speechConfig = fullConfig?.speech;
  const skillsConfig = fullConfig?.skills;

  // SHOWCASE: llmist's GadgetRegistry for dynamic tool loading
  const registry = new GadgetRegistry();

  // Register built-in gadgets for basic agent interaction
  // AskUser is auto-excluded when stdin/stdout is not interactive (piped input/output)
  if (options.builtins !== false) {
    const builtins = getBuiltinGadgets(speechConfig);
    for (const gadget of builtins) {
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

  // Load skills from config sources and standard locations
  const skillManager = new CLISkillManager();
  const skillRegistry = await skillManager.loadAll(skillsConfig);

  // Create TUI app if in TUI mode
  let tui: TUIApp | null = null;
  if (useTUI) {
    tui = await TUIApp.create({
      model: options.model,
      stdin: env.stdin as NodeJS.ReadStream,
      stdout: env.stdout as NodeJS.WriteStream,
      showHints: options.showHints,
    });

    // Load available profiles for Ctrl+P cycling
    // Profiles allow users to switch between agent configurations between sessions
    const customProfiles = fullConfig ? getCustomCommandNames(fullConfig) : [];
    // "agent" is the default profile, custom profiles come from cli.toml sections
    const profiles = ["agent", ...customProfiles];
    // Set initial profile to match the command being run
    tui.setProfiles(profiles, commandName ?? "agent");

    // If no initial prompt, start waiting for input early
    // This puts the REPL in "waiting" mode immediately, enabling Ctrl+P profile cycling
    // The Promise constructor runs synchronously, so isPendingREPLPrompt is set right away
    if (!prompt) {
      tui.setFocusMode("input");
      tui.startWaitingForPrompt();
    }
  }

  // Set up cancellation support
  const abortController = new AbortController();
  let _wasCancelled = false;

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
      _wasCancelled = true;
      abortController.abort();
    });
  }

  // In piped mode, set up basic SIGINT handler
  if (!useTUI) {
    process.once("SIGINT", () => process.exit(130));
  }

  // Set up gadget approval manager
  // Default: RunCommand, WriteFile, EditFile require approval unless overridden by config
  const DEFAULT_APPROVAL_REQUIRED = ["RunCommand", "WriteFile", "EditFile", "DeleteFile"];
  const userApprovals = options.gadgetApproval ?? {};

  // Apply defaults for dangerous gadgets if not explicitly configured
  const gadgetApprovals: Record<string, "allowed" | "denied" | "approval-required"> = {
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

  const usageRef: { value: TokenUsage | undefined } = { value: undefined };
  const iterationsRef: { value: number } = { value: 0 };

  // LLM request logging: use session directory if enabled
  const llmLogsEnabled = options.logLlmRequests === true;
  const llmLogDir = llmLogsEnabled ? env.session?.logDir : undefined;

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

  // Build TUI-specific hooks for progress tracking and UI updates
  const tuiHooks: AgentHooks = createTUIHooks({
    tui,
    env,
    gadgetApprovals,
    approvalConfig,
    iterationsRef,
    usageRef,
  });

  // Combine TUI hooks with file logging (if enabled via --log-llm-requests flag)
  const finalHooks = llmLogDir
    ? HookPresets.merge(HookPresets.fileLogging({ directory: llmLogDir }), tuiHooks)
    : tuiHooks;

  const builder = new AgentBuilder(client);

  // Configure the builder with all settings via the extracted helper.
  // This covers: model, subagent config, logger, hooks, rate limits, retry,
  // system prompt, iterations, budget, temperature, reasoning, skills,
  // human-input handler, abort signal, gadgets, MCP servers, gadget markers,
  // synthetic gadget calls, text handlers, and trailing message.
  await configureAgentBuilder(builder, options, {
    resolvedSubagentConfig,
    finalHooks,
    skillRegistry,
    gadgetRegistry: registry,
    tui,
    abortController,
    fullConfig,
    env,
  });

  // Track current agent for REPL session continuity and mid-session injection
  let currentAgent: Agent | null = null;

  // Helper to create and run an agent with a given prompt
  const runAgentWithPrompt = async (userPrompt: string) => {
    // Clear per-iteration skill state to prevent accumulation across REPL sessions
    builder.clearPreActivatedSkills();

    // Handle /skill-name slash commands
    if (skillRegistry.size > 0 && userPrompt.startsWith("/")) {
      const slashResult = parseSlashCommand(userPrompt, skillRegistry);
      if (slashResult.isSkillInvocation) {
        if (slashResult.isListCommand) {
          // Show available skills inline instead of running the agent
          const skills = skillRegistry.getUserInvocable();
          const lines = skills.map((s) => `  /${s.name} — ${s.description}`);
          const msg =
            skills.length > 0 ? `Available skills:\n${lines.join("\n")}` : "No skills available.";
          if (tui) {
            tui.showUserMessage(`/skills`);
            tui.showUserMessage(msg);
          } else {
            env.stdout.write(`${msg}\n`);
          }
          return;
        }
        if (slashResult.skillName) {
          builder.withSkill(slashResult.skillName, slashResult.arguments);
        }
      }
    }

    // Reset abort controller for new iteration (TUI mode)
    if (tui) {
      tui.resetAbort();
      tui.startNewSession(); // Increment session counter for new blocks
      tui.showUserMessage(userPrompt); // Echo user message with correct sessionId
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
        } else if (event.type === "thinking") {
          // Show thinking content on stderr in dim styling (piped mode only)
          const stderrTTY = (env.stderr as NodeJS.WriteStream).isTTY === true;
          if (stderrTTY && !options.quiet) {
            env.stderr.write(`\x1b[2m${event.content}\x1b[0m`);
          }
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

    // Clear PREVIOUS session's blocks (deferred cleanup)
    // Current session content stays visible for user to read and for next session's context
    // The previous session was kept visible during this session for context reference
    if (tui) {
      tui.clearPreviousSession();
      tui.clearStatusBar();
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
  globalRateLimits?: import("./config.js").RateLimitsConfig,
  globalRetry?: import("./config.js").RetryConfigCLI,
): void {
  const cmd = program
    .command(COMMANDS.agent)
    .description("Run the llmist agent loop with optional gadgets.")
    .argument("[prompt]", "Prompt for the agent loop. Falls back to stdin when available.");

  addAgentOptions(cmd, config);

  cmd.action((prompt, options) =>
    executeAction(() => {
      // Merge config-only options (no CLI flags) into command options
      const mergedOptions: CLIAgentOptions = {
        ...(options as CLIAgentOptions),
        gadgetApproval: config?.["gadget-approval"],
        subagents: config?.subagents,
        globalSubagents,
        initialGadgets: config?.["initial-gadgets"],
        globalRateLimits,
        globalRetry,
        profileRateLimits: config?.["rate-limits"],
        profileRetry: config?.retry,
        profileReasoning: config?.reasoning,
        showHints: config?.["show-hints"],
      };
      return executeAgent(prompt, mergedOptions, env, "agent");
    }, env),
  );
}
