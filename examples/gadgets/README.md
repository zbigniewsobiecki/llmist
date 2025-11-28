# File System Gadgets

Four example gadgets that provide secure file system operations with local directory sandboxing.

## Gadgets

### ReadFile
Reads the entire content of a file and returns it as text.

**Parameters:**
- `filePath` (string): Path to the file to read (relative or absolute)

**Example:**
```bash
bun run src/cli.ts agent "Read the package.json file" --gadget ./examples/gadgets/filesystem.ts
```

### WriteFile
Writes content to a file. Creates parent directories if needed. Overwrites existing files.

**Parameters:**
- `filePath` (string): Path to the file to write (relative or absolute)
- `content` (string): Content to write to the file

**Example:**
```bash
bun run src/cli.ts agent "Write 'Hello World' to output.txt" --gadget ./examples/gadgets/filesystem.ts
```

### EditFile
Edit files using ed commands. Ed is a line-oriented text editor that accepts commands via stdin.

**Parameters:**
- `filePath` (string): Path to the file to edit (relative or absolute)
- `commands` (string): Ed commands to execute, one per line

**Common ed commands:**
- `1,$p` - Print all lines
- `1,$s/old/new/g` - Replace all occurrences
- `3d` - Delete line 3
- `$a` + text + `.` - Append after last line
- `w` - Write (save)
- `q` - Quit

**Example:**
```bash
bun run src/cli.ts agent "Replace all TODO with DONE in notes.txt" --gadget ./examples/gadgets/filesystem.ts
```

**Security:** Shell escape commands (`!`) are filtered to prevent arbitrary command execution.

### ListDirectory
Lists files and directories with full metadata (type, name, size, modification date).

**Parameters:**
- `directoryPath` (string, default: "."): Path to the directory to list
- `maxDepth` (number, 1-10, default: 1): Maximum depth to recurse (1 = immediate children only)

**Example:**
```bash
bun run src/cli.ts agent "List the src directory recursively" --gadget ./examples/gadgets/filesystem.ts
```

## Security: Path Sandboxing

All three gadgets implement strict path validation to ensure all file operations are restricted to the current working directory and its subdirectories:

- ✓ Prevents directory traversal attacks (`../../../etc/passwd`)
- ✓ Blocks access to absolute paths outside CWD (`/etc/passwd`)
- ✓ Resolves symlinks to prevent escape attempts
- ✓ Validates paths before any file system operations

**Example - Security in action:**
```bash
# This will be rejected by the path validator
bun run src/cli.ts agent "Read /etc/passwd" --gadget ./examples/gadgets/filesystem.ts

# Error: Path access denied: /etc/passwd. Path is outside the current working directory
```

## Implementation Details

### Files
- `filesystem/utils.ts` - Path validation utility and `PathSandboxException` class
- `filesystem/read-file.ts` - ReadFile gadget implementation
- `filesystem/write-file.ts` - WriteFile gadget implementation
- `filesystem/edit-file.ts` - EditFile gadget implementation
- `filesystem/list-directory.ts` - ListDirectory gadget implementation
- `filesystem/index.ts` - Re-exports all gadgets

### Path Validation
The `validatePathIsWithinCwd()` function:
1. Resolves paths to absolute form
2. Uses `fs.realpathSync()` to handle symlinks securely
3. Verifies the resolved path is within the current working directory
4. Throws `PathSandboxException` if validation fails

### Output Format (ListDirectory)
Uses a compact pipe-separated DSL optimized for LLM token efficiency:
```
path=. maxDepth=1

#T|N|S|A
D|src|0|2h
D|tests|0|1d
F|package.json|2841|3h
F|README.md|1713|5m
L|link-to-config|0|1d
```
Header: `#T|N|S|A` = Type, Name, Size, Age. Types: `D`=directory, `F`=file, `L`=symlink.

### Output Format (ReadFile/WriteFile)
```
path=package.json

{ "name": "my-project", ... }
```

## Usage in Code

See `examples/09-filesystem-gadgets.ts` for a complete example:

```typescript
import { LLMist } from "../src/index.js";
import { readFile, writeFile, editFile, listDirectory } from "./gadgets/filesystem/index.js";

const agent = LLMist.createAgent()
  .withModel("gpt-4o-mini")
  .withGadgets(readFile, writeFile, editFile, listDirectory);

const result = await agent.ask(
  "Read package.json and tell me the version"
);
```

## Important Notes

- Use `bun run src/cli.ts` (not `dist/cli.js`) when loading TypeScript gadget files
- File paths must be within the current working directory
- Symlinks are resolved to their real paths for validation
- Binary files will be decoded as UTF-8 (may produce garbled text)
- Large files are returned in full (LLM handles context limits)
