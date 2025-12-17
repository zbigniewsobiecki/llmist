# CLI Reference

Command-line interface for llmist.

## Installation

```bash
npm install -g llmist
# or use directly
bunx llmist
npx llmist
```

## Configuration File

The CLI loads configuration from `~/.llmist/cli.toml` if it exists. This allows you to:

- Set default options for built-in commands (`complete`, `agent`)
- Define custom commands with preset configurations

### Basic Example

```toml
# ~/.llmist/cli.toml

# Default settings for the 'complete' command
[complete]
model = "anthropic:claude-sonnet-4-5"
temperature = 0.7

# Default settings for the 'agent' command
[agent]
model = "anthropic:claude-sonnet-4-5"
max-iterations = 15
gadget = ["~/gadgets/common-tools.ts"]
```

With this config, running `llmist complete "Hello"` will use Claude Sonnet instead of the default GPT-5-nano.

### Inheritance

Sections can inherit settings from other sections using the `inherits` key. This reduces duplication and allows you to create shared profiles:

```toml
# Base settings in [agent]
[agent]
model = "anthropic:claude-sonnet-4-5"
max-iterations = 15

# Profile inherits from agent, overrides some settings
[review-base]
inherits = "agent"
temperature = 0.3
max-iterations = 5

# Command inherits from profile (chain: code-review → review-base → agent)
[code-review]
inherits = "review-base"
system = "You are a code reviewer."
# Gets: model from agent, temperature and max-iterations from review-base
```

**Inheritance rules:**
- Single inheritance: `inherits = "agent"`
- Multiple inheritance: `inherits = ["agent", "profile"]` (last wins for conflicts)
- Own values always override inherited values
- Arrays (like `gadget`) are replaced, not merged
- Circular inheritance is detected and errors

### Prompt Templates

The `[prompts]` section lets you define reusable prompt snippets using [Eta](https://eta.js.org/) templating syntax. This is powerful for:

- **Composition**: Build complex prompts from smaller, reusable pieces
- **DRY**: Don't repeat yourself - define common instructions once
- **Parameterization**: Create flexible templates that accept parameters

#### Basic Syntax

```toml
[prompts]
# Simple prompt
base-assistant = "You are a helpful AI assistant."

# Prompt with variable
personalized = "Hello <%= it.name %>, I'm ready to help with <%= it.task %>!"

# Include another prompt
full-intro = """
<%~ include("@base-assistant") %>

I specialize in <%= it.specialty %>.
"""
```

#### Including Prompts

Use `<%~ include("@name") %>` to include another prompt. The `@` prefix references named prompts from `[prompts]`.

```toml
[prompts]
base = "You are a helpful assistant."
expert = """
<%~ include("@base") %>
You are also an expert in <%= it.field %>.
"""

[my-expert]
system = '<%~ include("@expert", {field: "TypeScript"}) %>'
```

#### Passing Parameters

Pass parameters when including prompts using the second argument:

```toml
[prompts]
code-style = """
When writing code:
- Use <%= it.language %> idioms
- Follow <%= it.style %> conventions
"""

senior-reviewer = """
<%~ include("@base-assistant") %>

You are a senior <%= it.role %> expert.
<%~ include("@code-style", {language: "TypeScript", style: "modern"}) %>
"""

[code-review]
type = "agent"
system = '<%~ include("@senior-reviewer", {role: "code reviewer"}) %>'
```

#### Environment Variables

Access environment variables with `<%= it.env.VAR_NAME %>`:

```toml
[prompts]
user-greeting = "Hello <%= it.env.USER %>, welcome back!"
project-context = "Working on project: <%= it.env.PROJECT_NAME %>"
```

**Note**: Missing environment variables will cause an error at config load time.

#### Syntax Reference

| Syntax | Purpose | Example |
|--------|---------|---------|
| `<%= it.var %>` | Output variable | `<%= it.name %>` |
| `<%~ include("@name") %>` | Include prompt | `<%~ include("@base") %>` |
| `<%~ include("@name", {k:v}) %>` | Include with params | `<%~ include("@style", {lang: "TS"}) %>` |
| `<%= it.env.VAR %>` | Environment variable | `<%= it.env.USER %>` |

### Custom Commands

Any section other than `global`, `complete`, `agent`, and `prompts` creates a new CLI command:

```toml
[code-review]
inherits = "agent"  # Inherit base settings
type = "agent"
description = "Review code for bugs and best practices."
system = "You are a senior code reviewer. Analyze code for bugs, security issues, style problems, and suggest improvements."
gadget = ["~/gadgets/code-tools.ts"]
max-iterations = 5
```

This creates a new command `llmist code-review` that you can use:

```bash
cat myfile.ts | llmist code-review
llmist code-review "Review this function: $(cat utils.ts)"
```

### Complete Config Reference

```toml
# ~/.llmist/cli.toml
# Extensive example showing all available options

#──────────────────────────────────────────────────────────────────────────────
# GLOBAL OPTIONS
# These apply to all commands and override environment variables
#──────────────────────────────────────────────────────────────────────────────
[global]
log-level = "info"                       # silly, trace, debug, info, warn, error, fatal
log-file = "/tmp/llmist.log"             # Log file path (enables JSON logging)

#──────────────────────────────────────────────────────────────────────────────
# COMPLETE COMMAND DEFAULTS
#──────────────────────────────────────────────────────────────────────────────
[complete]
model = "anthropic:claude-sonnet-4-5"   # Model identifier (provider:model or alias)
system = "You are a helpful assistant." # System prompt
temperature = 0.7                        # Sampling temperature (0-2)
max-tokens = 4096                        # Maximum output tokens

#──────────────────────────────────────────────────────────────────────────────
# AGENT COMMAND DEFAULTS
#──────────────────────────────────────────────────────────────────────────────
[agent]
model = "anthropic:claude-sonnet-4-5"
system = "You are a helpful assistant with access to tools."
temperature = 0.5
max-iterations = 20                      # Max agent loop iterations
gadget = [                               # Default gadgets to load
  "~/gadgets/filesystem.ts",
  "~/gadgets/calculator.ts",
]
parameter-format = "block"               # Gadget parameter format (only block supported)
builtins = true                          # Enable built-in gadgets (AskUser, TellUser)
builtin-interaction = true               # Enable AskUser (set false for non-interactive)

#──────────────────────────────────────────────────────────────────────────────
# CUSTOM COMMANDS
#──────────────────────────────────────────────────────────────────────────────

# Code review command with specialized system prompt
[code-review]
type = "agent"                           # "agent" (default) or "complete"
description = "Review code for bugs, security issues, and best practices."
model = "anthropic:claude-sonnet-4-5"
system = """
You are a senior code reviewer. For each piece of code:
1. Identify bugs and logic errors
2. Check for security vulnerabilities (injection, XSS, etc.)
3. Suggest performance improvements
4. Note style issues and best practices
Be constructive and explain your reasoning.
"""
max-iterations = 5
gadget = ["~/gadgets/code-analysis.ts"]

# Quick translation command (uses complete, not agent)
[translate]
type = "complete"
description = "Translate text to English."
model = "openai:gpt-4o"
system = "Translate the following text to English. Preserve formatting and tone."
temperature = 0.3
max-tokens = 2000

# Research assistant with web search gadget
[research]
type = "agent"
description = "Research assistant with web search capabilities."
model = "anthropic:claude-sonnet-4-5"
system = "You are a research assistant. Use available tools to find and synthesize information."
gadget = [
  "~/gadgets/web-search.ts",
  "~/gadgets/summarizer.ts",
]
max-iterations = 10

# Shell helper for system administration
[shell-help]
type = "agent"
description = "Get help with shell commands and scripts."
model = "anthropic:claude-sonnet-4-5"
system = """
You are a Unix/Linux shell expert. Help users with:
- Writing shell commands and scripts
- Explaining command output
- Debugging shell issues
Always explain what commands do before running them.
"""
builtin-interaction = false              # Non-interactive mode

# Creative writing assistant
[write]
type = "agent"
description = "Creative writing assistant."
model = "anthropic:claude-sonnet-4-5"
system = "You are a creative writing assistant. Help with stories, poems, and other creative content."
temperature = 0.9                        # Higher temperature for creativity
max-iterations = 3
```

### Config Option Reference

#### Options for `[global]` section

| Key | Type | Description |
|-----|------|-------------|
| `log-level` | string | Log level: silly, trace, debug, info, warn, error, fatal |
| `log-file` | string | Path to log file. Enables JSON logging to file |

#### Options for `[complete]` section

| Key | Type | Description |
|-----|------|-------------|
| `model` | string | Model identifier (e.g., `anthropic:claude-sonnet-4-5`, `sonnet`) |
| `system` | string | System prompt |
| `temperature` | number | Sampling temperature (0-2) |
| `max-tokens` | integer | Maximum output tokens |
| `inherits` | string or string[] | Section(s) to inherit settings from |
| `log-llm-requests` | string or boolean | Save LLM requests/responses to session directories. `true` = default dir, string = custom path |

#### Options for `[agent]` section

| Key | Type | Description |
|-----|------|-------------|
| `model` | string | Model identifier |
| `system` | string | System prompt |
| `temperature` | number | Sampling temperature (0-2) |
| `max-iterations` | integer | Max agent loop iterations |
| `gadget` | string[] | Array of gadget file paths to load |
| `parameter-format` | string | `block` (only format) |
| `builtins` | boolean | Enable built-in gadgets (AskUser, TellUser) |
| `builtin-interaction` | boolean | Enable AskUser gadget |
| `gadget-start-prefix` | string | Custom prefix for gadget start marker (default: `!!!GADGET_START:`) |
| `gadget-end-prefix` | string | Custom prefix for gadget end marker (default: `!!!GADGET_END`) |
| `gadget-arg-prefix` | string | Custom prefix for argument markers (default: `!!!ARG:`) |
| `inherits` | string or string[] | Section(s) to inherit settings from |
| `log-llm-requests` | string or boolean | Save LLM requests/responses to session directories. `true` = default dir, string = custom path |
| `docker` | boolean | Enable Docker sandboxing for this command |
| `docker-cwd-permission` | string | Override CWD mount permission: `"ro"` or `"rw"` |

#### Options for `[docker]` section

See [Docker Sandboxing](./DOCKER.md) for full documentation.

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | boolean | Enable Docker sandboxing globally |
| `cwd-permission` | string | CWD mount permission: `"ro"` or `"rw"` (default) |
| `config-permission` | string | Config mount permission: `"ro"` (default) or `"rw"` |
| `env-vars` | string[] | Additional env vars to forward |
| `image-name` | string | Custom Docker image name |
| `dockerfile` | string | Custom Dockerfile content |
| `docker-args` | string[] | Extra arguments for `docker run` |

#### Options for custom command sections

All options from `[agent]` plus:

| Key | Type | Description |
|-----|------|-------------|
| `type` | string | `agent` (default) or `complete` |
| `description` | string | Help text shown in `llmist --help` |

If `type = "complete"`, options from `[complete]` apply instead.

### Error Handling

If the config file has invalid syntax or unknown fields, the CLI will fail with a clear error:

```bash
$ llmist complete "Hello"
[llmist] Error: /Users/you/.llmist/cli.toml: [agent].unknown-option is not a valid option
```

### CLI Overrides Config

Command-line flags always override config file values:

```bash
# Config sets model = "anthropic:claude-sonnet-4-5"
# This command uses haiku instead
llmist complete "Hello" --model haiku
```

## Global Options

These options apply to all commands:

| Flag | Description |
|------|-------------|
| `--log-level <level>` | Log level: silly, trace, debug, info, warn, error, fatal |
| `--log-file <path>` | Path to log file. When set, logs are written to file instead of stderr |
| `--version` | Show version number |
| `--help` | Show help |

**Examples:**

```bash
# Enable debug logging
llmist --log-level debug complete "Hello"

# Log to file
llmist --log-file ./llmist.log agent "Task" -g ./tools.ts

# Combine options
llmist --log-level trace --log-file ./debug.log agent "Debug this" -g ./tools.ts
```

## Commands

### `init` - Initialize Configuration

Create a starter configuration file at `~/.llmist/cli.toml`:

```bash
llmist init
```

This creates a minimal, well-commented config file to help you get started. If a config already exists, the command will print a message and exit without changes.

**Output:**

```
Created ~/.llmist/cli.toml

Next steps:
  1. Set your API key:
       export OPENAI_API_KEY=sk-...
       export ANTHROPIC_API_KEY=sk-...
       export GEMINI_API_KEY=...

  2. Customize your config:
       $EDITOR ~/.llmist/cli.toml

  3. See all options:
       https://github.com/zbigniewsobiecki/llmist/blob/main/examples/cli.example.toml

Try it: llmist complete "Hello, world!"
```

The generated config includes:
- Global logging options
- Default model settings for `complete` and `agent` commands
- A commented example of a custom command

For a comprehensive example with all available options, see [`examples/cli.example.toml`](../examples/cli.example.toml).

### `complete` - Simple Completion

Stream a single response without agent loop:

```bash
llmist complete "Explain TypeScript generics" --model haiku
```

**Arguments:**
- `[prompt]` - Prompt text (optional, can use stdin)

**Options:**

| Flag | Short | Description | Default |
|------|-------|-------------|---------|
| `--model <model>` | `-m` | Model name or alias | `gpt-5-nano` |
| `--system <prompt>` | `-s` | System prompt | none |
| `--temperature <n>` | `-t` | Temperature (0-2) | Provider default |
| `--max-tokens <n>` | | Max output tokens | Provider default |
| `--quiet` | `-q` | Suppress all output except content | false |
| `--log-llm-requests [dir]` | | Save LLM requests/responses to session directories | disabled |

**Examples:**

```bash
# Basic completion
llmist complete "What is TypeScript?"

# With model and system prompt
llmist complete "Write a function" --model sonnet --system "You are a coding assistant"

# With temperature
llmist complete "Be creative" -m haiku -t 0.9

# Pipe input
cat document.txt | llmist complete "Summarize this"
echo "Hello" | llmist complete
```

### `agent` - Agent with Gadgets

Run the full agent loop with tools:

```bash
llmist agent "Calculate 15 * 23" --gadget ./calculator.ts --model sonnet
```

**Arguments:**
- `[prompt]` - Prompt text (optional, can use stdin)

**Options:**

| Flag | Short | Description | Default |
|------|-------|-------------|---------|
| `--model <model>` | `-m` | Model name or alias | `gpt-5-nano` |
| `--system <prompt>` | `-s` | System prompt | none |
| `--temperature <n>` | `-t` | Temperature (0-2) | Provider default |
| `--max-iterations <n>` | `-i` | Max agent iterations | 10 |
| `--gadget <path>` | `-g` | Gadget file (repeatable) | none |
| `--parameter-format <fmt>` | | `block` (only format) | `block` |
| `--no-builtins` | | Disable all built-in gadgets | false |
| `--no-builtin-interaction` | | Disable interactive gadgets (AskUser) | false |
| `--quiet` | `-q` | Suppress output except TellUser messages | false |
| `--log-llm-requests [dir]` | | Save LLM requests/responses to session directories | disabled |
| `--docker` | | Run in Docker sandbox container | config |
| `--docker-ro` | | Run in Docker with read-only CWD | false |
| `--docker-dev` | | Run in Docker dev mode (mount source) | false |
| `--no-docker` | | Disable Docker (override config) | false |

See [Docker Sandboxing](./DOCKER.md) for full documentation on Docker options.

#### Built-in Gadgets

The agent command includes two built-in gadgets by default:

| Gadget | Description |
|--------|-------------|
| `AskUser` | Asks the user a question and waits for their response. |
| `TellUser` | Outputs an important message with type indicator (info/success/warning/error). Set `done=true` to end the conversation. |

These gadgets enable basic conversation out-of-the-box:

```bash
# No gadgets needed - built-ins are always available
llmist agent "Help me plan a trip"

# Agent can now:
# - Ask questions: "What's your budget?"
# - Show results: "✅ Here's your itinerary..." (done=false)
# - End conversation: "Trip planning complete!" (done=true)
```

**Controlling built-in gadgets:**

Use `--no-builtins` to disable all built-in gadgets:

```bash
# Only use custom gadgets - no AskUser or TellUser
llmist agent "Task" --no-builtins -g ./my-gadgets.ts
```

Use `--no-builtin-interaction` to disable only interactive prompts while keeping TellUser:

```bash
# Agent can use TellUser for formatted output, but can't prompt the user
llmist agent "Analyze this file" --no-builtin-interaction -g ./filesystem.ts

# Useful for non-interactive environments or when you want output formatting
# but don't want the agent asking questions
cat input.txt | llmist agent --no-builtin-interaction -g ./tools.ts
```

**Examples:**

```bash
# Basic conversation (uses built-in gadgets)
llmist agent "Help me write a poem"

# With additional custom gadget
llmist agent "Calculate 100 / 4" -g ./calculator.ts

# Multiple gadgets
llmist agent "Get weather and calculate" -g ./weather.ts -g ./calculator.ts

# With max iterations
llmist agent "Complex task" -g ./tools.ts --max-iterations 20

# Pipe input
cat task.txt | llmist agent -g ./tools.ts

# With debug logging
llmist --log-level debug agent "Debug task" -g ./tools.ts
```

### `gadget` - Test and Inspect Gadgets

Test gadgets in isolation without the agent loop. Essential for gadget development and debugging.

```bash
llmist gadget run ./calculator.ts
llmist gadget info ./calculator.ts
llmist gadget validate ./calculator.ts
```

#### `gadget run <file>` - Execute a Gadget

Runs a gadget's `execute()` method directly with interactive parameter prompts (TTY) or piped JSON input (non-TTY).

**Options:**

| Flag | Description |
|------|-------------|
| `--name <gadget>` | Select gadget by name (required if file exports multiple) |
| `--json` | Format output as pretty-printed JSON |
| `--raw` | Output result as raw string without formatting |

**Interactive mode (TTY):**

```bash
$ llmist gadget run ./calculator.ts

🔧 Running gadget: Calculator

operation* - The operation
  (add | subtract | multiply | divide)
  > multiply

a* - First number
  (number)
  > 7

b* - Second number
  (number)
  > 6

Executing...

✓ Completed in 0ms

42
```

**Piped mode (non-TTY):**

```bash
# JSON from stdin
echo '{"operation": "add", "a": 5, "b": 3}' | llmist gadget run ./calculator.ts
# Output: 8

# From file
cat params.json | llmist gadget run ./calculator.ts
```

**Multi-gadget files:**

```bash
# When file exports multiple gadgets, use --name
$ llmist gadget run ./random.ts
Error: File './random.ts' exports 3 gadgets.
Use --name to select one:
  - CoinFlip
  - DiceRoll
  - RandomNumber

$ llmist gadget run ./random.ts --name CoinFlip
# Output: heads
```

#### `gadget info <file>` - Display Gadget Details

Shows the gadget's description, parameter schema, timeout, and examples.

**Options:**

| Flag | Description |
|------|-------------|
| `--name <gadget>` | Select gadget by name (required if file exports multiple) |
| `--json` | Output as JSON instead of formatted text |

**Example:**

```bash
$ llmist gadget info ./calculator.ts

Calculator
══════════

Description:
  Performs arithmetic: add, subtract, multiply, divide

Parameters:
  operation* (string): The operation - one of: add, subtract, multiply, divide
  a* (number): First number
  b* (number): Second number

Examples:
  # Add two numbers
  Input: {"operation":"add","a":15,"b":23}
  Output: 38
```

**JSON output:**

```bash
llmist gadget info ./calculator.ts --json > schema.json
```

#### `gadget validate <file>` - Validate Gadget Structure

Checks if a file exports valid gadget(s) with proper structure.

**Validates:**
- File exports at least one gadget
- Each gadget has a `description` property
- Each gadget has an `execute()` method
- Parameter schema (if present) is valid

**Example:**

```bash
$ llmist gadget validate ./my-gadgets.ts

✓ Valid

Gadgets found:
  Calculator (with schema)
    Performs arithmetic: add, subtract, multiply, divide
  FileReader (with schema)
    Reads file contents from the filesystem
```

## Environment Variables

Set API keys before running:

```bash
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
export GEMINI_API_KEY="..."
```

Logging can also be configured via environment variables:

```bash
export LLMIST_LOG_LEVEL="debug"    # Log level
export LLMIST_LOG_FILE="./app.log" # Log to file
```

Note: CLI options (`--log-level`, `--log-file`) take priority over environment variables.

## LLM Debugging

When debugging LLM prompting issues, you can save raw requests and responses as plain text files. Each session creates a timestamped directory containing sequentially numbered request/response pairs:

```bash
# Enable logging (saves both requests and responses)
llmist agent "Task" --log-llm-requests

# Save to custom directory
llmist agent "Task" --log-llm-requests /tmp/logs

# Works with complete command too
llmist complete "Hello" --log-llm-requests
```

Or configure in `~/.llmist/cli.toml`:

```toml
[agent]
log-llm-requests = true                    # Use default: ~/.llmist/logs/requests/

[complete]
log-llm-requests = "/custom/path"          # Use custom directory
```

**Directory structure:**

```
~/.llmist/logs/requests/
├── 2025-12-09_14-30-45/           # Session directory (timestamped)
│   ├── 0001.request               # First LLM call request
│   ├── 0001.response              # First LLM call response
│   ├── 0002.request               # Second LLM call request
│   ├── 0002.response              # Second LLM call response
│   └── ...
└── 2025-12-09_15-12-03/           # Another session
    ├── 0001.request
    └── 0001.response
```

**File format:**

Request files (`0001.request`):
```
=== SYSTEM ===
You are a helpful assistant...

=== USER ===
What is TypeScript?
```

Response files (`0001.response`):
```
TypeScript is a statically typed superset of JavaScript...
```

This is useful for:
- Debugging prompt engineering issues
- Analyzing what the model actually receives
- Troubleshooting unexpected model behavior
- Validating system prompts are correctly formatted

## Model Shortcuts

Use short names:

```bash
llmist complete "Hello" --model haiku
llmist complete "Hello" --model sonnet
llmist complete "Hello" --model gpt4
llmist complete "Hello" --model flash
```

## Stdin Input

Pipe content to llmist:

```bash
# Pipe file
cat code.ts | llmist complete "Review this code"

# Pipe command output
git diff | llmist complete "Summarize changes"

# Here document
llmist complete <<EOF
Review this:
function add(a, b) { return a + b; }
EOF
```

## Output

- **stdout**: LLM response text
- **stderr**: Summary info (tokens, timing, gadget results)

```bash
# Capture only response
llmist complete "Hello" > response.txt

# Capture everything
llmist complete "Hello" > response.txt 2>&1
```

## Interactive TUI

When running in an interactive terminal (TTY), llmist provides a rich TUI experience with:

- **Interactive blocks** for LLM calls and gadget executions
- **Keyboard navigation** to browse through execution history
- **Real-time status bar** showing tokens, cost, and elapsed time
- **Raw viewer** to inspect actual LLM requests and responses

### When TUI is Active

| Condition | Rendering Mode |
|-----------|----------------|
| Interactive terminal (TTY) | Full TUI with keyboard navigation |
| Piped output (`\| less`) | Plain text output only |
| Non-TTY environment | Plain text output only |

### Keyboard Shortcuts

**Navigation (Browse Mode)**

| Key | Action |
|-----|--------|
| `↑` / `k` | Select previous block |
| `↓` / `j` | Select next block |
| `Enter` / `Space` | Toggle expand/collapse |
| `Escape` / `h` | Collapse or deselect |
| `Home` / `g` | Jump to first block |
| `End` / `G` | Jump to last block |

**Raw Viewer**

| Key | Action |
|-----|--------|
| `r` | View raw request (messages sent to LLM) |
| `R` (Shift+r) | View raw response (LLM output) |

**Mode Control**

| Key | Action |
|-----|--------|
| `Ctrl+B` | Toggle between browse and input mode |
| `Ctrl+C` (×2) | Quit (double-press within 1 second) |
| `Escape` | Cancel current operation |

### Focus Modes

The TUI has two focus modes:

1. **Browse Mode** (default) - Navigate through LLM calls and gadgets using keyboard
2. **Input Mode** - Type responses for AskUser gadgets

Use `Ctrl+B` to toggle between modes. When a gadget requests user input (AskUser), input mode is automatically activated.

### Status Bar

The status bar at the bottom shows real-time metrics:

```
◀ Browse | 1,234 tok | $0.0012 | 3.2s
```

| Component | Description |
|-----------|-------------|
| Mode indicator | `◀ Browse` or `▷ Input` |
| Tokens | Input/output token counts |
| Cost | Cumulative USD cost |
| Time | Elapsed session time |

During streaming, the status bar shows estimated output tokens as they arrive.

## Human-in-the-Loop

When running interactively (TTY), the agent can prompt for user input using the built-in `AskUser` gadget:

```bash
# Interactive - agent can ask questions via AskUser gadget
llmist agent "Help me plan a vacation"

# Example interaction:
# Agent: I'd like to help you plan a vacation.
# [AskUser] What's your budget?
# > $2000
# Agent: Great! And how many days?
# ...
```

Human input is disabled when stdin is piped:

```bash
# Non-interactive - AskUser gadget will fail gracefully
cat prompt.txt | llmist agent
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error (API, config, etc.) |

## See Also

- **[CLI Gadgets](./CLI_GADGETS.md)** - Writing gadgets for CLI
- **[Gadgets Guide](./GADGETS.md)** - Complete gadget development reference
- **[Configuration](./CONFIGURATION.md)** - Library configuration options
- **[Getting Started](./GETTING_STARTED.md)** - Library usage
- **[Providers Guide](./PROVIDERS.md)** - Provider setup
