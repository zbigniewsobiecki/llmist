import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { GadgetExecuteResultWithMedia } from "llmist";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readImage } from "./read-image.js";

// Minimal valid 1x1 PNG
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

// Minimal valid 1x1 JPEG
const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AKwA//9k=",
  "base64",
);

function mockFetchResponse(body: Buffer, status = 200, headers: Record<string, string> = {}) {
  const statusTexts: Record<number, string> = {
    200: "OK",
    404: "Not Found",
    500: "Internal Server Error",
  };
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: statusTexts[status] ?? "Error",
    headers: new Headers(headers),
    arrayBuffer: () =>
      Promise.resolve(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)),
  });
}

const tmpDir = mkdtempSync(path.join(os.tmpdir(), "read-image-test-"));

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// Metadata
// ============================================================================

describe("ReadImage gadget metadata", () => {
  it("has the correct name", () => {
    expect(readImage.name).toBe("ReadImage");
  });

  it("has a description", () => {
    expect(readImage.description).toBeTruthy();
    expect(readImage.description).toContain("image");
  });

  it("has examples", () => {
    expect(readImage.examples).toBeDefined();
    expect(readImage.examples!.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Local file — success
// ============================================================================

describe("ReadImage local file success", () => {
  it("reads a valid PNG file and returns media result", async () => {
    const filePath = path.join(tmpDir, "test-image.png");
    writeFileSync(filePath, TINY_PNG);

    const result = await readImage.execute({ source: filePath });

    expect(typeof result).not.toBe("string");
    const mediaResult = result as GadgetExecuteResultWithMedia;
    expect(mediaResult.result).toContain(`source=${filePath}`);
    expect(mediaResult.result).toContain("size=");
    expect(mediaResult.media).toBeDefined();
    expect(mediaResult.media).toHaveLength(1);
    expect(mediaResult.media![0].kind).toBe("image");
    expect(mediaResult.media![0].mimeType).toBe("image/png");
    expect(mediaResult.media![0].data).toBe(TINY_PNG.toString("base64"));
  });

  it("reads a valid JPEG file and returns media result", async () => {
    const filePath = path.join(tmpDir, "test-image.jpg");
    writeFileSync(filePath, TINY_JPEG);

    const result = await readImage.execute({ source: filePath });

    expect(typeof result).not.toBe("string");
    const mediaResult = result as GadgetExecuteResultWithMedia;
    expect(mediaResult.media).toHaveLength(1);
    expect(mediaResult.media![0].kind).toBe("image");
    expect(mediaResult.media![0].mimeType).toBe("image/jpeg");
  });

  it("includes the file name in the media description and fileName", async () => {
    const filePath = path.join(tmpDir, "screenshot.png");
    writeFileSync(filePath, TINY_PNG);

    const result = await readImage.execute({ source: filePath });

    const mediaResult = result as GadgetExecuteResultWithMedia;
    expect(mediaResult.media![0].description).toBe("Image: screenshot.png");
    expect(mediaResult.media![0].fileName).toBe("screenshot.png");
  });
});

// ============================================================================
// Local file — errors
// ============================================================================

describe("ReadImage local file errors", () => {
  it("returns error string when file is not found", async () => {
    const result = await readImage.execute({
      source: path.join(tmpDir, "nonexistent.png"),
    });

    expect(typeof result).toBe("string");
    expect(result as string).toMatch(/^error:/);
    expect(result as string).toContain("Cannot read image file");
  });

  it("returns error when file is not a supported image format", async () => {
    const filePath = path.join(tmpDir, "notes.txt");
    writeFileSync(filePath, "This is just text, not an image.");

    const result = await readImage.execute({ source: filePath });

    expect(typeof result).toBe("string");
    expect(result as string).toMatch(/^error:/);
    expect(result as string).toContain("not a supported image format");
  });

  it("returns error when file is too large", async () => {
    const filePath = path.join(tmpDir, "huge.png");
    // Create a sparse file that reports a large size without using disk space
    const { openSync, closeSync, ftruncateSync } = await import("node:fs");
    const fd = openSync(filePath, "w");
    ftruncateSync(fd, 60 * 1024 * 1024); // 60 MB sparse
    closeSync(fd);

    const result = await readImage.execute({ source: filePath });

    expect(typeof result).toBe("string");
    expect(result as string).toMatch(/^error:/);
    expect(result as string).toContain("too large");
  });

  it("returns error when file is not readable", async () => {
    const filePath = path.join(tmpDir, "noperm.png");
    writeFileSync(filePath, TINY_PNG);
    chmodSync(filePath, 0o000);

    try {
      const result = await readImage.execute({ source: filePath });

      expect(typeof result).toBe("string");
      expect(result as string).toMatch(/^error:/);
      expect(result as string).toContain("Cannot read image file");
    } finally {
      // Restore permissions so cleanup can delete the file
      chmodSync(filePath, 0o644);
    }
  });
});

// ============================================================================
// URL — success
// ============================================================================

describe("ReadImage URL success", () => {
  it("fetches a valid PNG from a URL and returns media result", async () => {
    vi.stubGlobal("fetch", mockFetchResponse(TINY_PNG));

    const result = await readImage.execute({
      source: "https://example.com/photo.png",
    });

    expect(typeof result).not.toBe("string");
    const mediaResult = result as GadgetExecuteResultWithMedia;
    expect(mediaResult.result).toContain("source=https://example.com/photo.png");
    expect(mediaResult.result).toContain("size=");
    expect(mediaResult.media).toHaveLength(1);
    expect(mediaResult.media![0].kind).toBe("image");
    expect(mediaResult.media![0].mimeType).toBe("image/png");
    expect(mediaResult.media![0].data).toBe(TINY_PNG.toString("base64"));
  });

  it("extracts file name from the URL path", async () => {
    vi.stubGlobal("fetch", mockFetchResponse(TINY_JPEG));

    const result = await readImage.execute({
      source: "https://cdn.example.com/images/cat.jpg",
    });

    const mediaResult = result as GadgetExecuteResultWithMedia;
    expect(mediaResult.media![0].fileName).toBe("cat.jpg");
  });

  it("strips query params and fragments from URL filename", async () => {
    vi.stubGlobal("fetch", mockFetchResponse(TINY_PNG));

    const result = await readImage.execute({
      source: "https://cdn.example.com/photo.png?w=200&h=200#section",
    });

    const mediaResult = result as GadgetExecuteResultWithMedia;
    expect(mediaResult.media![0].fileName).toBe("photo.png");
  });

  it("falls back to MIME-based filename when URL has no useful path", async () => {
    vi.stubGlobal("fetch", mockFetchResponse(TINY_PNG));

    const result = await readImage.execute({
      source: "https://example.com/",
    });

    const mediaResult = result as GadgetExecuteResultWithMedia;
    expect(mediaResult.media![0].fileName).toBe("image.png");
  });

  it("sends User-Agent header", async () => {
    const fetchMock = mockFetchResponse(TINY_PNG);
    vi.stubGlobal("fetch", fetchMock);

    await readImage.execute({ source: "https://example.com/photo.png" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/photo.png",
      expect.objectContaining({
        headers: expect.objectContaining({ "User-Agent": "llmist-cli" }),
      }),
    );
  });
});

// ============================================================================
// URL — errors
// ============================================================================

describe("ReadImage URL errors", () => {
  it("returns error on non-2xx response", async () => {
    vi.stubGlobal("fetch", mockFetchResponse(Buffer.alloc(0), 404));

    const result = await readImage.execute({
      source: "https://example.com/missing.png",
    });

    expect(typeof result).toBe("string");
    expect(result as string).toMatch(/^error:/);
    expect(result as string).toContain("HTTP 404");
  });

  it("returns error when Content-Length exceeds limit", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchResponse(TINY_PNG, 200, {
        "content-length": String(60 * 1024 * 1024),
      }),
    );

    const result = await readImage.execute({
      source: "https://example.com/huge.png",
    });

    expect(typeof result).toBe("string");
    expect(result as string).toMatch(/^error:/);
    expect(result as string).toContain("too large");
  });

  it("returns error when fetched content is not an image", async () => {
    const textBuffer = Buffer.from("This is plain text, not an image.");
    vi.stubGlobal("fetch", mockFetchResponse(textBuffer));

    const result = await readImage.execute({
      source: "https://example.com/data.txt",
    });

    expect(typeof result).toBe("string");
    expect(result as string).toMatch(/^error:/);
    expect(result as string).toContain("not a supported image format");
  });

  it("returns error on network/timeout failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network timeout")));

    const result = await readImage.execute({
      source: "https://example.com/slow.png",
    });

    expect(typeof result).toBe("string");
    expect(result as string).toMatch(/^error:/);
    expect(result as string).toContain("network timeout");
  });
});

// ============================================================================
// URL detection routing
// ============================================================================

describe("ReadImage URL detection", () => {
  it("routes http:// to URL fetch", async () => {
    const fetchMock = mockFetchResponse(TINY_PNG);
    vi.stubGlobal("fetch", fetchMock);

    await readImage.execute({ source: "http://example.com/image.png" });

    expect(fetchMock).toHaveBeenCalled();
  });

  it("routes https:// to URL fetch", async () => {
    const fetchMock = mockFetchResponse(TINY_PNG);
    vi.stubGlobal("fetch", fetchMock);

    await readImage.execute({ source: "https://example.com/image.png" });

    expect(fetchMock).toHaveBeenCalled();
  });

  it("routes absolute path to local file read", async () => {
    const filePath = path.join(tmpDir, "absolute.png");
    writeFileSync(filePath, TINY_PNG);

    const result = await readImage.execute({ source: filePath });

    expect(typeof result).not.toBe("string");
    const mediaResult = result as GadgetExecuteResultWithMedia;
    expect(mediaResult.media).toHaveLength(1);
  });

  it("does not treat non-http(s) schemes as URLs", async () => {
    // ftp:// should be treated as a local path (will fail to read, but not fetch)
    const result = await readImage.execute({ source: "ftp://example.com/image.png" });

    expect(typeof result).toBe("string");
    expect(result as string).toMatch(/^error:/);
    // Should be a file-read error, not an HTTP error
    expect(result as string).toContain("Cannot read image file");
  });
});
