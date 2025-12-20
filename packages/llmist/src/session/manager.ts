/**
 * Session management interface and base class for gadget packages.
 *
 * Provides a standardized way to manage sessions (browser instances, API clients, etc.)
 * across gadgets. This enables:
 * - Consistent session lifecycle management
 * - Per-agent session isolation
 * - Automatic cleanup
 *
 * @module session/manager
 *
 * @example
 * ```typescript
 * import { BaseSessionManager, ISessionManager } from "llmist";
 *
 * // Extend for browser sessions
 * class BrowserSessionManager extends BaseSessionManager<Page, BrowserConfig> {
 *   async createSession(config?: BrowserConfig): Promise<string> {
 *     const browser = await launchBrowser(config);
 *     const page = await browser.newPage();
 *     const id = this.generateId("p");
 *     this.sessions.set(id, page);
 *     return id;
 *   }
 *
 *   async closeSession(id: string): Promise<void> {
 *     const page = this.sessions.get(id);
 *     if (page) {
 *       await page.close();
 *       this.sessions.delete(id);
 *     }
 *   }
 * }
 * ```
 */

/**
 * Interface for session managers.
 *
 * Session managers track and manage external resources (browser pages, API connections, etc.)
 * that need to be shared across multiple gadgets and properly cleaned up.
 *
 * @typeParam TSession - Type of session object (e.g., Page, APIClient)
 * @typeParam TConfig - Configuration type for creating sessions
 */
export interface ISessionManager<TSession = unknown, TConfig = unknown> {
  /**
   * Create a new session.
   *
   * @param config - Optional configuration for the session
   * @returns Promise resolving to the session ID
   */
  createSession(config?: TConfig): Promise<string>;

  /**
   * Get a session by ID.
   *
   * @param id - Session ID
   * @returns Session object or undefined if not found
   */
  getSession(id: string): TSession | undefined;

  /**
   * Get a session by ID, throwing if not found.
   *
   * @param id - Session ID
   * @returns Session object
   * @throws Error if session not found
   */
  requireSession(id: string): TSession;

  /**
   * Close and remove a session.
   *
   * @param id - Session ID to close
   */
  closeSession(id: string): Promise<void>;

  /**
   * Close all sessions.
   */
  closeAll(): Promise<void>;

  /**
   * List all active session IDs.
   *
   * @returns Array of session IDs
   */
  listSessions(): string[];

  /**
   * Check if a session exists.
   *
   * @param id - Session ID
   * @returns True if session exists
   */
  hasSession(id: string): boolean;
}

/**
 * Base implementation of session manager with common functionality.
 *
 * Extend this class to create domain-specific session managers.
 * You only need to implement `createSession` and `closeSession`.
 *
 * @typeParam TSession - Type of session object
 * @typeParam TConfig - Configuration type for creating sessions
 *
 * @example
 * ```typescript
 * class APIClientManager extends BaseSessionManager<APIClient, APIConfig> {
 *   async createSession(config?: APIConfig): Promise<string> {
 *     const client = new APIClient(config);
 *     const id = this.generateId("api");
 *     this.sessions.set(id, client);
 *     return id;
 *   }
 *
 *   async closeSession(id: string): Promise<void> {
 *     const client = this.sessions.get(id);
 *     if (client) {
 *       await client.disconnect();
 *       this.sessions.delete(id);
 *     }
 *   }
 * }
 * ```
 */
export abstract class BaseSessionManager<TSession, TConfig = unknown>
  implements ISessionManager<TSession, TConfig>
{
  /** Map of session ID to session object */
  protected sessions = new Map<string, TSession>();

  /** Counter for generating unique session IDs */
  protected idCounter = 0;

  /**
   * Generate a unique session ID with the given prefix.
   *
   * @param prefix - Prefix for the ID (e.g., "p" for pages, "b" for browsers)
   * @returns Unique ID like "p1", "p2", etc.
   */
  protected generateId(prefix: string): string {
    return `${prefix}${++this.idCounter}`;
  }

  /**
   * Create a new session.
   * Must be implemented by subclasses.
   */
  abstract createSession(config?: TConfig): Promise<string>;

  /**
   * Close and remove a session.
   * Must be implemented by subclasses.
   */
  abstract closeSession(id: string): Promise<void>;

  /**
   * Get a session by ID.
   */
  getSession(id: string): TSession | undefined {
    return this.sessions.get(id);
  }

  /**
   * Get a session by ID, throwing if not found.
   */
  requireSession(id: string): TSession {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }
    return session;
  }

  /**
   * List all active session IDs.
   */
  listSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Check if a session exists.
   */
  hasSession(id: string): boolean {
    return this.sessions.has(id);
  }

  /**
   * Close all sessions.
   * Closes sessions in reverse order (most recent first).
   */
  async closeAll(): Promise<void> {
    const ids = this.listSessions().reverse();
    for (const id of ids) {
      try {
        await this.closeSession(id);
      } catch {
        // Continue closing other sessions even if one fails
      }
    }
  }
}

/**
 * Simple in-memory session manager for testing or lightweight use cases.
 *
 * Sessions are just stored objects with no special cleanup logic.
 *
 * @example
 * ```typescript
 * const manager = new SimpleSessionManager<MyData>();
 * const id = await manager.createSession({ value: 42 });
 * const data = manager.requireSession(id);  // { value: 42 }
 * await manager.closeSession(id);
 * ```
 */
export class SimpleSessionManager<TSession> extends BaseSessionManager<TSession, TSession> {
  /**
   * Create a session by storing the provided data.
   */
  async createSession(data?: TSession): Promise<string> {
    const id = this.generateId("s");
    if (data !== undefined) {
      this.sessions.set(id, data);
    }
    return id;
  }

  /**
   * Close a session by removing it from the map.
   */
  async closeSession(id: string): Promise<void> {
    this.sessions.delete(id);
  }

  /**
   * Set session data directly.
   */
  setSession(id: string, data: TSession): void {
    this.sessions.set(id, data);
  }
}
