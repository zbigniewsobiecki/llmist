/**
 * `llmist deep-research` — deep research runs with cited reports.
 *
 * Streams progress (phases, searches, status) to stderr and the report text
 * to stdout; citations and a cost/usage summary follow the report. Long runs
 * can be detached (`--background` prints a serialized job ref) and picked up
 * later (`--resume <ref>`), or stopped server-side (`--cancel <ref>`).
 */

import { writeFileSync } from "node:fs";
import type { Command } from "commander";
import type { ResearchEvent, ResearchJob, ResearchJobRef, ResearchResult } from "llmist";
import { isAbortError } from "llmist";
import type { ResearchConfig } from "./config.js";
import { COMMANDS, OPTION_DESCRIPTIONS, OPTION_FLAGS, SUMMARY_PREFIX } from "./constants.js";
import type { CLIEnvironment } from "./environment.js";
import { formatCost } from "./ui/formatters.js";
import { executeAction, resolvePrompt } from "./utils.js";

/** Seconds → milliseconds. */
const MS_PER_SECOND = 1_000;

/** Exit code when the run failed outright. */
const EXIT_FAILED = 1;

/** Exit code when the run ended early (incomplete / budget exceeded / cancelled). */
const EXIT_PARTIAL = 2;

export interface ResearchCommandOptions {
  model?: string;
  background?: boolean;
  resume?: string;
  cancel?: string;
  json?: boolean;
  output?: string;
  timeout?: string;
  maxToolCalls?: string;
  quiet?: boolean;
}

function parseRef(raw: string, flag: string): ResearchJobRef {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `${flag} expects the JSON ref printed by --background (e.g. '{"provider":...,"jobId":...}').`,
    );
  }
  const ref = parsed as Partial<ResearchJobRef>;
  if (!ref || typeof ref.provider !== "string" || typeof ref.jobId !== "string") {
    throw new Error(`${flag} ref is missing required "provider"/"jobId" fields.`);
  }
  return ref as ResearchJobRef;
}

/** Strip the rawEvent escape hatch from NDJSON output (huge, provider-specific). */
function toJsonLine(event: ResearchEvent): string {
  const { rawEvent: _rawEvent, ...rest } = event;
  return JSON.stringify(rest);
}

export async function executeResearch(
  promptArg: string | undefined,
  options: ResearchCommandOptions,
  env: CLIEnvironment,
): Promise<void> {
  const client = env.createClient();

  if (options.cancel) {
    const ref = parseRef(options.cancel, "--cancel");
    await client.research.cancel(ref);
    env.stderr.write(`${SUMMARY_PREFIX} Cancelled research job ${ref.jobId} (${ref.provider}).\n`);
    return;
  }

  const timeoutMs =
    options.timeout !== undefined
      ? Number.parseInt(options.timeout, 10) * MS_PER_SECOND
      : undefined;

  // For --background we hold our own abort controller so we can tear down the
  // transport after the job id arrives — the job keeps running server-side.
  const detachController =
    options.background && !options.resume ? new AbortController() : undefined;

  let job: ResearchJob;
  if (options.resume) {
    job = client.research.attach(parseRef(options.resume, "--resume"));
  } else {
    const query = await resolvePrompt(promptArg, env);
    if (!options.model) {
      const available = client.research
        .listModels()
        .map((spec) => `${spec.provider}:${spec.modelId}`)
        .join("\n  ");
      throw new Error(
        `--model is required for research (or set [deep-research].model in the config).\n` +
          `Research-capable models:\n  ${available || "(none — configure provider API keys)"}`,
      );
    }
    job = client.research.start({
      model: options.model,
      query,
      timeoutMs,
      maxToolCalls:
        options.maxToolCalls !== undefined ? Number.parseInt(options.maxToolCalls, 10) : undefined,
      background: options.background ? true : undefined,
      signal: detachController?.signal,
    });
  }

  if (detachController) {
    await runBackgroundDetach(job, detachController, env);
    return;
  }

  const result = options.json
    ? await runJsonStream(job, env)
    : await runFormatted(job, options, env);

  if (result.status === "failed") {
    env.setExitCode(EXIT_FAILED);
  } else if (result.status !== "completed") {
    env.setExitCode(EXIT_PARTIAL);
  }
}

/** Wait for the job id, print the serialized ref, and detach (transport only). */
async function runBackgroundDetach(
  job: ResearchJob,
  detachController: AbortController,
  env: CLIEnvironment,
): Promise<void> {
  try {
    for await (const event of job) {
      if (event.type === "created") {
        if (event.jobId === null) {
          throw new Error(
            "This provider does not support background research jobs — run without --background.",
          );
        }
        env.stdout.write(`${JSON.stringify(job.toRef())}\n`);
        env.stderr.write(
          `${SUMMARY_PREFIX} Research job started in the background. ` +
            `Resume with: llmist deep-research --resume '<ref>'\n`,
        );
        // Detach: abort tears down our transport only; the server-side job
        // keeps running and stays attachable via the printed ref.
        detachController.abort();
        return;
      }
    }
  } catch (error) {
    if (error instanceof Error && isAbortError(error)) {
      return;
    }
    throw error;
  }
}

/** NDJSON mode: one normalized event per line on stdout. */
async function runJsonStream(job: ResearchJob, env: CLIEnvironment): Promise<ResearchResult> {
  for await (const event of job) {
    env.stdout.write(`${toJsonLine(event)}\n`);
  }
  return job.result();
}

/** Human mode: progress on stderr, report on stdout, citations + summary after. */
async function runFormatted(
  job: ResearchJob,
  options: ResearchCommandOptions,
  env: CLIEnvironment,
): Promise<ResearchResult> {
  const showProgress = !options.quiet;
  const reportParts: string[] = [];
  let lastStatus = "";

  for await (const event of job) {
    switch (event.type) {
      case "created":
        if (showProgress && event.jobId) {
          env.stderr.write(`${SUMMARY_PREFIX} Research job ${event.jobId} started.\n`);
        }
        break;
      case "status":
        if (showProgress && event.status !== lastStatus) {
          lastStatus = event.status;
          env.stderr.write(`${SUMMARY_PREFIX} Status: ${event.status}\n`);
        }
        break;
      case "phase":
        if (showProgress) {
          env.stderr.write(`${SUMMARY_PREFIX} Phase: ${event.phase}\n`);
        }
        break;
      case "search":
        if (showProgress && event.status === "started") {
          const detail = event.query ?? event.url ?? "";
          env.stderr.write(`${SUMMARY_PREFIX} Searching${detail ? `: ${detail}` : "..."}\n`);
        }
        break;
      case "text":
        reportParts.push(event.delta);
        if (!options.output) {
          env.stdout.write(event.delta);
        }
        break;
      case "error":
        env.stderr.write(`${SUMMARY_PREFIX} Error: ${event.error.message}\n`);
        break;
      default:
        break;
    }
  }

  const result = await job.result();

  // The report may arrive wholesale in the terminal payload (poll-only models)
  // rather than as streamed deltas.
  const streamed = reportParts.join("");
  if (!options.output && result.report.length > streamed.length) {
    env.stdout.write(result.report.slice(streamed.length));
  }
  const sources =
    result.citations.length > 0
      ? `\nSources:\n${result.citations
          .map((citation, index) => {
            const title = citation.title ? ` — ${citation.title}` : "";
            return `  [${index + 1}] ${citation.url}${title}`;
          })
          .join("\n")}\n`
      : "";

  if (options.output) {
    // Keep the sources with the report — they are part of the deliverable.
    writeFileSync(options.output, sources ? `${result.report}\n${sources}` : result.report);
    env.stderr.write(`${SUMMARY_PREFIX} Report saved to ${options.output}\n`);
  } else {
    env.stdout.write("\n");
    if (sources) {
      env.stdout.write(sources);
    }
  }

  if (showProgress) {
    const parts = [
      `status: ${result.status}`,
      `${result.usage.inputTokens + result.usage.outputTokens} tokens`,
    ];
    if (result.usage.searches !== undefined) {
      parts.push(`${result.usage.searches} searches`);
    }
    if (result.usage.costUSD !== undefined) {
      parts.push(`cost: ${formatCost(result.usage.costUSD)}`);
    }
    if (result.durationMs !== undefined) {
      parts.push(`${Math.round(result.durationMs / MS_PER_SECOND)}s`);
    }
    env.stderr.write(`${SUMMARY_PREFIX} ${parts.join(" | ")}\n`);
  }

  return result;
}

export function registerResearchCommand(
  program: Command,
  env: CLIEnvironment,
  config?: ResearchConfig,
): void {
  program
    .command(COMMANDS.research)
    .description("Run a deep research job and print the cited report.")
    .argument("[query]", "Research question. If omitted, stdin is used when available.")
    .option(OPTION_FLAGS.model, OPTION_DESCRIPTIONS.model, config?.model)
    .option(OPTION_FLAGS.researchBackground, OPTION_DESCRIPTIONS.researchBackground, false)
    .option(OPTION_FLAGS.researchResume, OPTION_DESCRIPTIONS.researchResume)
    .option(OPTION_FLAGS.researchCancel, OPTION_DESCRIPTIONS.researchCancel)
    .option(OPTION_FLAGS.researchJson, OPTION_DESCRIPTIONS.researchJson, config?.json ?? false)
    .option(OPTION_FLAGS.researchOutput, OPTION_DESCRIPTIONS.researchOutput)
    .option(
      OPTION_FLAGS.researchTimeout,
      OPTION_DESCRIPTIONS.researchTimeout,
      config?.timeout?.toString(),
    )
    .option(OPTION_FLAGS.researchMaxToolCalls, OPTION_DESCRIPTIONS.researchMaxToolCalls)
    .option(OPTION_FLAGS.quiet, OPTION_DESCRIPTIONS.quiet, config?.quiet ?? false)
    .action((query, options) =>
      executeAction(() => executeResearch(query, options as ResearchCommandOptions, env), env),
    );
}
