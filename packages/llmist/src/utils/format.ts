/**
 * Formatting utilities for gadget authors and CLI output.
 *
 * Provides common formatting functions for:
 * - Text truncation
 * - Byte size formatting
 * - Date formatting
 * - Duration formatting
 *
 * @module utils/format
 *
 * @example
 * ```typescript
 * import { format } from "llmist";
 *
 * format.truncate("Long text...", 10);  // "Long tex..."
 * format.bytes(1536);                    // "1.5 KB"
 * format.date("2024-01-15T10:30:00Z");  // "Jan 15, 2024 10:30 AM"
 * format.duration(125000);               // "2m 5s"
 * ```
 */

/**
 * Truncate text to a maximum length, adding suffix if truncated.
 *
 * @param text - Text to truncate
 * @param maxLength - Maximum length including suffix
 * @param suffix - Suffix to append when truncated (default: "...")
 * @returns Truncated text
 *
 * @example
 * ```typescript
 * truncate("Hello, World!", 10);  // "Hello, ..."
 * truncate("Short", 10);          // "Short"
 * truncate("Custom", 6, "…");     // "Custo…"
 * ```
 */
export function truncate(text: string, maxLength: number, suffix = "..."): string {
  if (text.length <= maxLength) return text;
  const truncateAt = maxLength - suffix.length;
  if (truncateAt <= 0) return suffix.slice(0, maxLength);
  return text.slice(0, truncateAt) + suffix;
}

/**
 * Format bytes as human-readable string.
 *
 * @param bytes - Number of bytes
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted string (e.g., "1.5 KB", "2.3 MB")
 *
 * @example
 * ```typescript
 * formatBytes(0);        // "0 B"
 * formatBytes(1024);     // "1 KB"
 * formatBytes(1536);     // "1.5 KB"
 * formatBytes(1048576);  // "1 MB"
 * ```
 */
export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return "0 B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = bytes / Math.pow(k, i);

  // Use integer for whole numbers, decimals otherwise
  const formatted = size % 1 === 0 ? size.toString() : size.toFixed(decimals);

  return `${formatted} ${sizes[i]}`;
}

/**
 * Format ISO date string as human-readable date.
 *
 * @param isoDate - ISO date string (e.g., "2024-01-15T10:30:00Z")
 * @param options - Intl.DateTimeFormat options
 * @returns Formatted date string
 *
 * @example
 * ```typescript
 * formatDate("2024-01-15T10:30:00Z");
 * // "Jan 15, 2024, 10:30 AM" (in local timezone)
 *
 * formatDate("2024-01-15T10:30:00Z", { dateStyle: "short" });
 * // "1/15/24"
 * ```
 */
export function formatDate(
  isoDate: string,
  options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  },
): string {
  try {
    const date = new Date(isoDate);
    return date.toLocaleString(undefined, options);
  } catch {
    return isoDate; // Return original if parsing fails
  }
}

/**
 * Format duration in milliseconds as human-readable string.
 *
 * @param ms - Duration in milliseconds
 * @param options - Formatting options
 * @returns Formatted duration string
 *
 * @example
 * ```typescript
 * formatDuration(500);      // "500ms"
 * formatDuration(1500);     // "1.5s"
 * formatDuration(65000);    // "1m 5s"
 * formatDuration(3725000);  // "1h 2m 5s"
 * ```
 */
export function formatDuration(
  ms: number,
  options: { compact?: boolean } = {},
): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    const remainingSeconds = seconds % 60;
    if (options.compact) {
      return `${hours}h ${remainingMinutes}m`;
    }
    return remainingSeconds > 0
      ? `${hours}h ${remainingMinutes}m ${remainingSeconds}s`
      : `${hours}h ${remainingMinutes}m`;
  }

  if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return remainingSeconds > 0
      ? `${minutes}m ${remainingSeconds}s`
      : `${minutes}m`;
  }

  // Less than a minute - show seconds with one decimal if not whole
  const secs = ms / 1000;
  return secs % 1 === 0 ? `${secs}s` : `${secs.toFixed(1)}s`;
}

/**
 * Format namespace object for convenient access.
 *
 * @example
 * ```typescript
 * import { format } from "llmist";
 *
 * format.truncate("text", 5);
 * format.bytes(1024);
 * format.date("2024-01-15");
 * format.duration(5000);
 * ```
 */
export const format = {
  truncate,
  bytes: formatBytes,
  date: formatDate,
  duration: formatDuration,
} as const;
