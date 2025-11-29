# Building Todo Gadgets for Agent Task Planning

This cookbook shows how to create a set of gadgets that let agents plan and track their work using a persistent todo list. This pattern is useful for complex research tasks, multi-step workflows, and any scenario where you want the agent to think before acting.

## Overview

We'll create:
- **TodoUpsert** - Create new todos or update existing ones
- **TodoDelete** - Remove todos by ID
- A shared storage module for session-based YAML persistence

Each gadget returns the **full todo list** after every operation, giving the agent continuous visibility into task state.

## File Structure

```
~/.llmist/gadgets/todo/
├── index.ts      # Exports both gadgets
├── storage.ts    # Session ID + YAML read/write utilities
├── upsert.ts     # TodoUpsert gadget
└── delete.ts     # TodoDelete gadget
```

## Implementation

### storage.ts - Shared Utilities

```typescript
/**
 * Shared storage utilities for todo gadgets.
 * Handles session ID generation, YAML persistence, and formatting.
 */
import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import YAML from "yaml";

// Generate session ID once at module load time
// Each CLI invocation gets its own todo file
const SESSION_ID = new Date().toISOString().replace(/:/g, "-").split(".")[0];

const TODOS_DIR = path.join(homedir(), ".llmist", "todos");
const SESSION_FILE = path.join(TODOS_DIR, `${SESSION_ID}.yaml`);

export type TodoStatus = "pending" | "in_progress" | "done";

export interface Todo {
  id: string;
  content: string;
  status: TodoStatus;
  createdAt: string;
  updatedAt: string;
}

export function ensureDir(): void {
  if (!fs.existsSync(TODOS_DIR)) {
    fs.mkdirSync(TODOS_DIR, { recursive: true });
  }
}

export function loadTodos(): Todo[] {
  ensureDir();
  if (!fs.existsSync(SESSION_FILE)) {
    return [];
  }
  const content = fs.readFileSync(SESSION_FILE, "utf-8");
  return YAML.parse(content) || [];
}

export function saveTodos(todos: Todo[]): void {
  ensureDir();
  fs.writeFileSync(SESSION_FILE, YAML.stringify(todos));
}

export function getNextId(todos: Todo[]): string {
  const maxId = todos.reduce((max, t) => Math.max(max, parseInt(t.id) || 0), 0);
  return String(maxId + 1);
}

/**
 * Formats the full todo list for display.
 * Always includes ALL todos (pending, in_progress, and done).
 */
export function formatTodoList(todos: Todo[]): string {
  if (todos.length === 0) {
    return "📋 Todo list is empty.";
  }

  const statusIcons: Record<TodoStatus, string> = {
    pending: "⬜",
    in_progress: "🔄",
    done: "✅",
  };

  const lines = todos.map((t) => {
    const icon = statusIcons[t.status];
    return `${icon} #${t.id} [${t.status}]: ${t.content}`;
  });

  const stats = {
    pending: todos.filter((t) => t.status === "pending").length,
    in_progress: todos.filter((t) => t.status === "in_progress").length,
    done: todos.filter((t) => t.status === "done").length,
  };

  return [
    `📋 Session: ${SESSION_ID}`,
    `   Progress: ${stats.done}/${todos.length} done, ${stats.in_progress} in progress, ${stats.pending} pending`,
    "",
    ...lines,
  ].join("\n");
}

export { SESSION_ID };
```

### upsert.ts - Create/Update Todos

```typescript
import { z } from "zod";
import { createGadget } from "llmist";
import {
  loadTodos,
  saveTodos,
  getNextId,
  formatTodoList,
  type Todo,
  type TodoStatus,
} from "./storage.js";

export const todoUpsert = createGadget({
  name: "TodoUpsert",
  description:
    "Create a new todo or update an existing one. Omit 'id' to create, provide 'id' to update. Returns the full todo list.",
  schema: z.object({
    id: z
      .string()
      .optional()
      .describe("ID of existing todo to update. Omit to create a new todo."),
    content: z.string().min(1).describe("The todo item description/content."),
    status: z
      .enum(["pending", "in_progress", "done"])
      .default("pending")
      .describe("Todo status: pending, in_progress, or done."),
  }),
  execute: async ({ id, content, status }) => {
    const todos = loadTodos();
    const now = new Date().toISOString();

    if (id) {
      // Update existing todo
      const index = todos.findIndex((t) => t.id === id);
      if (index === -1) {
        return `❌ Error: Todo #${id} not found.\n\n${formatTodoList(todos)}`;
      }

      todos[index] = {
        ...todos[index],
        content,
        status: status as TodoStatus,
        updatedAt: now,
      };

      saveTodos(todos);
      return `✏️ Updated todo #${id}.\n\n${formatTodoList(todos)}`;
    } else {
      // Create new todo
      const newId = getNextId(todos);
      const newTodo: Todo = {
        id: newId,
        content,
        status: status as TodoStatus,
        createdAt: now,
        updatedAt: now,
      };

      todos.push(newTodo);
      saveTodos(todos);
      return `➕ Created todo #${newId}.\n\n${formatTodoList(todos)}`;
    }
  },
});
```

### delete.ts - Remove Todos

```typescript
import { z } from "zod";
import { createGadget } from "llmist";
import { loadTodos, saveTodos, formatTodoList } from "./storage.js";

export const todoDelete = createGadget({
  name: "TodoDelete",
  description: "Delete a todo item by ID. Returns the full remaining todo list.",
  schema: z.object({
    id: z.string().describe("ID of the todo to delete."),
  }),
  execute: async ({ id }) => {
    const todos = loadTodos();
    const index = todos.findIndex((t) => t.id === id);

    if (index === -1) {
      return `❌ Error: Todo #${id} not found.\n\n${formatTodoList(todos)}`;
    }

    const deleted = todos.splice(index, 1)[0];
    saveTodos(todos);

    return `🗑️ Deleted todo #${id}: "${deleted.content}"\n\n${formatTodoList(todos)}`;
  },
});
```

### index.ts - Export Both Gadgets

```typescript
export { todoUpsert } from "./upsert.js";
export { todoDelete } from "./delete.js";
```

## CLI Configuration

Add the todo gadgets to your `~/.llmist/cli.toml`:

```toml
[research]
inherits = "agent"
description = "Deep technical research with structured planning."
max-iterations = 15
gadget = [
  "~/.llmist/gadgets/google-search.ts",
  "~/.llmist/gadgets/todo/index.ts",
]
system = """
You are an experienced technical researcher. Follow this structured approach:

## 🎯 PHASE 1: PLANNING (Always start here!)
Before ANY research, create your investigation plan:
1. Use TodoUpsert to create 3-5 specific research tasks
2. Each task should be a concrete, searchable query
3. Think about what aspects need investigation (syntax, performance, ecosystem, use cases, etc.)
4. Mark the first task as "in_progress" when you start

## 🔍 PHASE 2: EXECUTION
Work through your todos systematically:
1. For each "in_progress" todo, use GoogleSearch to find authoritative sources
2. Mark todos as "done" when you've gathered sufficient information
3. Use TodoUpsert to update the next "pending" todo to "in_progress"
4. Add new todos if you discover important related topics

## 📊 PHASE 3: SYNTHESIS
When all todos are done (or you have enough info):
1. Use TellUser to present your findings clearly
2. Structure as: Summary → Key Differences → Recommendations
3. Cite your sources with URLs
4. Be opinionated - give your expert recommendation

Always show the full todo list after each update so progress is visible!
"""
```

## Usage

```bash
llmist research "Compare TOML and YAML configuration formats"
```

The agent will:
1. Create a research plan with specific investigation tasks
2. Work through each task systematically
3. Track progress with status updates
4. Synthesize findings when complete

## Example Output

```
📋 Session: 2024-11-29T16-44-09
   Progress: 2/4 done, 1 in progress, 1 pending

✅ #1 [done]: Research TOML syntax and design philosophy
✅ #2 [done]: Research YAML syntax and common pitfalls
🔄 #3 [in_progress]: Compare parsing performance and library support
⬜ #4 [pending]: Find real-world adoption statistics
```

## Design Decisions

### Session Isolation
Each CLI invocation generates a unique timestamp-based session ID. This means running multiple research sessions won't interfere with each other.

### Full List on Every Operation
Both gadgets return the complete todo list after every operation. This eliminates the need for a separate "list" gadget and ensures the agent always has full context.

### YAML Persistence
Todos are stored in human-readable YAML files at `~/.llmist/todos/`. You can inspect or manually edit these files if needed.

### Status Icons
Visual status indicators (⬜ ✅ 🔄) make it easy for both humans and agents to quickly scan the todo state.

## Extending This Pattern

You could extend these gadgets with:
- **Priority levels** - Add a priority field for task ordering
- **Dependencies** - Allow todos to depend on other todos
- **Time tracking** - Record time spent on each task
- **Categories/Tags** - Group related todos together
- **Cross-session persistence** - Share todos across CLI invocations
