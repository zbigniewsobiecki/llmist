/**
 * TodoUpsert gadget - Create or update todo items.
 */
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
