/**
 * Storage for large gadget outputs that exceed the configured limit.
 *
 * When a gadget returns more data than the configured limit, the output
 * is stored here and can be browsed later using GadgetOutputViewer.
 */

import { randomBytes } from "node:crypto";

/**
 * Metadata and content for a stored gadget output.
 */
export interface StoredOutput {
  /** Unique identifier (e.g., "Search_d34db33f") */
  id: string;
  /** Name of the gadget that produced this output */
  gadgetName: string;
  /** Full output content */
  content: string;
  /** Size in bytes */
  byteSize: number;
  /** Number of lines */
  lineCount: number;
  /** When the output was stored */
  timestamp: Date;
}

/**
 * In-memory store for large gadget outputs.
 *
 * Outputs are stored with generated IDs in the format `{GadgetName}_{hex8}`.
 * The store is tied to an agent run and cleared when the agent completes.
 *
 * @example
 * ```typescript
 * const store = new GadgetOutputStore();
 * const id = store.store("Search", largeOutput);
 * // id = "Search_a1b2c3d4"
 *
 * const stored = store.get(id);
 * console.log(stored?.lineCount); // 4200
 * ```
 */
export class GadgetOutputStore {
  private outputs = new Map<string, StoredOutput>();

  /**
   * Store a gadget output and return its ID.
   *
   * @param gadgetName - Name of the gadget that produced the output
   * @param content - Full output content to store
   * @returns Generated ID for retrieving the output later
   */
  store(gadgetName: string, content: string): string {
    const id = this.generateId(gadgetName);
    const encoder = new TextEncoder();

    const stored: StoredOutput = {
      id,
      gadgetName,
      content,
      byteSize: encoder.encode(content).length,
      lineCount: content.split("\n").length,
      timestamp: new Date(),
    };

    this.outputs.set(id, stored);
    return id;
  }

  /**
   * Retrieve a stored output by ID.
   *
   * @param id - The output ID (e.g., "Search_d34db33f")
   * @returns The stored output or undefined if not found
   */
  get(id: string): StoredOutput | undefined {
    return this.outputs.get(id);
  }

  /**
   * Check if an output exists.
   *
   * @param id - The output ID to check
   * @returns True if the output exists
   */
  has(id: string): boolean {
    return this.outputs.has(id);
  }

  /**
   * Get all stored output IDs.
   *
   * @returns Array of output IDs
   */
  getIds(): string[] {
    return Array.from(this.outputs.keys());
  }

  /**
   * Get the number of stored outputs.
   */
  get size(): number {
    return this.outputs.size;
  }

  /**
   * Clear all stored outputs.
   * Called when the agent run completes.
   */
  clear(): void {
    this.outputs.clear();
  }

  /**
   * Generate a unique ID for a stored output.
   * Format: {GadgetName}_{8 hex chars}
   */
  private generateId(gadgetName: string): string {
    const hex = randomBytes(4).toString("hex");
    return `${gadgetName}_${hex}`;
  }
}
