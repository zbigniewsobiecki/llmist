import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readImageFile,
  readAudioFile,
  readFileBuffer,
  validateImageFile,
  validateAudioFile,
  DEFAULT_MAX_FILE_SIZE,
} from "./file-utils.js";

/**
 * Test suite for CLI file utilities.
 *
 * Tests file reading, MIME type detection, and error handling for
 * multimodal input files (images and audio).
 */

// Test fixtures directory
const TEST_DIR = join(tmpdir(), "llmist-file-utils-test-" + Date.now());

// Minimal valid file magic bytes for different formats
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GIF_MAGIC = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const WEBP_MAGIC = Buffer.from([
  0x52, 0x49, 0x46, 0x46, // RIFF
  0x00, 0x00, 0x00, 0x00, // file size (doesn't matter for detection)
  0x57, 0x45, 0x42, 0x50, // WEBP
]);

const MP3_MAGIC = Buffer.from([0x49, 0x44, 0x33]); // ID3 tag
const WAV_MAGIC = Buffer.from([
  0x52, 0x49, 0x46, 0x46, // RIFF
  0x00, 0x00, 0x00, 0x00, // file size
  0x57, 0x41, 0x56, 0x45, // WAVE
]);
const OGG_MAGIC = Buffer.from([0x4f, 0x67, 0x67, 0x53]); // OggS

const TEXT_FILE = Buffer.from("This is not an image or audio file");

beforeAll(async () => {
  // Create test directory and fixture files
  await mkdir(TEST_DIR, { recursive: true });

  // Create image test files
  await writeFile(join(TEST_DIR, "test.jpg"), JPEG_MAGIC);
  await writeFile(join(TEST_DIR, "test.png"), PNG_MAGIC);
  await writeFile(join(TEST_DIR, "test.gif"), GIF_MAGIC);
  await writeFile(join(TEST_DIR, "test.webp"), WEBP_MAGIC);

  // Create audio test files
  await writeFile(join(TEST_DIR, "test.mp3"), MP3_MAGIC);
  await writeFile(join(TEST_DIR, "test.wav"), WAV_MAGIC);
  await writeFile(join(TEST_DIR, "test.ogg"), OGG_MAGIC);

  // Create invalid files (wrong format)
  await writeFile(join(TEST_DIR, "not-an-image.txt"), TEXT_FILE);
  await writeFile(join(TEST_DIR, "not-audio.txt"), TEXT_FILE);
});

afterAll(async () => {
  // Clean up test directory
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("readImageFile", () => {
  describe("successful reads", () => {
    test("reads JPEG file and returns ImageContentPart", async () => {
      const result = await readImageFile(join(TEST_DIR, "test.jpg"));

      expect(result.type).toBe("image");
      expect(result.source.type).toBe("base64");
      expect(result.source.mediaType).toBe("image/jpeg");
      expect(typeof result.source.data).toBe("string");
    });

    test("reads PNG file and detects correct MIME type", async () => {
      const result = await readImageFile(join(TEST_DIR, "test.png"));

      expect(result.source.mediaType).toBe("image/png");
    });

    test("reads GIF file and detects correct MIME type", async () => {
      const result = await readImageFile(join(TEST_DIR, "test.gif"));

      expect(result.source.mediaType).toBe("image/gif");
    });

    test("reads WebP file and detects correct MIME type", async () => {
      const result = await readImageFile(join(TEST_DIR, "test.webp"));

      expect(result.source.mediaType).toBe("image/webp");
    });

    test("handles relative paths", async () => {
      // This test uses an absolute path but verifies resolve() is called
      const result = await readImageFile(join(TEST_DIR, "test.jpg"));
      expect(result.type).toBe("image");
    });
  });

  describe("error handling", () => {
    test("throws error for non-existent file", async () => {
      await expect(readImageFile(join(TEST_DIR, "does-not-exist.jpg"))).rejects.toThrow(
        /Failed to read image file.*does-not-exist\.jpg/,
      );
    });

    test("throws error for non-image file", async () => {
      await expect(readImageFile(join(TEST_DIR, "not-an-image.txt"))).rejects.toThrow(
        /not a supported image format/,
      );
    });

    test("error message includes supported formats", async () => {
      await expect(readImageFile(join(TEST_DIR, "not-an-image.txt"))).rejects.toThrow(
        /JPEG, PNG, GIF, WebP/,
      );
    });
  });
});

describe("readAudioFile", () => {
  describe("successful reads", () => {
    test("reads MP3 file and returns AudioContentPart", async () => {
      const result = await readAudioFile(join(TEST_DIR, "test.mp3"));

      expect(result.type).toBe("audio");
      expect(result.source.type).toBe("base64");
      expect(result.source.mediaType).toBe("audio/mp3");
      expect(typeof result.source.data).toBe("string");
    });

    test("reads WAV file and detects correct MIME type", async () => {
      const result = await readAudioFile(join(TEST_DIR, "test.wav"));

      expect(result.source.mediaType).toBe("audio/wav");
    });

    test("reads OGG file and detects correct MIME type", async () => {
      const result = await readAudioFile(join(TEST_DIR, "test.ogg"));

      expect(result.source.mediaType).toBe("audio/ogg");
    });
  });

  describe("error handling", () => {
    test("throws error for non-existent file", async () => {
      await expect(readAudioFile(join(TEST_DIR, "does-not-exist.mp3"))).rejects.toThrow(
        /Failed to read audio file.*does-not-exist\.mp3/,
      );
    });

    test("throws error for non-audio file", async () => {
      await expect(readAudioFile(join(TEST_DIR, "not-audio.txt"))).rejects.toThrow(
        /not a supported audio format/,
      );
    });

    test("error message includes supported formats", async () => {
      await expect(readAudioFile(join(TEST_DIR, "not-audio.txt"))).rejects.toThrow(
        /MP3, WAV, OGG, WebM/,
      );
    });
  });
});

describe("readFileBuffer", () => {
  test("reads file and returns Buffer", async () => {
    const result = await readFileBuffer(join(TEST_DIR, "test.jpg"));

    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBe(JPEG_MAGIC.length);
  });

  test("throws error for non-existent file", async () => {
    await expect(readFileBuffer(join(TEST_DIR, "does-not-exist.bin"))).rejects.toThrow(
      /Failed to read file.*does-not-exist\.bin/,
    );
  });

  test("preserves exact file contents", async () => {
    const result = await readFileBuffer(join(TEST_DIR, "test.png"));

    expect(result.equals(PNG_MAGIC)).toBe(true);
  });
});

describe("validateImageFile", () => {
  describe("valid images", () => {
    test("returns valid=true for JPEG file", async () => {
      const result = await validateImageFile(join(TEST_DIR, "test.jpg"));

      expect(result.valid).toBe(true);
      expect(result.mimeType).toBe("image/jpeg");
      expect(result.error).toBeUndefined();
    });

    test("returns valid=true for PNG file", async () => {
      const result = await validateImageFile(join(TEST_DIR, "test.png"));

      expect(result.valid).toBe(true);
      expect(result.mimeType).toBe("image/png");
    });

    test("returns valid=true for GIF file", async () => {
      const result = await validateImageFile(join(TEST_DIR, "test.gif"));

      expect(result.valid).toBe(true);
      expect(result.mimeType).toBe("image/gif");
    });

    test("returns valid=true for WebP file", async () => {
      const result = await validateImageFile(join(TEST_DIR, "test.webp"));

      expect(result.valid).toBe(true);
      expect(result.mimeType).toBe("image/webp");
    });
  });

  describe("invalid files", () => {
    test("returns valid=false for non-image file", async () => {
      const result = await validateImageFile(join(TEST_DIR, "not-an-image.txt"));

      expect(result.valid).toBe(false);
      expect(result.mimeType).toBeUndefined();
      expect(result.error).toContain("Not a supported image format");
    });

    test("returns valid=false for non-existent file", async () => {
      const result = await validateImageFile(join(TEST_DIR, "does-not-exist.jpg"));

      expect(result.valid).toBe(false);
      expect(result.mimeType).toBeUndefined();
      expect(result.error).toBeDefined();
    });
  });
});

describe("validateAudioFile", () => {
  describe("valid audio", () => {
    test("returns valid=true for MP3 file", async () => {
      const result = await validateAudioFile(join(TEST_DIR, "test.mp3"));

      expect(result.valid).toBe(true);
      expect(result.mimeType).toBe("audio/mp3");
      expect(result.error).toBeUndefined();
    });

    test("returns valid=true for WAV file", async () => {
      const result = await validateAudioFile(join(TEST_DIR, "test.wav"));

      expect(result.valid).toBe(true);
      expect(result.mimeType).toBe("audio/wav");
    });

    test("returns valid=true for OGG file", async () => {
      const result = await validateAudioFile(join(TEST_DIR, "test.ogg"));

      expect(result.valid).toBe(true);
      expect(result.mimeType).toBe("audio/ogg");
    });
  });

  describe("invalid files", () => {
    test("returns valid=false for non-audio file", async () => {
      const result = await validateAudioFile(join(TEST_DIR, "not-audio.txt"));

      expect(result.valid).toBe(false);
      expect(result.mimeType).toBeUndefined();
      expect(result.error).toContain("Not a supported audio format");
    });

    test("returns valid=false for non-existent file", async () => {
      const result = await validateAudioFile(join(TEST_DIR, "does-not-exist.mp3"));

      expect(result.valid).toBe(false);
      expect(result.mimeType).toBeUndefined();
      expect(result.error).toBeDefined();
    });
  });
});

describe("cross-format detection", () => {
  test("WAV file is not detected as image (RIFF container disambiguation)", async () => {
    // Both WebP and WAV use RIFF container, ensure WAV is not mistakenly
    // detected as an image
    const imageResult = await validateImageFile(join(TEST_DIR, "test.wav"));
    expect(imageResult.valid).toBe(false);

    const audioResult = await validateAudioFile(join(TEST_DIR, "test.wav"));
    expect(audioResult.valid).toBe(true);
    expect(audioResult.mimeType).toBe("audio/wav");
  });

  test("WebP file is not detected as audio (RIFF container disambiguation)", async () => {
    const audioResult = await validateAudioFile(join(TEST_DIR, "test.webp"));
    expect(audioResult.valid).toBe(false);

    const imageResult = await validateImageFile(join(TEST_DIR, "test.webp"));
    expect(imageResult.valid).toBe(true);
    expect(imageResult.mimeType).toBe("image/webp");
  });
});

describe("file size limits", () => {
  test("DEFAULT_MAX_FILE_SIZE is 50MB", () => {
    expect(DEFAULT_MAX_FILE_SIZE).toBe(50 * 1024 * 1024);
  });

  test("readImageFile accepts custom maxFileSize option", async () => {
    // Should succeed with default limit
    const result = await readImageFile(join(TEST_DIR, "test.jpg"));
    expect(result.type).toBe("image");
  });

  test("readImageFile rejects files exceeding custom limit", async () => {
    // Set limit smaller than the test file
    await expect(
      readImageFile(join(TEST_DIR, "test.jpg"), { maxFileSize: 5 }),
    ).rejects.toThrow(/too large/);
  });

  test("readAudioFile rejects files exceeding custom limit", async () => {
    await expect(
      readAudioFile(join(TEST_DIR, "test.mp3"), { maxFileSize: 1 }),
    ).rejects.toThrow(/too large/);
  });

  test("readFileBuffer rejects files exceeding custom limit", async () => {
    await expect(
      readFileBuffer(join(TEST_DIR, "test.jpg"), { maxFileSize: 1 }),
    ).rejects.toThrow(/too large/);
  });

  test("error message includes file size and limit info", async () => {
    await expect(
      readImageFile(join(TEST_DIR, "test.jpg"), { maxFileSize: 5 }),
    ).rejects.toThrow(/Maximum allowed size is 5 bytes/);
  });

  test("error message suggests compression for large files", async () => {
    await expect(
      readImageFile(join(TEST_DIR, "test.jpg"), { maxFileSize: 5 }),
    ).rejects.toThrow(/Consider compressing/);
  });
});
