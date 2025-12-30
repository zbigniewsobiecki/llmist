/**
 * Multi-BrowseWeb Test: Testing WriteStream singleton fix
 *
 * This example tests the fix for the WriteStream resource accumulation bug
 * by making multiple BrowseWeb calls in sequence. Before the fix, this would
 * cause a freeze when the second BrowseWeb started.
 *
 * Run with logging enabled to verify the fix:
 *   LLMIST_LOG_FILE=/tmp/llmist-test.log npx tsx examples/21-browseweb-multi-call.ts
 *
 * Or run via CLI (using git URL since dhalsim is not on npm yet):
 *   llmist agent "Summarize top article on edition.cnn.com and tvn24.pl" \
 *     -g "git+https://github.com/zbigniewsobiecki/dhalsim.git:subagent" \
 *     --log-file /tmp/test.log
 *
 * Or using local path:
 *   llmist agent "Summarize top article on edition.cnn.com and tvn24.pl" \
 *     -g ~/Code/dhalsim:subagent --log-file /tmp/test.log
 */

import { LLMist } from "../src/core/client.js";
import { loadGadgets } from "../src/cli/gadgets.js";

async function main() {
  console.log("=== Multi-BrowseWeb WriteStream Test ===\n");

  // Load BrowseWeb from dhalsim (local path - adjust if needed)
  // Use git URL if not available locally: "git+https://github.com/zbigniewsobiecki/dhalsim.git:subagent"
  const dhalsimPath = process.env.DHALSIM_PATH || "../dhalsim";
  console.log(`Loading BrowseWeb gadget from ${dhalsimPath}...`);
  const gadgets = await loadGadgets([`${dhalsimPath}:subagent`], process.cwd());
  console.log(`Loaded: ${gadgets.map((g) => g.name).join(", ")}\n`);

  // Create agent with BrowseWeb
  const client = new LLMist();
  const agent = client
    .createAgent()
    .withModel("gemini-2.5-flash")
    .withMaxIterations(5)
    .withGadgets(...gadgets)
    .ask(
      "I need you to do TWO browsing tasks:\n" +
        "1. First, browse edition.cnn.com, identify the top news article, and summarize it briefly.\n" +
        "2. Then, browse tvn24.pl, identify the top news article, and summarize it briefly.\n" +
        "Report both summaries when done."
    );

  console.log("Starting agent with multiple BrowseWeb calls...\n");
  console.log("---\n");

  // Run and stream events
  let browseWebCount = 0;
  for await (const event of agent.run()) {
    switch (event.type) {
      case "gadget_call":
        if (event.name === "BrowseWeb") {
          browseWebCount++;
          console.log(`\n>>> BrowseWeb #${browseWebCount} starting: ${event.params?.url}`);
        }
        break;
      case "gadget_result":
        if (event.name === "BrowseWeb") {
          console.log(`<<< BrowseWeb #${browseWebCount} completed\n`);
        }
        break;
      case "text":
        // Stream text output
        process.stdout.write(event.content);
        break;
    }
  }

  console.log("\n\n---");
  console.log(`\nTest completed! BrowseWeb was called ${browseWebCount} times.`);

  if (browseWebCount >= 2) {
    console.log("SUCCESS: Multiple BrowseWeb calls completed without freezing.");
  } else {
    console.log("WARNING: Expected 2+ BrowseWeb calls but got", browseWebCount);
  }

  // Show cost summary
  const tree = agent.getExecutionTree();
  if (tree) {
    const summary = tree.getCostSummary();
    console.log(`\nCost summary: $${summary.total.toFixed(4)}`);
  }
}

main().catch(console.error);
