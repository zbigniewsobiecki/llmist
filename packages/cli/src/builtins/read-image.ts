import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createGadget, getErrorMessage, resultWithImage } from "llmist";
import { z } from "zod";
import { formatFileSize } from "../file-utils.js";

/** Maximum image size in bytes (50 MB). */
const MAX_IMAGE_SIZE = 50 * 1024 * 1024;

/** Timeout for fetching images from URLs (30 seconds). */
const URL_FETCH_TIMEOUT_MS = 30_000;

const SUPPORTED_FORMATS = "JPEG, PNG, GIF, WebP";

const USER_AGENT = "llmist-cli";

/** Map detected MIME types to file extensions for fallback naming. */
const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

function isUrl(source: string): boolean {
  return source.startsWith("http://") || source.startsWith("https://");
}

/**
 * Extract a usable filename from a URL, stripping query params and fragments.
 * Returns undefined if the URL has no meaningful path basename.
 */
function fileNameFromUrl(source: string): string | undefined {
  try {
    const urlPath = new URL(source).pathname;
    const base = path.basename(urlPath);
    // Filter out empty or extension-less generic names like "download"
    if (base && base.includes(".")) {
      return base;
    }
  } catch {
    // Malformed URL — fall through
  }
  return undefined;
}

async function readImageFromFile(source: string) {
  const resolvedPath = path.resolve(source);

  let stats: Awaited<ReturnType<typeof stat>>;
  try {
    stats = await stat(resolvedPath);
  } catch (error) {
    return `error: Cannot read image file "${source}": ${getErrorMessage(error)}`;
  }

  if (stats.size > MAX_IMAGE_SIZE) {
    return `error: Image file "${source}" is too large (${formatFileSize(stats.size)}). Maximum: ${formatFileSize(MAX_IMAGE_SIZE)}.`;
  }

  let buffer: Buffer;
  try {
    buffer = await readFile(resolvedPath);
  } catch (error) {
    return `error: Cannot read image file "${source}": ${getErrorMessage(error)}`;
  }

  const fileName = path.basename(resolvedPath);

  try {
    return resultWithImage(`source=${source}\nsize=${formatFileSize(buffer.length)}`, buffer, {
      description: `Image: ${fileName}`,
      fileName,
    });
  } catch (error) {
    if (getErrorMessage(error).includes("MIME type")) {
      return `error: File "${source}" is not a supported image format. Supported formats: ${SUPPORTED_FORMATS}.`;
    }
    throw error;
  }
}

async function fetchImageFromUrl(source: string) {
  const response = await fetch(source, {
    signal: AbortSignal.timeout(URL_FETCH_TIMEOUT_MS),
    headers: { "User-Agent": USER_AGENT },
  });

  if (!response.ok) {
    return `error: Failed to fetch image: HTTP ${response.status} ${response.statusText}`;
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength && Number.parseInt(contentLength, 10) > MAX_IMAGE_SIZE) {
    return `error: Image at URL is too large (${formatFileSize(Number.parseInt(contentLength, 10))}). Maximum: ${formatFileSize(MAX_IMAGE_SIZE)}.`;
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.length > MAX_IMAGE_SIZE) {
    return `error: Downloaded image is too large (${formatFileSize(buffer.length)}). Maximum: ${formatFileSize(MAX_IMAGE_SIZE)}.`;
  }

  try {
    const result = resultWithImage(
      `source=${source}\nsize=${formatFileSize(buffer.length)}`,
      buffer,
      { description: `Image from ${source}` },
    );

    // Derive fileName: prefer URL path, fall back to MIME-based extension
    const detectedMime = result.media?.[0]?.mimeType;
    const fileName =
      fileNameFromUrl(source) ?? `image${(detectedMime && MIME_TO_EXT[detectedMime]) || ".bin"}`;
    if (result.media?.[0]) {
      result.media[0].fileName = fileName;
    }

    return result;
  } catch (error) {
    if (getErrorMessage(error).includes("MIME type")) {
      return `error: Content at "${source}" is not a supported image format. Supported formats: ${SUPPORTED_FORMATS}.`;
    }
    throw error;
  }
}

/**
 * ReadImage gadget - Reads an image from a local file or URL and returns it
 * as media output for LLM vision analysis.
 *
 * Unlike ReadFile, this gadget does NOT enforce CWD sandboxing since images
 * can legitimately come from anywhere on disk or the web.
 */
export const readImage = createGadget({
  name: "ReadImage",
  description:
    "Read an image from a local file path or HTTP/HTTPS URL and return it for visual analysis. Supports JPEG, PNG, GIF, and WebP formats.",
  schema: z.object({
    source: z.string().min(1).describe("Path to a local image file or an HTTP/HTTPS URL"),
  }),
  examples: [
    {
      params: { source: "./screenshot.png" },
      output: "source=./screenshot.png\nsize=1.2 MB",
      comment: "Read a local PNG image",
    },
    {
      params: { source: "https://example.com/photo.jpg" },
      output: "source=https://example.com/photo.jpg\nsize=245.3 KB",
      comment: "Fetch an image from a URL",
    },
    {
      params: { source: "/home/user/photos/cat.webp" },
      output: "source=/home/user/photos/cat.webp\nsize=89.4 KB",
      comment: "Read an image with absolute path (no CWD restriction)",
    },
  ],
  execute: async ({ source }) => {
    try {
      if (isUrl(source)) {
        return await fetchImageFromUrl(source);
      }
      return await readImageFromFile(source);
    } catch (error) {
      return `error: ${getErrorMessage(error)}`;
    }
  },
});
