/**
 * Markdown rendering utilities for terminal output.
 *
 * Provides functions for converting markdown text to ANSI-styled
 * terminal output using marked and marked-terminal.
 *
 * **SHOWCASE:** Demonstrates how to build a polished CLI on top of llmist's core.
 */

import chalk from "chalk";
import { type MarkedExtension, marked } from "marked";
import { markedTerminal } from "marked-terminal";

/**
 * Lazy-initialized flag for marked-terminal configuration.
 *
 * We defer `marked.use(markedTerminal())` until first render because:
 * - markedTerminal() captures chalk's color level at call time
 * - At module import time, TTY detection may not be complete
 * - Lazy init ensures colors work in interactive terminals
 */
let markedConfigured = false;

/**
 * Configure marked for terminal output (lazy initialization).
 *
 * Uses marked-terminal to convert markdown to ANSI-styled terminal output.
 * This enables rich formatting in TellUser messages and AskUser questions.
 *
 * We override marked-terminal's style functions with our own chalk instance
 * because marked-terminal bundles its own chalk that detects colors at module
 * load time. In some environments, the bundled chalk may detect level 0 (no colors)
 * due to TTY detection issues.
 *
 * By forcing `chalk.level = 3` on our imported chalk and passing custom style
 * functions, we ensure colors work regardless of TTY detection.
 *
 * Respects the NO_COLOR environment variable for accessibility.
 *
 * Note: Type assertion needed due to @types/marked-terminal lag behind the runtime API.
 */
function ensureMarkedConfigured(): void {
  if (!markedConfigured) {
    // Respect NO_COLOR env var, otherwise force truecolor (level 3)
    chalk.level = process.env.NO_COLOR ? 0 : 3;

    // Override marked-terminal's style functions with our chalk instance
    // to ensure consistent color output regardless of TTY detection
    marked.use(
      markedTerminal({
        // Text styling
        strong: chalk.bold,
        em: chalk.italic,
        del: chalk.dim.gray.strikethrough,

        // Code styling
        code: chalk.yellow,
        codespan: chalk.yellow,

        // Headings
        heading: chalk.green.bold,
        firstHeading: chalk.magenta.underline.bold,
        showSectionPrefix: false, // Hide "###" prefix, use styling instead

        // Links - will be overridden by OSC 8 renderer below
        link: chalk.blue,
        href: chalk.blue.underline,

        // Block elements
        blockquote: chalk.gray.italic,

        // List formatting - reduce indentation and add bullet styling
        tab: 2, // Reduce from default 4 to 2 spaces
        listitem: chalk.reset, // Keep items readable (no dim)

        // Width settings - use full terminal width to avoid truncation
        // Default is 80 which cuts off TellUser messages
        width: process.stdout.columns || 120,
        reflowText: true,
      }) as unknown as MarkedExtension,
    );

    // Override link rendering with OSC 8 hyperlinks for clickable terminal links
    // This must come AFTER markedTerminal() to override its link handling
    // OSC 8 format: ESC ] 8 ; ; URL ST text ESC ] 8 ; ; ST
    // Terminals that don't support OSC 8 will ignore the sequences and show styled text
    marked.use({
      renderer: {
        link({ href, text }) {
          const linkStart = `\x1b]8;;${href}\x1b\\`;
          const linkEnd = `\x1b]8;;\x1b\\`;
          // Blue underline so it looks like a link even in non-OSC8 terminals
          return `${linkStart}${chalk.blue.underline(text)}${linkEnd}`;
        },
      },
    });

    markedConfigured = true;
  }
}

/**
 * Renders markdown text as styled terminal output.
 *
 * Converts markdown syntax to ANSI escape codes for terminal display:
 * - **bold** and *italic* text
 * - `inline code` and code blocks
 * - Lists (bulleted and numbered)
 * - Headers
 * - Links (clickable in supported terminals)
 *
 * @param text - Markdown text to render
 * @returns ANSI-styled string for terminal output
 *
 * @example
 * ```typescript
 * renderMarkdown("**Important:** Check the `config.json` file");
 * // Returns styled text with bold "Important:" and code-styled "config.json"
 * ```
 */
export function renderMarkdown(text: string): string {
  ensureMarkedConfigured();
  let rendered = marked.parse(text) as string;

  // Workaround for marked-terminal bug: inline markdown in list items
  // is not processed. Post-process to handle **bold** and *italic*.
  // See: https://github.com/mikaelbr/marked-terminal/issues
  rendered = rendered
    .replace(/\*\*(.+?)\*\*/g, (_, content) => chalk.bold(content))
    // Italic: require non-space after * to avoid matching bullet points (  * )
    .replace(/(?<!\*)\*(\S[^*]*)\*(?!\*)/g, (_, content) => chalk.italic(content));

  // Remove trailing newlines that marked adds
  return rendered.trimEnd();
}

/**
 * Creates a rainbow-colored horizontal line for visual emphasis.
 * Cycles through colors for each character segment.
 * Uses the full terminal width for a complete visual separator.
 *
 * @returns Rainbow-colored separator string spanning the terminal width
 */
function createRainbowSeparator(): string {
  const colors = [chalk.red, chalk.yellow, chalk.green, chalk.cyan, chalk.blue, chalk.magenta];
  const char = "─";
  // Use terminal width, fallback to 80 if not available (e.g., piped output)
  const width = process.stdout.columns || 80;
  let result = "";
  for (let i = 0; i < width; i++) {
    result += colors[i % colors.length](char);
  }
  return result;
}

/**
 * Renders markdown with colorful rainbow horizontal line separators above and below.
 * Use this for prominent markdown content that should stand out visually.
 *
 * @param text - Markdown text to render
 * @returns Rendered markdown with rainbow separators
 *
 * @example
 * ```typescript
 * renderMarkdownWithSeparators("**Hello** world!");
 * // Returns rainbow line + styled markdown + rainbow line
 * ```
 */
export function renderMarkdownWithSeparators(text: string): string {
  const rendered = renderMarkdown(text);
  const separator = createRainbowSeparator();
  return `\n${separator}\n${rendered}\n${separator}\n`;
}

/**
 * Formats a user message for display in the TUI REPL.
 *
 * Uses a distinct icon (👤) and cyan coloring to differentiate user input
 * from LLM responses. The message content is rendered with markdown support.
 *
 * @param message - The user's message text
 * @returns Formatted string with icon and markdown rendering
 *
 * @example
 * ```typescript
 * formatUserMessage("Can you add unit tests for this?");
 * // Returns: "\n[inverse] 👤 Can you add unit tests for this? [/inverse]\n"
 * ```
 */
export function formatUserMessage(message: string): string {
  const icon = "👤";
  // User input is plain text, not markdown - render as clean inverse block
  return `\n${chalk.inverse(` ${icon} ${message} `)}\n`;
}
