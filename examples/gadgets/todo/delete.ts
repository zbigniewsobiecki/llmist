/**
 * TodoDelete gadget - Remove a todo item by ID.
 */
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
