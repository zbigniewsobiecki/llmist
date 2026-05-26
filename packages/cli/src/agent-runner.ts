/**
 * Agent runner — encapsulates the REPL loop and piped-mode single-run.
 *
 * Extracted from `agent-command.ts` so that `executeAgent` becomes a slim
 * orchestrator that sets up dependencies and delegates here.
 *
 * @module cli/agent-runner
 */

import type { Agent, AgentBuilder, ContentPart, SkillRegistry } from "llmist";
import { isAbortError, text } from "llmist";
import type { CLIEnvironment } from "./environment.js";
import { readAudioFile, readImageFile } from "./file-utils.js";
import { parseSlashCommand } from "./skills/slash-handler.js";
import type { TUIApp } from "./tui/index.js";

/**
 * Options required by the agent runner loop.
 */
export interface AgentRunnerOptions {
  /** Configured AgentBuilder (model, hooks, skills, gadgets, etc. already applied). */
  builder: AgentBuilder;
  /** TUI app instance in TUI mode; null in piped mode. */
  tui: TUIApp | null;
  /** CLI environment for I/O. */
  env: CLIEnvironment;
  /** Skill registry for slash command resolution. */
  skillRegistry: SkillRegistry;
  /** Initial prompt (empty string means "wait for user input" in TUI mode). */
  prompt: string;
  /** Input-media options forwarded from the CLI flags. */
  mediaOptions?: {
    image?: string;
    audio?: string;
  };
  /** Whether quiet mode is active (suppresses thinking output in piped mode). */
  quiet?: boolean;
}

/**
 * Runs the agent loop.
 *
 * - **TUI mode** (`tui != null`): enters the REPL loop, waiting for successive
 *   prompts until the process exits.
 * - **Piped mode** (`tui == null`): runs the agent once with the provided
 *   prompt, then returns.
 *
 * Both modes share the same `runAgentWithPrompt` inner logic so that
 * behaviour is identical regardless of how the loop is driven.
 */
export async function runAgentLoop(runnerOptions: AgentRunnerOptions): Promise<void> {
  const { builder, tui, env, skillRegistry, mediaOptions, quiet, prompt } = runnerOptions;

  // Mutable state shared between loop iterations
  let currentAgent: Agent | null = null;

  // ──────────────────────────────────────────────────────────────────────────
  // Inner helper: build and run the agent for a single prompt
  // ──────────────────────────────────────────────────────────────────────────

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
    if (mediaOptions?.image || mediaOptions?.audio) {
      const parts: ContentPart[] = [text(userPrompt)];
      if (mediaOptions.image) {
        parts.push(await readImageFile(mediaOptions.image));
      }
      if (mediaOptions.audio) {
        parts.push(await readAudioFile(mediaOptions.audio));
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
          if (stderrTTY && !quiet) {
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

  // ──────────────────────────────────────────────────────────────────────────
  // TUI mode: REPL loop
  // ──────────────────────────────────────────────────────────────────────────

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
    // ────────────────────────────────────────────────────────────────────────
    // Piped mode: run once and exit
    // ────────────────────────────────────────────────────────────────────────
    try {
      await runAgentWithPrompt(prompt);
    } catch (error) {
      if (!isAbortError(error)) {
        throw error;
      }
    }
  }
}
