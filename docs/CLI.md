# CLI Reference

Command-line interface for llmist.

## Installation

```bash
npm install -g llmist
# or use directly
bunx llmist
npx llmist
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
| `--parameter-format <fmt>` | | `json`, `yaml`, or `auto` | `json` |
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
- **[Getting Started](./GETTING_STARTED.md)** - Library usage
- **[Providers Guide](./PROVIDERS.md)** - Provider setup
