/**
 * Tests for gadget media helper functions.
 */

import { describe, expect, it } from "vitest";
import {
  createMediaOutput,
  resultWithAudio,
  resultWithFile,
  resultWithImage,
  resultWithImages,
  resultWithMedia,
} from "./helpers.js";

// Small PNG image (1x1 transparent pixel)
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

// Small JPEG image (1x1 red pixel)
const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAB//2Q==",
  "base64",
);

// MP3 magic bytes (ID3 header)
const TINY_MP3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

// WAV magic bytes (RIFF....WAVE)
const TINY_WAV = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
]);

// FLAC magic bytes (fLaC)
const TINY_FLAC = Buffer.from([0x66, 0x4c, 0x61, 0x43, 0x00, 0x00, 0x00, 0x22]);

describe("createMedia", () => {
  it("creates GadgetMediaOutput from Buffer", () => {
    const media = createMediaOutput("image", TINY_PNG, "image/png");

    expect(media.kind).toBe("image");
    expect(media.mimeType).toBe("image/png");
    expect(media.data).toBe(TINY_PNG.toString("base64"));
  });

  it("creates GadgetMediaOutput from Uint8Array", () => {
    const uint8 = new Uint8Array(TINY_PNG);
    const media = createMediaOutput("image", uint8, "image/png");

    expect(media.kind).toBe("image");
    expect(media.data).toBe(TINY_PNG.toString("base64"));
  });

  it("includes optional description", () => {
    const media = createMediaOutput("image", TINY_PNG, "image/png", {
      description: "Test image",
    });

    expect(media.description).toBe("Test image");
  });

  it("includes optional metadata", () => {
    const media = createMediaOutput("image", TINY_PNG, "image/png", {
      metadata: { width: 100, height: 200 },
    });

    expect(media.metadata).toEqual({ width: 100, height: 200 });
  });

  it("includes optional fileName", () => {
    const media = createMediaOutput("image", TINY_PNG, "image/png", {
      fileName: "custom.png",
    });

    expect(media.fileName).toBe("custom.png");
  });
});

describe("resultWithMedia", () => {
  it("creates result with media array", () => {
    const media = [createMediaOutput("image", TINY_PNG, "image/png")];
    const result = resultWithMedia("Test result", media);

    expect(result.result).toBe("Test result");
    expect(result.media).toHaveLength(1);
    expect(result.media![0].kind).toBe("image");
  });

  it("includes optional cost", () => {
    const media = [createMediaOutput("image", TINY_PNG, "image/png")];
    const result = resultWithMedia("Test result", media, 0.001);

    expect(result.cost).toBe(0.001);
  });

  it("throws on empty media array", () => {
    expect(() => resultWithMedia("Test result", [])).toThrow(
      "resultWithMedia: media array cannot be empty",
    );
  });
});

describe("resultWithImage", () => {
  it("creates result with single image from PNG", () => {
    const result = resultWithImage("Test result", TINY_PNG);

    expect(result.result).toBe("Test result");
    expect(result.media).toHaveLength(1);
    expect(result.media![0].kind).toBe("image");
    expect(result.media![0].mimeType).toBe("image/png");
  });

  it("creates result with single image from JPEG", () => {
    const result = resultWithImage("Test result", TINY_JPEG);

    expect(result.media![0].mimeType).toBe("image/jpeg");
  });

  it("uses provided mimeType instead of auto-detection", () => {
    const result = resultWithImage("Test result", TINY_PNG, {
      mimeType: "image/webp",
    });

    expect(result.media![0].mimeType).toBe("image/webp");
  });

  it("includes description when provided", () => {
    const result = resultWithImage("Test result", TINY_PNG, {
      description: "Screenshot",
    });

    expect(result.media![0].description).toBe("Screenshot");
  });

  it("includes metadata when provided", () => {
    const result = resultWithImage("Test result", TINY_PNG, {
      metadata: { width: 1920, height: 1080 },
    });

    expect(result.media![0].metadata).toEqual({ width: 1920, height: 1080 });
  });

  it("includes cost when provided", () => {
    const result = resultWithImage("Test result", TINY_PNG, {
      cost: 0.005,
    });

    expect(result.cost).toBe(0.005);
  });

  it("includes fileName when provided", () => {
    const result = resultWithImage("Test result", TINY_PNG, {
      fileName: "screenshot.png",
    });

    expect(result.media![0].fileName).toBe("screenshot.png");
  });

  it("throws when MIME type cannot be detected and not provided", () => {
    const randomData = Buffer.from([0x00, 0x01, 0x02, 0x03]);

    expect(() => resultWithImage("Test result", randomData)).toThrow(
      /Could not detect image MIME type/,
    );
  });

  it("works with Uint8Array input", () => {
    const uint8 = new Uint8Array(TINY_PNG);
    const result = resultWithImage("Test result", uint8);

    expect(result.media![0].mimeType).toBe("image/png");
  });
});

describe("resultWithImages", () => {
  it("creates result with multiple images", () => {
    const result = resultWithImages("Multiple images", [
      { data: TINY_PNG, description: "Image 1" },
      { data: TINY_JPEG, description: "Image 2" },
    ]);

    expect(result.result).toBe("Multiple images");
    expect(result.media).toHaveLength(2);
    expect(result.media![0].mimeType).toBe("image/png");
    expect(result.media![1].mimeType).toBe("image/jpeg");
  });

  it("throws on empty images array", () => {
    expect(() => resultWithImages("Test result", [])).toThrow(
      "resultWithImages: images array cannot be empty",
    );
  });

  it("includes cost when provided", () => {
    const result = resultWithImages(
      "Multiple images",
      [{ data: TINY_PNG }, { data: TINY_JPEG }],
      0.01,
    );

    expect(result.cost).toBe(0.01);
  });

  it("preserves fileName for each image", () => {
    const result = resultWithImages("Multiple images", [
      { data: TINY_PNG, fileName: "before.png" },
      { data: TINY_JPEG, fileName: "after.jpg" },
    ]);

    expect(result.media![0].fileName).toBe("before.png");
    expect(result.media![1].fileName).toBe("after.jpg");
  });

  it("throws when MIME type cannot be detected for any image", () => {
    const randomData = Buffer.from([0x00, 0x01, 0x02, 0x03]);

    expect(() =>
      resultWithImages("Test result", [{ data: TINY_PNG }, { data: randomData }]),
    ).toThrow(/Could not detect MIME type for image at index 1/);
  });
});

describe("resultWithAudio", () => {
  it("creates result with single audio from MP3", () => {
    const result = resultWithAudio("Audio generated", TINY_MP3);

    expect(result.result).toBe("Audio generated");
    expect(result.media).toHaveLength(1);
    expect(result.media![0].kind).toBe("audio");
    expect(result.media![0].mimeType).toBe("audio/mp3");
  });

  it("creates result with single audio from WAV", () => {
    const result = resultWithAudio("Audio generated", TINY_WAV);

    expect(result.media![0].mimeType).toBe("audio/wav");
  });

  it("uses provided mimeType instead of auto-detection", () => {
    const result = resultWithAudio("Audio generated", TINY_MP3, {
      mimeType: "audio/mpeg",
    });

    expect(result.media![0].mimeType).toBe("audio/mpeg");
  });

  it("includes duration in metadata when provided", () => {
    const result = resultWithAudio("Audio generated", TINY_MP3, {
      durationMs: 5000,
    });

    expect(result.media![0].metadata).toEqual({ durationMs: 5000 });
  });

  it("includes description when provided", () => {
    const result = resultWithAudio("Audio generated", TINY_MP3, {
      description: "Speech synthesis",
    });

    expect(result.media![0].description).toBe("Speech synthesis");
  });

  it("includes fileName when provided", () => {
    const result = resultWithAudio("Audio generated", TINY_MP3, {
      fileName: "speech.mp3",
    });

    expect(result.media![0].fileName).toBe("speech.mp3");
  });

  it("throws when MIME type cannot be detected and not provided", () => {
    const randomData = Buffer.from([0x00, 0x01, 0x02, 0x03]);

    expect(() => resultWithAudio("Audio generated", randomData)).toThrow(
      /Could not detect audio MIME type/,
    );
  });
});

describe("resultWithFile", () => {
  it("creates result with generic file", () => {
    const pdfData = Buffer.from("%PDF-1.4 test content");
    const result = resultWithFile("PDF generated", pdfData, "application/pdf");

    expect(result.result).toBe("PDF generated");
    expect(result.media).toHaveLength(1);
    expect(result.media![0].kind).toBe("file");
    expect(result.media![0].mimeType).toBe("application/pdf");
  });

  it("includes description when provided", () => {
    const data = Buffer.from("test");
    const result = resultWithFile("File created", data, "text/plain", {
      description: "Config file",
    });

    expect(result.media![0].description).toBe("Config file");
  });

  it("includes cost when provided", () => {
    const data = Buffer.from("test");
    const result = resultWithFile("File created", data, "text/plain", {
      cost: 0.001,
    });

    expect(result.cost).toBe(0.001);
  });

  it("includes fileName when provided", () => {
    const data = Buffer.from("test");
    const result = resultWithFile("File created", data, "text/plain", {
      fileName: "config.txt",
    });

    expect(result.media![0].fileName).toBe("config.txt");
  });
});

describe("FLAC detection", () => {
  it("detects FLAC audio format", () => {
    const result = resultWithAudio("Audio generated", TINY_FLAC);

    expect(result.media![0].mimeType).toBe("audio/flac");
  });
});
