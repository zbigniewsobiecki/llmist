/**
 * External Gadgets: Loading gadgets from npm packages and git URLs
 *
 * This example shows how to use the external gadget loader, which allows you to:
 * - Load gadgets from npm packages (auto-installed to ~/.llmist/gadget-cache/)
 * - Load gadgets from git URLs
 * - Use presets and individual gadget selection
 * - Access factory functions for dependency injection
 *
 * Run: bunx tsx examples/20-external-gadgets.ts
 */

import { LLMist } from "llmist";
import { loadGadgets } from "../src/cli/gadgets.js";

// =============================================================================
// SUPPORTED SPECIFIER FORMATS
// =============================================================================

// The CLI and loadGadgets() function support these specifier formats:
//
// npm packages (auto-installed):
//   webasto              - all gadgets from package
//   webasto@2.0.0        - specific version
//   webasto:minimal      - preset (subset of gadgets)
//   webasto/Navigate     - single gadget
//   webasto@2.0.0:readonly - version + preset
//
// git URLs (cloned and cached):
//   git+https://github.com/user/repo.git
//   git+https://github.com/user/repo.git#v1.0.0   - with ref

// =============================================================================
// EXAMPLE 1: Using external gadgets with CLI (shell commands)
// =============================================================================

function showCliExamples() {
  console.log("=== CLI External Gadget Examples ===\n");
  console.log("# Load all gadgets from npm package:");
  console.log("llmist agent 'Navigate to example.com' -g webasto\n");

  console.log("# Load with specific preset:");
  console.log("llmist agent 'Screenshot google.com' -g webasto:readonly\n");

  console.log("# Load single gadget:");
  console.log("llmist agent 'Go to apple.com' -g webasto/Navigate\n");

  console.log("# Load from git URL:");
  console.log(
    "llmist agent 'Browse the web' -g git+https://github.com/zbigniewsobiecki/webasto.git\n",
  );

  console.log("# Combine multiple sources:");
  console.log("llmist agent 'task' -g ./local.ts -g webasto:minimal -g builtin:ReadFile\n");
}

// =============================================================================
// EXAMPLE 2: Programmatic loading with loadGadgets()
// =============================================================================

async function programmaticLoading() {
  console.log("=== Programmatic Gadget Loading ===\n");

  // loadGadgets() is the same function used by the CLI
  // It handles all specifier types: builtin, file, npm, git

  try {
    // Load builtin gadgets
    const builtins = await loadGadgets(["builtin:ReadFile", "builtin:WriteFile"], process.cwd());
    console.log(`Loaded ${builtins.length} builtin gadgets: ${builtins.map((g) => g.name).join(", ")}\n`);

    // Note: npm/git loading would work the same way:
    // const webasto = await loadGadgets(['webasto:minimal'], process.cwd());
    // const gitGadgets = await loadGadgets(['git+https://github.com/user/repo.git'], process.cwd());
  } catch (error) {
    console.log("Skipping external package loading in example (requires network)\n");
  }
}

// =============================================================================
// EXAMPLE 3: Using factory pattern (for library consumers)
// =============================================================================

function showFactoryPattern() {
  console.log("=== Factory Pattern for Libraries ===\n");

  // External gadget packages can export factory functions for dependency injection.
  // This is useful when integrating with applications that need custom configuration.

  console.log(`
// In your application code:
import { createWebastoGadgets, BrowseWeb } from 'webasto';

// Option A: Use the high-level BrowseWeb subagent (recommended)
// This runs its own agent loop internally
const browseWeb = new BrowseWeb();
const agent = LLMist.createAgent()
  .withModel('sonnet')
  .withGadgets(browseWeb)
  .ask('Find the price of iPhone 16 Pro on apple.com');

// Option B: Use individual gadgets with custom session manager
const mySessionManager = createCustomSessionManager();
const gadgets = createWebastoGadgets({
  sessionManager: mySessionManager,
});

// Register specific gadgets
const agent2 = LLMist.createAgent()
  .withModel('sonnet')
  .withGadgets(
    gadgets.Navigate,
    gadgets.Screenshot,
    gadgets.GetFullPageContent,
  )
  .ask('Navigate to google.com and take a screenshot');
`);
}

// =============================================================================
// EXAMPLE 4: Package manifest structure
// =============================================================================

function showManifestStructure() {
  console.log("=== Package Manifest (package.json) ===\n");

  console.log(`
// External gadget packages use a "llmist" field in package.json:
{
  "name": "webasto",
  "version": "2.0.0",
  "llmist": {
    // Entry point for all gadgets
    "gadgets": "./dist/gadgets/index.js",

    // Factory function for dependency injection
    "factory": "./dist/factory.js",

    // Subagents (gadgets with internal agent loops)
    "subagents": {
      "BrowseWeb": {
        "entryPoint": "./dist/subagents/browse-web.js",
        "export": "BrowseWeb",
        "description": "Browse websites autonomously",
        "uses": ["Navigate", "Click", "Screenshot"],
        "defaultModel": "sonnet",
        "maxIterations": 15
      }
    },

    // Presets for common use cases
    "presets": {
      "all": "*",
      "readonly": ["Navigate", "Screenshot", "GetFullPageContent"],
      "minimal": ["Navigate", "Screenshot", "GetFullPageContent"],
      "subagent": ["BrowseWeb"]
    }
  }
}
`);
}

// =============================================================================
// EXAMPLE 5: Cache structure
// =============================================================================

function showCacheStructure() {
  console.log("=== Cache Directory Structure ===\n");

  console.log(`
External packages are auto-installed to ~/.llmist/gadget-cache/:

~/.llmist/gadget-cache/
├── npm/
│   ├── webasto@latest/
│   │   ├── package.json
│   │   └── node_modules/
│   │       └── webasto/
│   └── webasto@2.0.0/
│       └── ...
└── git/
    └── github.com-zbigniewsobiecki-webasto-v1.0.0/
        ├── package.json
        ├── node_modules/
        └── dist/

Packages are cached by version. Use --force to reinstall.
`);
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  showCliExamples();
  await programmaticLoading();
  showFactoryPattern();
  showManifestStructure();
  showCacheStructure();

  console.log("=== Done ===\n");
}

main().catch(console.error);
