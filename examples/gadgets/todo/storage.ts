/**
 * Shared storage utilities for todo gadgets.
 * Handles session ID generation, YAML persistence, and formatting.
 */
import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import YAML from "yaml";

// Generate session ID once at module load time
// Format: 2024-11-29T16-44-09 (ISO with colons replaced by dashes)
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

/**
 * Ensures the todos directory exists.
 */
export function ensureDir(): void {
  if (!fs.existsSync(TODOS_DIR)) {
    fs.mkdirSync(TODOS_DIR, { recursive: true });
  }
}

/**
 * Loads todos from the current session file.
 */
export function loadTodos(): Todo[] {
  ensureDir();
  if (!fs.existsSync(SESSION_FILE)) {
    return [];
  }
  const content = fs.readFileSync(SESSION_FILE, "utf-8");
  return YAML.parse(content) || [];
}

/**
 * Saves todos to the current session file.
 */
export function saveTodos(todos: Todo[]): void {
  ensureDir();
  fs.writeFileSync(SESSION_FILE, YAML.stringify(todos));
}

/**
 * Generates the next available todo ID (incrementing integer).
 */
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
