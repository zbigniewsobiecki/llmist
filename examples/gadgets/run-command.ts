/**
 * RunCommand gadget - Re-exported from the built-in implementation.
 *
 * This gadget is provided as a built-in. See the source implementation at:
 * src/cli/builtins/run-command.ts
 *
 * Features:
 * - Executes shell commands with full special character support
 * - Uses stdin-based execution to handle quotes, backticks, newlines correctly
 * - Configurable timeout and working directory
 * - Returns status code and combined stdout/stderr output
 */
export { runCommand } from "../../src/cli/builtins/run-command.js";
