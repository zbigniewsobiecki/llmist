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
parameter-format = "toml"                # Gadget parameter format: json, yaml, toml, auto
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

#### Options for `[agent]` section

| Key | Type | Description |
|-----|------|-------------|
| `model` | string | Model identifier |
| `system` | string | System prompt |
| `temperature` | number | Sampling temperature (0-2) |
| `max-iterations` | integer | Max agent loop iterations |
| `gadget` | string[] | Array of gadget file paths to load |
| `parameter-format` | string | `json`, `yaml`, `toml`, or `auto` |
| `builtins` | boolean | Enable built-in gadgets (AskUser, TellUser) |
| `builtin-interaction` | boolean | Enable AskUser gadget |
| `inherits` | string or string[] | Section(s) to inherit settings from |

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
| `--parameter-format <fmt>` | | `json`, `yaml`, `toml`, or `auto` | `toml` |
| `--no-builtins` | | Disable all built-in gadgets | false |
| `--no-builtin-interaction` | | Disable interactive gadgets (AskUser) | false |

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
- **[Configuration](./CONFIGURATION.md)** - Library configuration options
- **[Getting Started](./GETTING_STARTED.md)** - Library usage
- **[Providers Guide](./PROVIDERS.md)** - Provider setup
