# Gadget Approval System

The gadget approval system provides a safety layer for potentially dangerous gadget executions. It allows you to configure which gadgets require user approval before execution, which should be automatically allowed, and which should be completely denied.

## Overview

When the agent attempts to execute a gadget, the approval system checks the configured mode for that gadget:

- **`allowed`** - Gadget executes immediately without prompting
- **`denied`** - Gadget is rejected and the LLM receives a denial message
- **`approval-required`** - User is prompted with context before execution

## Default Behavior

By default, the following gadgets require approval:

- **`RunCommand`** - Executes shell commands
- **`WriteFile`** - Creates or modifies files
- **`EditFile`** - Edits existing files

All other gadgets default to `allowed` mode.

## Configuration

Configure gadget approval in `~/.llmist/cli.toml` under the `[agent]` section:

```toml
[agent]
gadget-approval = { WriteFile = "allowed", Shell = "denied", ReadFile = "allowed" }
```

### Approval Modes

| Mode | Behavior |
|------|----------|
| `"allowed"` | Gadget executes immediately, no user interaction |
| `"denied"` | Gadget is blocked, LLM receives denial message |
| `"approval-required"` | User sees context and must approve/reject |

### Wildcard Configuration

Use `"*"` to set the default mode for all unconfigured gadgets:

```toml
[agent]
# Deny all gadgets by default, only allow specific ones
gadget-approval = { "*" = "denied", ReadFile = "allowed", Calculator = "allowed" }
```

### Configuration Priority

1. **Explicit configuration** - Direct gadget name match (case-insensitive)
2. **Wildcard** - The `"*"` key if present
3. **Default mode** - Built-in default (`allowed` for most, `approval-required` for dangerous gadgets)

## Approval Prompts

When a gadget requires approval, the CLI displays relevant context:

### File Operations (WriteFile/EditFile)

For file modifications, a colored unified diff is shown:

```
🔒 Approval required: Modify src/index.ts

--- src/index.ts (original)
+++ src/index.ts (modified)
@@ -1,3 +1,4 @@
 import { foo } from './foo';
+import { bar } from './bar';

 export function main() {

   ⏎ approve, or type to reject:
```

For new files, all content is shown as additions:

```
🔒 Approval required: Create src/newfile.ts

+++ src/newfile.ts (new file)
+ export function hello() {
+   console.log("Hello!");
+ }

   ⏎ approve, or type to reject:
```

### Command Execution (RunCommand)

```
🔒 Approval required: Execute: rm -rf ./build

   ⏎ approve, or type to reject:
```

### Approving or Rejecting

- **Press Enter** or type **`y`** to approve
- **Type any other text** to reject (the text becomes the rejection reason sent to the LLM)

## Examples

### High-Security Configuration

Block all file writes and command execution:

```toml
[agent]
gadget-approval = {
  WriteFile = "denied",
  EditFile = "denied",
  RunCommand = "denied",
  ReadFile = "allowed"
}
```

### Trust All Gadgets

Allow everything without prompts (not recommended for untrusted code):

```toml
[agent]
gadget-approval = { "*" = "allowed" }
```

### Selective Approval

Require approval only for specific operations:

```toml
[agent]
gadget-approval = {
  RunCommand = "approval-required",
  WriteFile = "allowed",  # Override default
  DeleteFile = "denied"   # Block entirely
}
```

## Non-Interactive Mode

When running in non-interactive mode (piped input, scripts), gadgets with `approval-required` mode are automatically denied with the message:

```
status=denied

{GadgetName} requires interactive approval. Run in a terminal to approve.
```

This ensures scripts don't hang waiting for input that will never come.

## Custom Context Providers

The approval system uses context providers to generate meaningful approval prompts. Built-in providers exist for:

- `WriteFile` - Shows file diffs
- `EditFile` - Shows file diffs or ed commands
- `RunCommand` - Shows the command and working directory

For custom gadgets, a default provider shows the gadget name and parameters.

## See Also

- [CLI Reference](./CLI.md) - Complete CLI documentation
- [Gadgets](./GADGETS.md) - Creating and using gadgets
- [Configuration](./CONFIGURATION.md) - Full configuration reference
