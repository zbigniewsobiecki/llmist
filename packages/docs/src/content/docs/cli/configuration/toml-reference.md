---
title: CLI Configuration
description: Configure the llmist CLI with TOML files and environment variables
---

The llmist CLI is configured through TOML files and environment variables.

## Configuration File

The CLI loads configuration from `~/.llmist/cli.toml`:

```bash
# Initialize with default config
llmist init
```

### Basic Structure

```toml
# ~/.llmist/cli.toml

[complete]
model = "anthropic:claude-sonnet-4-5"
temperature = 0.7

[agent]
model = "anthropic:claude-sonnet-4-5"
max-iterations = 15
gadget = ["~/gadgets/common-tools.ts"]
```

### Inheritance

Sections can inherit settings from parent sections:

```toml
[agent]
model = "anthropic:claude-sonnet-4-5"
max-iterations = 15

[code-review]
inherits = "agent"
temperature = 0.3
system = "You are a code reviewer."
```

### Custom Commands

Create custom commands with a `type` field:

```toml
[code-review]
type = "agent"
description = "Review code for bugs and best practices."
system = "You are a senior code reviewer."
max-iterations = 5
gadget = ["~/gadgets/code-tools.ts"]
```

Run with:
```bash
llmist code-review "Review my PR"
```

### Prompt Templates

Define reusable prompts with Eta templating:

```toml
[prompts]
base-assistant = "You are a helpful AI assistant."
expert = """
<%~ include("@base-assistant") %>
You are also an expert in <%= it.field %>.
"""

[my-expert]
system = '<%~ include("@expert", {field: "TypeScript"}) %>'
```

## Gadget Approval

The gadget approval system provides a safety layer for potentially dangerous gadget executions.

### Approval Modes

| Mode | Behavior |
|------|----------|
| `allowed` | Gadget executes immediately |
| `denied` | Gadget is rejected, LLM receives denial message |
| `approval-required` | User is prompted before execution |

### Default Behavior

By default, these gadgets require approval:

- **`RunCommand`** - Executes shell commands
- **`WriteFile`** - Creates or modifies files
- **`EditFile`** - Edits existing files

All other gadgets default to `allowed`.

### Configuration

```toml
[agent]
gadget-approval = { WriteFile = "allowed", Shell = "denied", ReadFile = "allowed" }
```

### Wildcard Default

Set default mode for all unconfigured gadgets:

```toml
[agent]
gadget-approval = { "*" = "denied", ReadFile = "allowed", Calculator = "allowed" }
```

### Example Configurations

**High-Security Mode:**
```toml
[agent]
gadget-approval = {
  WriteFile = "denied",
  EditFile = "denied",
  RunCommand = "denied",
  ReadFile = "allowed"
}
```

**Trust All Mode:**
```toml
[agent]
gadget-approval = { "*" = "allowed" }
```

**Selective Approval:**
```toml
[agent]
gadget-approval = {
  RunCommand = "approval-required",
  WriteFile = "allowed",
  DeleteFile = "denied"
}
```

### Approval Prompts

For file operations, a colored diff is shown:

```
🔒 Approval required: Modify src/index.ts

--- src/index.ts (original)
+++ src/index.ts (modified)
@@ -1,3 +1,4 @@
 import { foo } from './foo';
+import { bar } from './bar';

   ⏎ approve, or type to reject:
```

- **Press Enter** or type **`y`** to approve
- **Type any other text** to reject (sent to LLM as feedback)

### Non-Interactive Mode

When running non-interactively (e.g., in scripts or CI), `approval-required` gadgets are automatically denied.

## Environment Variables

### API Keys

```bash
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
export GEMINI_API_KEY="..."
```

### Logging

```bash
export LLMIST_LOG_LEVEL="debug"   # silly, trace, debug, info, warn, error, fatal
export LLMIST_LOG_FILE="./app.log"
export LLMIST_LOG_RESET="true"    # Clear log file on start
```

### Global CLI Flags

These flags work with any command:

| Flag | Description |
|------|-------------|
| `--log-level <level>` | Set log level |
| `--log-file <path>` | Path to log file |
| `--version` | Show version number |
| `--help` | Show help |

## See Also

- [CLI Reference](/cli/commands/overview/) - All CLI commands
- [CLI Gadgets](/cli/gadgets/local-gadgets/) - Writing gadgets for CLI
- [Logging](/library/reference/logging/) - Detailed logging configuration
