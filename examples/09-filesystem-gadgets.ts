#!/usr/bin/env bun
/**
 * Example: Using File System Gadgets
 *
 * Demonstrates ReadFile, WriteFile, and ListDirectory gadgets with path sandboxing.
 * These gadgets ensure all file operations are restricted to the current
 * working directory and its subdirectories.
 *
 * Run this example:
 *   bun run examples/09-filesystem-gadgets.ts
 */

import { LLMist } from "../src/index.js";
import { listDirectory, readFile, writeFile } from "./gadgets/filesystem/index.js";

async function main() {
  console.log("=== File System Gadgets Example ===\n");

  // Create an agent with file system gadgets
  const agent = LLMist.createAgent()
    .withModel("gpt-4o-mini")
    .withGadgets(readFile, writeFile, listDirectory);

  // Example 1: Read a file
  console.log("Example 1: Reading package.json");
  console.log("Prompt: What is the name and version from package.json?\n");

  const result1 = await agent.ask("Read the package.json file and tell me the name and version");

  console.log("Response:", result1.text);
  console.log();

  // Example 2: List directory
  console.log("\nExample 2: Listing examples directory");
  console.log("Prompt: What files are in the examples directory?\n");

  const result2 = await agent.ask(
    "List the examples directory and tell me what types of example files are there",
  );

  console.log("Response:", result2.text);
  console.log();

  // Example 3: Write a file
  console.log("\nExample 3: Writing a file");
  console.log("Prompt: Write 'Hello from LLMist!' to temp/greeting.txt\n");

  const result3 = await agent.ask(
    "Write the text 'Hello from LLMist!' to a file called temp/greeting.txt",
  );

  console.log("Response:", result3.text);
  console.log();

  // Example 4: Security - attempt to access outside CWD (will fail)
  console.log("\nExample 4: Testing path sandboxing");
  console.log("Prompt: Try to read /etc/passwd (should be rejected)\n");

  const result4 = await agent.ask("Try to read the file /etc/passwd and tell me what happens");

  console.log("Response:", result4.text);
  console.log("\n=== Example Complete ===");
}

main().catch(console.error);
