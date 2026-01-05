/**
 * Error Handling Patterns with llmist
 *
 * Demonstrates:
 * 1. Gadget-level error handling with helpers
 * 2. Agent-level error observation with hooks
 * 3. LLM API error recovery with controllers
 * 4. Retry configuration for transient failures
 * 5. Proactive rate limiting to prevent errors
 * 6. Retry-After header support for graceful backoff
 *
 * Run: npx tsx examples/12-error-handling.ts
 */

import {
  type AgentHooks,
  Gadget,
  gadgetError,
  gadgetSuccess,
  LLMist,
  withErrorHandling,
} from "llmist";
import { z } from "zod";

// ============================================================================
// 1. GADGET-LEVEL ERROR HANDLING
// ============================================================================

/**
 * A gadget that demonstrates structured error responses.
 *
 * Using gadgetError() returns a JSON error that the LLM can understand
 * and potentially recover from in subsequent iterations.
 */
class ApiCallGadget extends Gadget({
  description: "Calls an external API endpoint",
  schema: z.object({
    endpoint: z.string().describe("API endpoint to call"),
    method: z.enum(["GET", "POST"]).default("GET"),
  }),
}) {
  async execute(params: this["params"]): Promise<string> {
    const { endpoint, method } = params;

    try {
      const response = await fetch(endpoint, { method });

      if (!response.ok) {
        // Return structured error - LLM can understand and adapt
        return gadgetError(`HTTP ${response.status}: ${response.statusText}`, {
          endpoint,
          suggestion: response.status === 404 ? "Check if the URL is correct" : "Try again later",
        });
      }

      const data = await response.json();
      return gadgetSuccess({ data, status: response.status });
    } catch (error) {
      // Network errors, DNS failures, etc.
      return gadgetError(error instanceof Error ? error.message : "Unknown error", {
        endpoint,
        errorType: "network",
      });
    }
  }
}

/**
 * Using withErrorHandling() wrapper for automatic try/catch.
 *
 * Any thrown error is automatically caught and formatted as gadgetError().
 */
class FileReaderGadget extends Gadget({
  description: "Reads a file from disk",
  schema: z.object({
    path: z.string().describe("File path to read"),
  }),
}) {
  execute = withErrorHandling(async (params: this["params"]): Promise<string> => {
    const fs = await import("node:fs/promises");

    // If this throws (file not found, permission denied, etc.),
    // withErrorHandling catches it and returns gadgetError(message)
    const content = await fs.readFile(params.path, "utf-8");

    return gadgetSuccess({
      path: params.path,
      size: content.length,
      preview: content.slice(0, 100),
    });
  });
}

// ============================================================================
// 2. AGENT-LEVEL ERROR OBSERVATION
// ============================================================================

/**
 * Hooks for observing errors without affecting execution.
 * Great for logging, metrics, and debugging.
 */
const errorObservingHooks: AgentHooks = {
  observers: {
    // Log when gadget execution completes (success or failure)
    onGadgetExecutionComplete: (ctx) => {
      if (ctx.error) {
        console.log(`[ERROR] Gadget "${ctx.gadgetName}" failed:`, ctx.error);
        console.log(`  Execution time: ${ctx.executionTimeMs}ms`);
      } else {
        console.log(`[OK] Gadget "${ctx.gadgetName}" succeeded in ${ctx.executionTimeMs}ms`);
      }
    },

    // Log LLM call completions
    onLLMCallComplete: (ctx) => {
      if (ctx.error) {
        console.log(`[ERROR] LLM call failed:`, ctx.error);
      } else {
        console.log(`[OK] LLM call completed (${ctx.usage?.totalTokens ?? 0} tokens)`);
      }
    },
  },
};

// ============================================================================
// 3. LLM ERROR RECOVERY WITH CONTROLLERS
// ============================================================================

/**
 * Controllers can recover from LLM errors by providing fallback responses.
 * Useful for graceful degradation when the API is unavailable.
 */
const errorRecoveryHooks: AgentHooks = {
  controllers: {
    // Recover from LLM API errors with a fallback response
    afterLLMError: async (ctx) => {
      console.log(`[RECOVERY] LLM error detected: ${ctx.error.message}`);

      // Check if it's an authentication error
      if (ctx.error.message.includes("401") || ctx.error.message.includes("Unauthorized")) {
        return {
          action: "fail" as const,
          error: new Error("Authentication failed. Please check your API key."),
        };
      }

      // For other errors, provide a fallback
      return {
        action: "recover" as const,
        fallbackResponse:
          "I apologize, but I'm experiencing technical difficulties. Please try again in a moment.",
      };
    },

    // Recover from gadget execution errors
    afterGadgetExecution: async (ctx) => {
      if (ctx.error) {
        console.log(`[RECOVERY] Gadget "${ctx.gadgetName}" failed, providing fallback`);
        return {
          action: "recover" as const,
          fallbackResult: gadgetError("Gadget execution failed", {
            gadgetName: ctx.gadgetName,
            originalError: ctx.error.message,
          }),
        };
      }
      return { action: "proceed" as const };
    },
  },
};

// ============================================================================
// 4. RETRY CONFIGURATION
// ============================================================================

async function demonstrateRetry() {
  console.log("\n=== Retry Configuration ===\n");

  const agent = LLMist.createAgent()
    .withModel("haiku")
    .withRetry({
      enabled: true,
      retries: 3,
      minTimeout: 1000, // Start with 1 second delay
      maxTimeout: 10000, // Max 10 second delay
      factor: 2, // Exponential backoff

      // Called before each retry
      onRetry: (error, attempt) => {
        console.log(`[RETRY] Attempt ${attempt} after error: ${error.message}`);
      },

      // Called when all retries are exhausted
      onRetriesExhausted: (error, attempts) => {
        console.log(`[FAILED] All ${attempts} retries exhausted. Final error: ${error.message}`);
      },

      // Custom logic for which errors to retry
      shouldRetry: (error) => {
        // Don't retry auth errors
        if (error.message.includes("401")) return false;
        // Retry rate limits and server errors
        if (error.message.includes("429") || error.message.includes("500")) return true;
        // Default: retry on network errors
        return error.message.includes("ECONNRESET") || error.message.includes("timeout");
      },
    })
    .ask("Hello!");

  try {
    const result = await agent.askAndCollect("Say hello");
    console.log("Result:", result);
  } catch (error) {
    console.log("Final error:", error);
  }
}

// ============================================================================
// 5. PROACTIVE RATE LIMITING
// ============================================================================

/**
 * Configure rate limits based on your API tier to prevent rate limit errors.
 * The agent will automatically delay requests when approaching limits.
 */
async function demonstrateRateLimiting() {
  console.log("\n=== Proactive Rate Limiting ===\n");

  const _agent = LLMist.createAgent()
    .withModel("flash") // Gemini
    .withRateLimits({
      // Configure for Gemini free tier
      requestsPerMinute: 15,
      tokensPerMinute: 1_000_000,
      safetyMargin: 0.8, // Start throttling at 80% of limit

      // Optional: daily token limit for Gemini free tier
      // tokensPerDay: 1_500_000,
    })
    .withRetry({
      retries: 3,
      respectRetryAfter: true, // Honor Retry-After headers
    });

  console.log("Agent configured with rate limits:");
  console.log("  - 15 RPM (requests per minute)");
  console.log("  - 1M TPM (tokens per minute)");
  console.log("  - Safety margin: 80%");
  console.log("\nThe agent will automatically delay requests when approaching limits.\n");

  // In production, you would use the agent like this:
  // for (let i = 0; i < 20; i++) {
  //   await agent.askAndCollect(`Question ${i}`);
  //   // Agent automatically paces requests to stay within limits
  // }

  console.log("(Skipping actual requests in demo to avoid rate limits)\n");
}

// ============================================================================
// 6. RETRY-AFTER HEADER SUPPORT
// ============================================================================

/**
 * llmist automatically parses and respects Retry-After headers from providers.
 * When a provider says "wait 30 seconds", llmist will wait before retrying.
 */
async function demonstrateRetryAfter() {
  console.log("\n=== Retry-After Header Support ===\n");

  const _agent = LLMist.createAgent()
    .withModel("sonnet")
    .withRetry({
      retries: 3,
      respectRetryAfter: true, // Default: true
      maxRetryAfterMs: 60000, // Cap at 1 minute (default: 2 minutes)

      onRetry: (error, attempt) => {
        console.log(`[RETRY ${attempt}] ${error.message}`);

        // Check if the error includes Retry-After info
        // Anthropic/OpenAI: error.headers['retry-after']
        // Gemini: Parsed from message like "retry in 45.2s"
        const errorWithHeaders = error as Error & { headers?: Record<string, string> };
        if (errorWithHeaders.headers?.["retry-after"]) {
          console.log(
            `  Provider requested: Retry-After ${errorWithHeaders.headers["retry-after"]}s`,
          );
        }
      },
    });

  console.log("Retry-After is enabled by default.");
  console.log("When providers send Retry-After headers, llmist will:");
  console.log("  1. Parse the delay (seconds or HTTP date)");
  console.log("  2. Wait the requested time (capped at maxRetryAfterMs)");
  console.log("  3. Retry the request");
  console.log("\nSupported providers:");
  console.log("  - Anthropic: HTTP Retry-After header");
  console.log("  - OpenAI: HTTP Retry-After header");
  console.log("  - Gemini: Parsed from error message (e.g., 'retry in 45.2s')\n");
}

// ============================================================================
// 7. COMPLETE EXAMPLE WITH ALL PATTERNS
// ============================================================================

async function main() {
  console.log("=== Error Handling Patterns ===\n");

  // Demo 1: Gadget with structured error handling
  console.log("--- 1. Gadget-Level Error Handling ---\n");

  const _agentWithGadgets = LLMist.createAgent()
    .withModel("haiku")
    .withGadgets(ApiCallGadget, FileReaderGadget)
    .withHooks(errorObservingHooks);

  // The LLM might try to call a non-existent API or read a missing file.
  // The gadgets will return structured errors that the LLM can understand.
  console.log("Agent configured with error-handling gadgets.\n");

  // Demo 2: Error observation hooks
  console.log("--- 2. Error Observation Hooks ---\n");
  console.log("Hooks will log: [ERROR] or [OK] for each gadget and LLM call.\n");

  // Demo 3: Error recovery with controllers
  console.log("--- 3. Error Recovery Controllers ---\n");

  const _resilientAgent = LLMist.createAgent()
    .withModel("haiku")
    .withHooks(errorRecoveryHooks)
    .ask("Hello!");

  console.log("Controller hooks can recover from LLM/gadget errors with fallback responses.\n");

  // Demo 4: Retry configuration
  await demonstrateRetry();

  // Demo 5: Proactive rate limiting
  await demonstrateRateLimiting();

  // Demo 6: Retry-After header support
  await demonstrateRetryAfter();

  // Demo 7: Putting it all together
  console.log("\n--- 7. Full Example ---\n");

  try {
    const answer = await LLMist.createAgent()
      .withModel("haiku")
      .withSystem("You are a helpful assistant. If a tool fails, explain the error to the user.")
      .withGadgets(ApiCallGadget)
      .withHooks({
        ...errorObservingHooks,
        ...errorRecoveryHooks,
      })
      .withRetry({ retries: 2 })
      .askAndCollect("Call the API at https://httpstat.us/500 and tell me what happened.");

    console.log("Final answer:", answer);
  } catch (error) {
    console.log("Agent failed with error:", error);
  }

  console.log("\n=== Done ===");
}

main().catch(console.error);
