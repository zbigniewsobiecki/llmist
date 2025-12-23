/**
 * CLI session management.
 * Each CLI invocation gets a unique session with a memorable name.
 */

import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { generateSessionName } from "./session-names.js";

/**
 * Represents a CLI session with logging directory.
 */
export interface Session {
  /** Memorable session name (e.g., "sunny-falcon-42") */
  name: string;
  /** Full path to session log directory */
  logDir: string;
}

/** Current session singleton */
let currentSession: Session | undefined;

/**
 * Base directory for all session logs.
 */
export const SESSION_LOGS_BASE = join(homedir(), ".llmist", "logs");

/**
 * Initializes a new session with a memorable random name.
 * Creates the session directory at ~/.llmist/logs/<session_name>/
 *
 * If a session is already initialized, returns the existing session.
 */
export async function initSession(): Promise<Session> {
  if (currentSession) {
    return currentSession;
  }

  const name = generateSessionName();
  const logDir = join(SESSION_LOGS_BASE, name);

  await mkdir(logDir, { recursive: true });

  currentSession = { name, logDir };
  return currentSession;
}

/**
 * Gets the current session, or undefined if not initialized.
 */
export function getSession(): Session | undefined {
  return currentSession;
}

/**
 * Resets the session state. Used for testing.
 */
export function resetSession(): void {
  currentSession = undefined;
}
