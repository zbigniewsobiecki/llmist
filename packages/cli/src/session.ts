/**
 * CLI session management.
 * Each CLI invocation gets a unique session with a memorable name.
 */

import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { generateSessionName } from "./session-names.js";

/**
 * Represents a CLI session with logging directory.
 */
export interface Session {
  /** Memorable session name (e.g., "sunny-falcon" or "sunny-falcon-2") */
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
 * Finds a unique session name by appending a number suffix if needed.
 * First tries the base name (e.g., "sunny-falcon"), then "sunny-falcon-2", etc.
 */
function findUniqueName(baseName: string): string {
  const baseDir = join(SESSION_LOGS_BASE, baseName);
  if (!existsSync(baseDir)) {
    return baseName;
  }

  // Try with incrementing suffix
  let suffix = 2;
  while (suffix < 1000) {
    const name = `${baseName}-${suffix}`;
    const dir = join(SESSION_LOGS_BASE, name);
    if (!existsSync(dir)) {
      return name;
    }
    suffix++;
  }

  // Fallback: add timestamp (extremely unlikely to reach here)
  return `${baseName}-${Date.now()}`;
}

/**
 * Initializes a new session with a memorable random name.
 * Creates the session directory at ~/.llmist/logs/<session_name>/
 *
 * Names are in format "adjective-noun" (e.g., "sunny-falcon").
 * If a name already exists, appends a number suffix (e.g., "sunny-falcon-2").
 *
 * If a session is already initialized, returns the existing session.
 */
export async function initSession(): Promise<Session> {
  if (currentSession) {
    return currentSession;
  }

  const baseName = generateSessionName();
  const name = findUniqueName(baseName);
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
