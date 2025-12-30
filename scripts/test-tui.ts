#!/usr/bin/env npx tsx
/**
 * Test script for the TUI implementation.
 *
 * Run with: npx tsx scripts/test-tui.ts
 *
 * Press ESC or Ctrl+C twice to exit.
 *
 * This test demonstrates:
 * 1. Text content rendering
 * 2. Parallel gadget execution with out-of-order results
 * 3. Results appearing directly below their opening lines
 */

import { TUIApp } from "../src/cli/tui/index.js";

async function main() {
  console.log("Starting TUI test...");

  // Create TUI app
  const tui = await TUIApp.create({ model: "test-model" });

  // Handle quit
  tui.onQuit(() => {
    console.log("\nQuitting...");
    tui.destroy();
    process.exit(0);
  });

  // === Timeline of events ===

  // 500ms: LLM call starts
  setTimeout(() => {
    tui.showLLMCallStart(1, "claude-sonnet-4");
  }, 500);

  // 1000ms: Some text output
  setTimeout(() => {
    tui.handleEvent({
      type: "text",
      content: "I'll read several files for you in parallel.\n",
    });
    tui.flushText();
  }, 1000);

  // 1500ms: Start 3 parallel gadgets
  setTimeout(() => {
    // Gadget 1: ReadFile (will complete 3rd)
    tui.handleEvent({
      type: "gadget_call",
      call: {
        gadgetName: "ReadFile",
        invocationId: "read-1",
        parameters: { path: "/src/index.ts" },
        dependencies: [],
      },
    });
    // Gadget 2: ListDirectory (will complete 1st - fastest)
    tui.handleEvent({
      type: "gadget_call",
      call: {
        gadgetName: "ListDirectory",
        invocationId: "list-1",
        parameters: { path: "/src", maxDepth: 1 },
        dependencies: [],
      },
    });
    // Gadget 3: ReadFile (will complete 2nd)
    tui.handleEvent({
      type: "gadget_call",
      call: {
        gadgetName: "ReadFile",
        invocationId: "read-2",
        parameters: { path: "/package.json" },
        dependencies: [],
      },
    });
  }, 1500);

  // 1700ms: ListDirectory completes first (fastest)
  setTimeout(() => {
    tui.handleEvent({
      type: "gadget_result",
      result: {
        gadgetName: "ListDirectory",
        invocationId: "list-1",
        parameters: { path: "/src", maxDepth: 1 },
        result: "index.ts\ncli.ts\nagent/\ngadgets/",
        executionTimeMs: 15,
      },
    });
  }, 1700);

  // 2000ms: ReadFile /package.json completes second
  setTimeout(() => {
    tui.handleEvent({
      type: "gadget_result",
      result: {
        gadgetName: "ReadFile",
        invocationId: "read-2",
        parameters: { path: "/package.json" },
        result: '{ "name": "llmist", "version": "6.0.0" }',
        executionTimeMs: 45,
      },
    });
  }, 2000);

  // 2500ms: ReadFile /src/index.ts completes last (slowest)
  setTimeout(() => {
    tui.handleEvent({
      type: "gadget_result",
      result: {
        gadgetName: "ReadFile",
        invocationId: "read-1",
        parameters: { path: "/src/index.ts" },
        result: 'export * from "./agent";\nexport * from "./gadgets";',
        executionTimeMs: 120,
      },
    });
  }, 2500);

  // 3000ms: More text after gadgets
  setTimeout(() => {
    tui.handleEvent({
      type: "text",
      content: "\nAll files have been read. Here's what I found...",
    });
    tui.flushText();
  }, 3000);

  // 3500ms: LLM call completes
  setTimeout(() => {
    tui.showLLMCallComplete({
      iteration: 1,
      model: "claude-sonnet-4",
      inputTokens: 1500,
      outputTokens: 450,
      cachedInputTokens: 500,
      elapsedSeconds: 3.5,
      cost: 0.0052,
      finishReason: "stop",
    });
  }, 3500);

  // Keep running
  await new Promise(() => {});
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
