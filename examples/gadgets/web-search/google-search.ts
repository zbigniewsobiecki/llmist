/**
 * Google Search gadget using Google Custom Search API.
 *
 * Returns web pages with titles, URLs, source metadata, and descriptions.
 *
 * Required environment variables:
 * - GOOGLE_SEARCH_API_KEY: Your Google API key
 * - GOOGLE_SEARCH_ENGINE_ID: Your Custom Search Engine ID
 *
 * Get these at: https://developers.google.com/custom-search/v1/introduction
 */
import { z } from "zod";
import { createGadget } from "../../../src/index.js";

const GOOGLE_SEARCH_API_URL = "https://www.googleapis.com/customsearch/v1";
const DEFAULT_TIMEOUT_MS = 10000;

interface PagemapMetatag {
  "og:title"?: string;
  "og:description"?: string;
  "og:site_name"?: string;
  "og:type"?: string;
  "article:published_time"?: string;
  "article:author"?: string;
  [key: string]: string | undefined;
}

interface SearchItem {
  title: string;
  link: string;
  snippet: string;
  displayLink?: string;
  mime?: string;
  fileFormat?: string;
  pagemap?: {
    metatags?: PagemapMetatag[];
  };
}

interface GoogleSearchResponse {
  items?: SearchItem[];
  searchInformation?: {
    totalResults: string;
    searchTime: number;
  };
  error?: {
    code: number;
    message: string;
  };
}

/**
 * Format ISO date string to readable format (e.g., "Mar 15, 2024")
 */
function formatDate(isoDate: string | undefined): string | undefined {
  if (!isoDate) return undefined;
  try {
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return undefined;
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return undefined;
  }
}

/**
 * Determine content type from og:type, mime, or fileFormat
 */
function getContentType(
  item: SearchItem,
  metatags: PagemapMetatag | undefined,
): string | undefined {
  const ogType = metatags?.["og:type"];
  if (ogType && ogType !== "website") {
    const normalized = ogType.toLowerCase();
    if (normalized.startsWith("article")) return "article";
    if (normalized.includes("video")) return "video";
    if (normalized.includes("product")) return "product";
    return normalized;
  }

  if (item.fileFormat) {
    return item.fileFormat.toLowerCase();
  }
  if (item.mime && item.mime !== "text/html") {
    const parts = item.mime.split("/");
    return parts[parts.length - 1];
  }

  return undefined;
}

/**
 * Return og:description if meaningfully longer than snippet, else snippet
 */
function getBestDescription(snippet: string, ogDescription: string | undefined): string {
  if (!ogDescription) return snippet;
  if (ogDescription.length > snippet.length * 1.2) {
    return ogDescription;
  }
  return snippet;
}

export const googleSearch = createGadget({
  name: "GoogleSearch",
  description: `Search the web using Google Custom Search API. Returns web pages with titles, URLs, source info, and descriptions.

**QUERY BEST PRACTICES:**
- Keep queries SHORT and FOCUSED (2-5 words work best)
- Use ONE quoted phrase at most, not multiple
- Avoid complex boolean operators (OR, AND) - they often cause "no results"
- If a query fails, SIMPLIFY it - remove quotes, reduce words

**SUPPORTED OPERATORS:**
- site:domain.com - Search within a specific site
- "exact phrase" - Match exact phrase (use sparingly)
- -word - Exclude results containing word
- filetype:pdf - Find specific file types
- intitle:word - Word must appear in page title`,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  schema: z.object({
    query: z
      .string()
      .min(1)
      .max(500)
      .describe("Search query. Keep it SHORT (2-5 words). Use at most ONE quoted phrase."),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .default(10)
      .describe("Maximum results to return (1-10, default 10)"),
  }),
  examples: [
    {
      params: { query: "TypeScript best practices", maxResults: 5 },
      comment: "Simple keyword search - most reliable approach",
    },
    {
      params: { query: "site:docs.stripe.com webhooks", maxResults: 5 },
      comment: "Search within a specific domain",
    },
    {
      params: { query: "API design guidelines filetype:pdf", maxResults: 3 },
      comment: "Find PDF documents on a topic",
    },
  ],
  execute: async ({ query, maxResults }) => {
    const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
    const searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;

    if (!apiKey || !searchEngineId) {
      throw new Error(
        "Google Search is not configured. Set GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_ENGINE_ID environment variables.",
      );
    }

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const url = new URL(GOOGLE_SEARCH_API_URL);
      url.searchParams.set("key", apiKey);
      url.searchParams.set("cx", searchEngineId);
      url.searchParams.set("q", query);
      url.searchParams.set("num", String(maxResults));

      const response = await fetch(url.toString(), { signal: abortController.signal });

      if (!response.ok) {
        throw new Error(`Search failed: HTTP ${response.status} ${response.statusText}`);
      }

      const data: GoogleSearchResponse = await response.json();

      if (data.error) {
        throw new Error(`Search failed: ${data.error.message} (code: ${data.error.code})`);
      }

      if (!data.items || data.items.length === 0) {
        return `No results found for: "${query}". Try simplifying the query or removing quotes.`;
      }

      const resultsText = data.items
        .map((item, index) => {
          const metatags = item.pagemap?.metatags?.[0];

          // Build source line components
          const siteName = metatags?.["og:site_name"] || item.displayLink;
          const contentType = getContentType(item, metatags);
          const pubDate = formatDate(metatags?.["article:published_time"]);

          const sourceComponents = [siteName, contentType, pubDate].filter(Boolean);
          const sourceLine =
            sourceComponents.length > 0 ? `\n   Source: ${sourceComponents.join(" | ")}` : "";

          const description = getBestDescription(item.snippet, metatags?.["og:description"]);

          return `${index + 1}. ${item.title}\n   URL: ${item.link}${sourceLine}\n   ${description}`;
        })
        .join("\n\n");

      const totalResults = data.searchInformation?.totalResults || "unknown";
      const searchTime = data.searchInformation?.searchTime || "unknown";

      return `Search results for "${query}" (${data.items.length} of ${totalResults} results, ${searchTime}s):\n\n${resultsText}`;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Search timed out after ${DEFAULT_TIMEOUT_MS / 1000} seconds`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  },
});
