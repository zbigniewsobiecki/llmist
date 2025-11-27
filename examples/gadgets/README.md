# File System Gadgets

Two example gadgets that provide secure file system operations with local directory sandboxing.

## Gadgets

### ReadFile
Reads the entire content of a file and returns it as text.

**Parameters:**
- `filePath` (string): Path to the file to read (relative or absolute)

**Example:**
```bash
bun run src/cli.ts agent "Read the package.json file" --gadget ./examples/gadgets/filesystem.ts
```

### ListDirectory
Lists files and directories with full metadata (type, name, size, modification date).

**Parameters:**
- `directoryPath` (string, default: "."): Path to the directory to list
- `recursive` (boolean, default: false): Whether to recursively list subdirectories

**Example:**
```bash
bun run src/cli.ts agent "List the src directory recursively" --gadget ./examples/gadgets/filesystem.ts
```

## Security: Path Sandboxing

Both gadgets implement strict path validation to ensure all file operations are restricted to the current working directory and its subdirectories:

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
- `filesystem/list-directory.ts` - ListDirectory gadget implementation
- `filesystem/index.ts` - Re-exports all gadgets

### Path Validation
The `validatePathIsWithinCwd()` function:
1. Resolves paths to absolute form
2. Uses `fs.realpathSync()` to handle symlinks securely
3. Verifies the resolved path is within the current working directory
4. Throws `PathSandboxException` if validation fails

### Output Format (ListDirectory)
```
Type       | Name              | Size         | Modified
-----------+-------------------+--------------+----------------------------
directory  | src               | -            | 2025-11-26T14:28:15.000Z
file       | package.json      | 2841         | 2025-11-26T10:15:30.000Z
file       | README.md         | 1713         | 2025-11-26T10:35:10.910Z
symlink    | link-to-config    | -            | 2025-11-26T14:20:00.000Z
```

## Usage in Code

See `examples/09-filesystem-gadgets.ts` for a complete example:

```typescript
import { LLMist } from "../src/index.js";
import { readFile, listDirectory } from "./gadgets/filesystem/index.js";

const agent = LLMist.createAgent()
  .withModel("gpt-4o-mini")
  .withGadgets(readFile, listDirectory);

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
