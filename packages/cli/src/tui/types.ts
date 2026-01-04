/**
 * TUI type definitions for the blessed-based terminal interface.
 */

import type { Box, Screen, ScrollableBox, Text, Textbox } from "@unblessed/node";

// Note: Box is imported for SelectableBlock.box type

/**
 * Configuration options for creating the TUI application.
 */
export interface TUIOptions {
  /** Model name to display in status bar */
  model: string;
  /** Standard input stream (optional, defaults to process.stdin) */
  stdin?: NodeJS.ReadStream;
  /** Standard output stream (optional, defaults to process.stdout) */
  stdout?: NodeJS.WriteStream;
}

/**
 * Metrics tracked for the status bar display.
 */
export interface TUIMetrics {
  /** Total input tokens across all LLM calls */
  inputTokens: number;
  /** Total output tokens across all LLM calls */
  outputTokens: number;
  /** Total cached input tokens */
  cachedTokens: number;
  /** Total cost in USD */
  cost: number;
  /** Session start time (Date.now()) */
  startTime: number;
  /** Current LLM call iteration number */
  iteration: number;
  /** Current model name */
  model: string;
}

/**
 * Approval dialog response options.
 */
export type ApprovalResponse = "yes" | "no" | "always" | "deny" | "cancel";

/**
 * Focus mode for TUI interaction.
 * - "browse": Navigate blocks with arrow keys, input bar hidden
 * - "input": Type in input bar, navigation disabled
 */
export type FocusMode = "browse" | "input";

/**
 * Content filter mode for block visibility.
 * - "full": Show all blocks (LLM calls, gadgets, text)
 * - "focused": Clean view - hide technical details, show only user communication
 *              (text, TellUser, AskUser, Finish gadgets)
 */
export type ContentFilterMode = "full" | "focused";

/**
 * Context for approval dialog display.
 */
export interface ApprovalContext {
  /** Gadget name requiring approval */
  gadgetName: string;
  /** Parameters being passed to the gadget */
  parameters: Record<string, unknown>;
  /** Optional preview content */
  preview?: string;
}

/**
 * Screen context wrapper for lifecycle management.
 */
export interface TUIScreenContext {
  /** The blessed Screen instance */
  screen: Screen;
  /** Request a render update (debounced at ~60fps) */
  requestRender: () => void;
  /** Render immediately without debouncing (for time-sensitive updates) */
  renderNow: () => void;
  /** Destroy and restore terminal */
  destroy: () => void;
}

/**
 * Callbacks for keyboard actions.
 */
export interface KeyboardCallbacks {
  /** Called when ESC is pressed to cancel operation */
  onCancel: () => void;
  /** Called when user wants to quit (double Ctrl+C) */
  onQuit: () => void;
  /** Called when input is submitted */
  onInputSubmit: (value: string) => void;
}

/**
 * State for pending AskUser input.
 */
export interface PendingInput {
  /** Question being asked */
  question: string;
  /** Gadget name that requested input */
  gadgetName: string;
  /** Resolve function for the promise */
  resolve: (value: string) => void;
  /** Reject function for the promise */
  reject: (error: Error) => void;
}

/**
 * Callback for Ctrl+C events from input handler.
 */
export type CtrlCCallback = () => void;

// ─────────────────────────────────────────────────────────────────────────────
// Block Tree Types (for interactive selectable/expandable blocks)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The TUI renders a tree of blocks:
 *
 * ```
 * LLM Call #1
 * ├── Gadget: ReadFile
 * ├── Gadget: BrowseWeb (subagent)
 * │   ├── LLM Call #1.1
 * │   │   ├── Gadget: Navigate
 * │   │   └── Gadget: Screenshot
 * │   └── LLM Call #1.2
 * │       └── Gadget: Click
 * └── Gadget: WriteFile
 * LLM Call #2
 * └── ...
 * ```
 *
 * Each node can be selected and expanded to show details.
 * Text content flows between LLM calls (not selectable).
 */

/**
 * Node type discriminator.
 */
export type BlockNodeType = "llm_call" | "gadget" | "text";

/**
 * Base properties shared by all block nodes.
 */
interface BaseBlockNode {
  /** Unique identifier for this node */
  id: string;
  /** Node type discriminator */
  type: BlockNodeType;
  /** Nesting depth (0 = top-level, 1 = child of gadget, etc.) */
  depth: number;
  /** Parent node ID (null for top-level) */
  parentId: string | null;
  /** Session ID - tracks which REPL session this node belongs to */
  sessionId: number;
}

/**
 * LLM call node - represents an iteration of the LLM.
 * Can have gadget children.
 */
export interface LLMCallNode extends BaseBlockNode {
  type: "llm_call";
  /** Iteration number (1-indexed for top-level, resets for subagents) */
  iteration: number;
  /** Model identifier */
  model: string;
  /** Whether the call is complete */
  isComplete: boolean;
  /** Token and cost details (populated on completion) */
  details?: {
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
    elapsedSeconds?: number;
    cost?: number;
    finishReason?: string;
    contextPercent?: number;
  };
  /** Child gadget node IDs */
  children: string[];
  /** Full message array sent to LLM (for raw viewer) */
  rawRequest?: import("llmist").LLMMessage[];
  /** Raw response text from LLM (for raw viewer) */
  rawResponse?: string;
}

/**
 * Gadget call node - represents a gadget invocation.
 * Subagent gadgets can have nested LLM call children.
 */
export interface GadgetNode extends BaseBlockNode {
  type: "gadget";
  /** Invocation ID for matching results */
  invocationId: string;
  /** Gadget name */
  name: string;
  /** Whether the gadget has completed */
  isComplete: boolean;
  /** Parameters passed to the gadget */
  parameters?: Record<string, unknown>;
  /** Result string (when complete) */
  result?: string;
  /** Error string (if failed) */
  error?: string;
  /** Execution time in ms (when complete) */
  executionTimeMs?: number;
  /** Cost of gadget execution in USD */
  cost?: number;
  /** Estimated tokens in result (for context budget awareness) */
  resultTokens?: number;
  /** Aggregated stats from subagent LLM calls (computed when gadget completes) */
  subagentStats?: {
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    cost: number;
    llmCallCount: number;
  };
  /** Child node IDs (for subagent gadgets: nested LLM calls) */
  children: string[];
}

/**
 * Text content node (not selectable).
 * Flows inline between LLM calls.
 */
export interface TextNode extends BaseBlockNode {
  type: "text";
  /** Rendered text content */
  content: string;
  /** Text has no children */
  children: never[];
}

/**
 * Union of all block node types.
 */
export type BlockNode = LLMCallNode | GadgetNode | TextNode;

/**
 * A rendered block with UI state.
 * Wraps a BlockNode with widget reference and UI state.
 */
export interface SelectableBlock {
  /** Reference to the underlying node */
  node: BlockNode;
  /** The blessed Box widget for this block */
  box: Box;
  /** Whether this block is currently expanded */
  expanded: boolean;
  /** Whether this block can be selected (text nodes are not) */
  selectable: boolean;
}

/**
 * Layout with ScrollableBox body for block-based rendering.
 */
export interface TUIBlockLayout {
  /** Main scrollable container with Box children */
  body: ScrollableBox;
  /** Static prompt label (non-editable "> " or ">>> ") */
  promptLabel: Text;
  /** Input field at the bottom (editable, no prompt in value) */
  inputBar: Textbox;
  /** Status bar */
  statusBar: Box;
}
