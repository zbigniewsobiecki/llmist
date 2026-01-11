/**
 * Format and Timing Utilities
 *
 * Demonstrates the format.* and timing.* utilities for gadget authors.
 * These utilities are especially useful for browser automation and external API calls.
 *
 * Run: npx tsx examples/22-format-timing.ts
 */

import {
  format,
  formatBytes,
  formatDate,
  formatDuration,
  humanDelay,
  randomDelay,
  timing,
  truncate,
  withRetry,
  withTimeout,
} from "llmist";

// =============================================================================
// FORMAT UTILITIES
// =============================================================================

function demoFormatUtilities() {
  console.log("=== Format Utilities ===\n");

  // Truncate long text (useful for limiting gadget output)
  console.log("Truncate examples:");
  console.log(
    `  format.truncate("This is a very long message", 15) → "${format.truncate("This is a very long message", 15)}"`,
  );
  console.log(`  truncate("Short", 10) → "${truncate("Short", 10)}"`);
  console.log(`  truncate("Custom...", 6, "…") → "${truncate("Custom suffix", 6, "…")}"`);
  console.log();

  // Format bytes (useful for file operations)
  console.log("Bytes examples:");
  console.log(`  format.bytes(0) → "${format.bytes(0)}"`);
  console.log(`  format.bytes(1024) → "${format.bytes(1024)}"`);
  console.log(`  format.bytes(1536) → "${format.bytes(1536)}"`);
  console.log(`  formatBytes(1048576) → "${formatBytes(1048576)}"`);
  console.log(`  formatBytes(1073741824) → "${formatBytes(1073741824)}"`);
  console.log();

  // Format dates (useful for displaying timestamps)
  console.log("Date examples:");
  const now = new Date().toISOString();
  console.log(`  format.date("${now.slice(0, 10)}...") → "${format.date(now)}"`);
  console.log(`  formatDate("2024-01-15T10:30:00Z") → "${formatDate("2024-01-15T10:30:00Z")}"`);
  console.log();

  // Format durations (useful for timing operations)
  console.log("Duration examples:");
  console.log(`  format.duration(0) → "${format.duration(0)}"`);
  console.log(`  format.duration(500) → "${format.duration(500)}"`);
  console.log(`  format.duration(1500) → "${format.duration(1500)}"`);
  console.log(`  formatDuration(65000) → "${formatDuration(65000)}"`);
  console.log(`  formatDuration(3661000) → "${formatDuration(3661000)}"`);
  console.log(
    `  formatDuration(3661000, { compact: true }) → "${formatDuration(3661000, { compact: true })}"`,
  );
  console.log();
}

// =============================================================================
// TIMING UTILITIES - BASIC
// =============================================================================

function demoTimingBasics() {
  console.log("=== Timing Utilities - Basics ===\n");

  // Random delay value (doesn't wait, just returns a number)
  console.log("Random delay values:");
  console.log(`  timing.randomDelay(50, 150) → ${timing.randomDelay(50, 150)}ms`);
  console.log(`  timing.randomDelay(50, 150) → ${timing.randomDelay(50, 150)}ms`);
  console.log(`  randomDelay(100, 500) → ${randomDelay(100, 500)}ms`);
  console.log();
}

// =============================================================================
// TIMING UTILITIES - HUMAN DELAY
// =============================================================================

async function demoHumanDelay() {
  console.log("=== Timing Utilities - Human Delay ===\n");

  // Human-like delays (useful for browser automation to avoid detection)
  console.log("Human-like delay (waits 50-150ms by default):");
  const start = Date.now();
  await timing.humanDelay();
  console.log(`  timing.humanDelay() → waited ${Date.now() - start}ms`);

  const start2 = Date.now();
  await humanDelay(100, 200);
  console.log(`  humanDelay(100, 200) → waited ${Date.now() - start2}ms`);
  console.log();
}

// =============================================================================
// TIMING UTILITIES - TIMEOUT
// =============================================================================

async function demoTimeout() {
  console.log("=== Timing Utilities - Timeout ===\n");

  // Timeout wrapper (useful for external API calls)
  console.log("Timeout examples:");

  // Successful operation
  try {
    const result = await timing.withTimeout(
      async () => {
        await new Promise((r) => setTimeout(r, 100));
        return "Success!";
      },
      5000, // 5 second timeout
    );
    console.log(`  Fast operation (100ms, 5s timeout) → "${result}"`);
  } catch (e) {
    console.log(`  Fast operation → ERROR: ${e}`);
  }

  // Operation that times out
  try {
    await withTimeout(
      async () => {
        await new Promise((r) => setTimeout(r, 500));
        return "Should not see this";
      },
      100, // 100ms timeout - will fail
    );
    console.log("  Slow operation (500ms, 100ms timeout) → Completed");
  } catch (e) {
    console.log(`  Slow operation (500ms, 100ms timeout) → ERROR: ${(e as Error).message}`);
  }
  console.log();
}

// =============================================================================
// TIMING UTILITIES - RETRY
// =============================================================================

async function demoRetry() {
  console.log("=== Timing Utilities - Retry ===\n");

  // Retry with exponential backoff
  console.log("Retry with exponential backoff:");
  let attempts = 0;
  try {
    const result = await timing.withRetry(
      async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error(`Attempt ${attempts} failed`);
        }
        return `Success on attempt ${attempts}`;
      },
      {
        maxRetries: 5,
        delay: 50, // Start with 50ms delay
        backoff: "exponential",
        onRetry: (error, attempt) => {
          console.log(`  Retry ${attempt}: ${(error as Error).message}`);
        },
      },
    );
    console.log(`  Final result: "${result}"`);
  } catch (e) {
    console.log(`  All retries failed: ${(e as Error).message}`);
  }
  console.log();

  // Retry with linear backoff
  console.log("Retry with linear backoff:");
  attempts = 0;
  try {
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error(`Attempt ${attempts} failed`);
        }
        return `Success on attempt ${attempts}`;
      },
      {
        maxRetries: 3,
        delay: 50,
        backoff: "linear",
        onRetry: (error, attempt) => {
          console.log(`  Retry ${attempt}: ${(error as Error).message}`);
        },
      },
    );
    console.log(`  Final result: "${result}"`);
  } catch (e) {
    console.log(`  All retries failed: ${(e as Error).message}`);
  }
  console.log();
}

// =============================================================================
// PRACTICAL GADGET EXAMPLES
// =============================================================================

function showPracticalExamples() {
  console.log("=== Practical Gadget Examples ===\n");

  console.log(`
// Browser automation gadget with human-like timing:

import { timing, format, Gadget, z } from 'llmist';

class ClickButton extends Gadget({
  description: 'Click a button with human-like timing',
  schema: z.object({ selector: z.string() }),
}) {
  async execute(params: this['params'], ctx) {
    // Add human-like delay before clicking
    await timing.humanDelay(50, 150);

    const startTime = Date.now();
    await this.page.click(params.selector);
    const duration = Date.now() - startTime;

    return \`Clicked \${params.selector} (took \${format.duration(duration)})\`;
  }
}

// API gadget with retry and timeout:

import { timing, Gadget, z } from 'llmist';

class FetchData extends Gadget({
  description: 'Fetch data from unreliable API',
  schema: z.object({ url: z.string().url() }),
}) {
  async execute(params: this['params'], ctx) {
    const data = await timing.withRetry(
      () => timing.withTimeout(
        () => fetch(params.url).then(r => r.json()),
        5000  // 5 second timeout per attempt
      ),
      {
        maxRetries: 3,
        delay: 1000,
        backoff: 'exponential',
        onRetry: (err, attempt) => {
          ctx?.logger?.warn(\`Retry \${attempt}: \${err.message}\`);
        },
      }
    );
    return JSON.stringify(data);
  }
}

// File operation gadget with formatted output:

import { format, Gadget, z } from 'llmist';

class FileInfo extends Gadget({
  description: 'Get file information',
  schema: z.object({ path: z.string() }),
}) {
  async execute(params: this['params']) {
    const stats = await fs.stat(params.path);
    const content = await fs.readFile(params.path, 'utf-8');

    return JSON.stringify({
      size: format.bytes(stats.size),
      modified: format.date(stats.mtime.toISOString()),
      preview: format.truncate(content, 100),
    });
  }
}
`);
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  demoFormatUtilities();
  demoTimingBasics();
  await demoHumanDelay();
  await demoTimeout();
  await demoRetry();
  showPracticalExamples();

  console.log("=== Done ===\n");
}

main().catch(console.error);
