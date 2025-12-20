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
// External gadget packages use a "llmist" field in package.json.
// Import manifest types from llmist for type-safe development:

import type { LLMistPackageManifest, SubagentManifestEntry } from 'llmist';
import { parseManifest, hasPreset, listSubagents, getSubagent } from 'llmist';

// Type-safe manifest definition:
const manifest: LLMistPackageManifest = {
  // Entry point for all gadgets
  gadgets: "./dist/gadgets/index.js",

  // Factory function for dependency injection
  factory: "./dist/factory.js",

  // Subagents (gadgets with internal agent loops)
  subagents: {
    BrowseWeb: {
      entryPoint: "./dist/subagents/browse-web.js",
      export: "BrowseWeb",
      description: "Browse websites autonomously",
      uses: ["Navigate", "Click", "Screenshot"],
      defaultModel: "sonnet",
      maxIterations: 15
    }
  },

  // Presets for common use cases
  presets: {
    all: "*",                                        // All gadgets
    readonly: ["Navigate", "Screenshot", "GetFullPageContent"],
    minimal: ["Navigate", "Screenshot"],
    subagent: ["BrowseWeb"]
  }
};

// Parse manifest from package.json:
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
const parsed = parseManifest(pkg);

// Use parsing utilities:
if (hasPreset(parsed, 'minimal')) {
  console.log('Minimal preset available');
}
const subagents = listSubagents(parsed);  // ['BrowseWeb']
`);
}

// =============================================================================
// EXAMPLE 5: createSubagent() helper (RECOMMENDED for external gadgets)
// =============================================================================

function showCreateSubagentPattern() {
  console.log("=== createSubagent() Helper (RECOMMENDED) ===\n");

  console.log(`
The createSubagent() helper is the recommended way to create subagents.
It handles getHostExports(), model resolution, and tree sharing automatically.

// In your external gadget package:

import { createSubagent, Gadget, z } from 'llmist';
import type { ExecutionContext, GadgetMediaOutput } from 'llmist';

export class BrowseWeb extends Gadget({
  name: 'BrowseWeb',
  description: 'Browse websites autonomously',
  schema: z.object({
    task: z.string().describe('The browsing task'),
    url: z.string().describe('Starting URL'),
    model: z.string().optional().describe('Model override'),
  }),
  timeoutMs: 300000,
}) {
  async execute(
    params: this['params'],
    ctx?: ExecutionContext,
  ): Promise<{ result: string; media?: GadgetMediaOutput[] }> {
    // createSubagent() automatically handles:
    // - getHostExports() for tree sharing
    // - Model resolution with "inherit" support
    // - Parent context for cost tracking
    // - Logger forwarding
    const agent = createSubagent(ctx!, {
      name: 'BrowseWeb',
      gadgets: [Navigate, Click, Screenshot],
      model: params.model,       // Optional runtime override
      defaultModel: 'sonnet',    // Fallback if not inherited
      maxIterations: 15,
      systemPrompt: BROWSER_SYSTEM_PROMPT,
    }).ask(params.task);

    let result = '';
    for await (const event of agent.run()) {
      if (event.type === 'text') result = event.content;
    }

    // Tree automatically tracks all costs
    return {
      result,
      media: ctx?.tree?.getSubtreeMedia(ctx.nodeId!)
    };
  }
}

=== Manual Pattern (for full control) ===

For advanced cases, use getHostExports() directly:

import { getHostExports, Gadget, z } from 'llmist';
import type { ExecutionContext } from 'llmist';

export class BrowseWeb extends Gadget({ ... }) {
  async execute(params: this['params'], ctx?: ExecutionContext) {
    const { AgentBuilder, LLMist } = getHostExports(ctx!);
    const client = new LLMist();

    const agent = new AgentBuilder(client)
      .withParentContext(ctx!)
      .withModel(params.model ?? ctx?.agentConfig?.model ?? 'sonnet')
      .withGadgets(Navigate, Click, Screenshot)
      .ask(params.task);

    // ... rest of implementation
  }
}

Why getHostExports() matters:
- Without it, your AgentBuilder is from YOUR node_modules/llmist
- The CLI's AgentBuilder is from ITS node_modules/llmist
- These are DIFFERENT class instances, so tree sharing breaks
- getHostExports() gives you the CLI's actual classes
`);
}

// =============================================================================
// EXAMPLE 6: hasHostExports() for conditional logic
// =============================================================================

function showHostExportsPattern() {
  console.log("=== hasHostExports() for conditional logic ===\n");

  console.log(`
Use hasHostExports() when gadgets may run standalone or via agent:

import { hasHostExports, createSubagent, Gadget, z } from 'llmist';
import type { ExecutionContext } from 'llmist';

export class BrowseWeb extends Gadget({ ... }) {
  async execute(params: this['params'], ctx?: ExecutionContext) {
    // Check if running via llmist agent
    if (!hasHostExports(ctx)) {
      return 'Error: This gadget requires running via llmist agent (llmist >= 6.2.0)';
    }

    const agent = createSubagent(ctx!, { ... });
    // ...
  }
}
`);
}

// =============================================================================
// EXAMPLE 7: Using ctx.logger for consistent logging
// =============================================================================

function showCtxLoggerPattern() {
  console.log("=== ctx.logger Pattern (for external gadget developers) ===\n");

  console.log(`
External gadgets should use ctx.logger for logging instead of importing
defaultLogger. This ensures logs respect the CLI's --log-level and --log-file
settings and appear alongside other CLI logs.

// In your external gadget package:

import { Gadget, z } from 'llmist';
import type { ExecutionContext } from 'llmist';

export class MyGadget extends Gadget({
  name: 'MyGadget',
  description: 'Does something useful',
  schema: z.object({
    input: z.string().describe('Input to process'),
  }),
}) {
  async execute(
    params: this['params'],
    ctx?: ExecutionContext,
  ): Promise<string> {
    // ✅ Use ctx.logger - respects CLI's log level and file settings
    ctx?.logger?.debug('[MyGadget] Starting...', { input: params.input });

    const result = await this.doWork(params.input);

    ctx?.logger?.info('[MyGadget] Completed', { resultLength: result.length });

    return result;
  }
}

// ❌ DON'T import defaultLogger directly in external gadgets:
//    import { defaultLogger } from 'llmist';
//    defaultLogger.debug('...');  // Won't appear in CLI's log file!

Why ctx.logger works better:
- Logger is passed from CLI through ExecutionContext
- Respects --log-level (debug, info, warn, error)
- Respects --log-file (logs go to file instead of console)
- Uses same tslog instance as the host for consistent formatting
- Optional chaining (ctx?.logger?.debug) handles missing context gracefully
`);
}

// =============================================================================
// EXAMPLE 8: Cache structure
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
  showCreateSubagentPattern();
  showHostExportsPattern();
  showCtxLoggerPattern();
  showCacheStructure();

  console.log("=== Done ===\n");
}

main().catch(console.error);
