#!/usr/bin/env npx tsx
/**
 * Test script to verify subagent events flow through the ExecutionTree.
 *
 * This loads the Dhalsim BrowseWeb gadget and runs an agent that uses it,
 * logging all tree events to verify nested LLM calls and gadget calls appear.
 *
 * Run: npx tsx scripts/test-subagent-events.ts
 */

import { LLMist } from "../src/core/client.js";
import type { ExecutionEvent } from "../src/core/execution-events.js";

async function main() {
  console.log("🔧 Loading Dhalsim gadgets from ~/Code/dhalsim...\n");

  // Dynamically import Dhalsim directly from TypeScript source
  const dhalsimPath = process.env.HOME + "/Code/dhalsim/src/subagents/dhalsim.ts";
  const { Dhalsim } = await import(dhalsimPath);

  console.log("✅ Dhalsim loaded\n");

  // Create agent with BrowseWeb gadget
  const agent = LLMist.createAgent()
    .withModel("sonnet")
    .withGadgets(Dhalsim)
    .withMaxIterations(5)
    .withSystem(`You are a helpful assistant with web browsing capabilities.
When asked to browse the web, use the Dhalsim gadget to navigate and interact with web pages.`)
    .ask("Use Dhalsim to go to https://example.com and tell me what the page title is.");

  // Subscribe to ALL tree events for debugging
  const tree = agent.getTree();
  const events: ExecutionEvent[] = [];

  console.log("📊 Subscribing to tree events...\n");
  console.log("=".repeat(70));

  tree.onAll((event) => {
    events.push(event);

    // Log each event as it happens
    const depth = "  ".repeat(event.depth);
    const timestamp = new Date().toISOString().split("T")[1].slice(0, 12);

    switch (event.type) {
      case "llm_call_start":
        console.log(
          `${timestamp} ${depth}🔵 LLM Call Start [depth=${event.depth}] model=${event.model}`,
        );
        break;
      case "llm_call_complete":
        console.log(
          `${timestamp} ${depth}🟢 LLM Call Complete [depth=${event.depth}] tokens=${event.usage?.inputTokens ?? "?"}/${event.usage?.outputTokens ?? "?"}`,
        );
        break;
      case "llm_call_error":
        console.log(`${timestamp} ${depth}🔴 LLM Call Error [depth=${event.depth}] ${event.error}`);
        break;
      case "gadget_call":
        console.log(
          `${timestamp} ${depth}⚙️  Gadget Call [depth=${event.depth}] ${event.name} (${event.invocationId})`,
        );
        break;
      case "gadget_complete":
        console.log(
          `${timestamp} ${depth}✅ Gadget Complete [depth=${event.depth}] ${event.name} cost=$${event.cost?.toFixed(4) ?? "0"}`,
        );
        break;
      case "gadget_error":
        console.log(
          `${timestamp} ${depth}❌ Gadget Error [depth=${event.depth}] ${event.name}: ${event.error}`,
        );
        break;
      case "text":
        // Skip text events to reduce noise
        break;
      default:
        console.log(`${timestamp} ${depth}📌 ${event.type} [depth=${event.depth}]`);
    }
  });

  console.log("\n🚀 Running agent...\n");

  try {
    let finalText = "";
    for await (const event of agent.run()) {
      if (event.type === "text") {
        finalText += event.content;
        process.stdout.write(event.content);
      }
    }

    console.log("\n\n" + "=".repeat(70));
    console.log("\n📈 Event Summary:\n");

    // Analyze events
    const llmStarts = events.filter((e) => e.type === "llm_call_start");
    const llmCompletes = events.filter((e) => e.type === "llm_call_complete");
    const gadgetCalls = events.filter((e) => e.type === "gadget_call");
    const gadgetCompletes = events.filter((e) => e.type === "gadget_complete");

    const parentLLMCalls = llmStarts.filter((e) => e.depth === 0);
    const subagentLLMCalls = llmStarts.filter((e) => e.depth > 0);

    const parentGadgets = gadgetCalls.filter((e) => e.depth === 0);
    const subagentGadgets = gadgetCalls.filter((e) => e.depth > 0);

    console.log(`Total events captured: ${events.length}`);
    console.log(`  LLM calls: ${llmStarts.length} starts, ${llmCompletes.length} completes`);
    console.log(`    - Parent (depth=0): ${parentLLMCalls.length}`);
    console.log(`    - Subagent (depth>0): ${subagentLLMCalls.length}`);
    console.log(
      `  Gadget calls: ${gadgetCalls.length} starts, ${gadgetCompletes.length} completes`,
    );
    console.log(`    - Parent (depth=0): ${parentGadgets.length}`);
    console.log(`    - Subagent (depth>0): ${subagentGadgets.length}`);

    // Calculate total cost from tree
    const totalCost = tree.getTotalCost();
    const totalTokens = tree.getTotalTokens();

    console.log(`\n💰 Total Cost: $${totalCost.toFixed(4)}`);
    console.log(`📊 Total Tokens: ${totalTokens.inputTokens} in / ${totalTokens.outputTokens} out`);

    // Verdict
    console.log("\n" + "=".repeat(70));
    if (subagentLLMCalls.length > 0) {
      console.log("✅ SUCCESS: Subagent LLM calls ARE visible in parent tree!");
    } else {
      console.log("❌ FAILURE: No subagent LLM calls visible in parent tree");
    }

    if (subagentGadgets.length > 0) {
      console.log("✅ SUCCESS: Subagent gadget calls ARE visible in parent tree!");
    } else {
      console.log(
        "⚠️  WARNING: No subagent gadget calls visible (may be expected if Dhalsim used no gadgets)",
      );
    }
  } catch (error) {
    console.error("\n❌ Agent error:", error);
  }
}

main().catch(console.error);
