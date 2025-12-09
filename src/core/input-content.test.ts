import { describe, expect, it } from "bun:test";
import {
  audioFromBase64,
  audioFromBuffer,
  detectAudioMimeType,
  detectImageMimeType,
  imageFromBase64,
  imageFromBuffer,
  imageFromUrl,
  isAudioPart,
  isBase64ImageSource,
  isDataUrl,
  isImagePart,
  isTextPart,
  isUrlImageSource,
  parseDataUrl,
  text,
  toBase64,
  type AudioContentPart,
  type ContentPart,
  type ImageContentPart,
  type TextContentPart,
} from "./input-content.js";

describe("input-content", () => {
  describe("Type Guards", () => {
    describe("isTextPart", () => {
      it("returns true for text parts", () => {
        const part: ContentPart = { type: "text", text: "Hello" };
        expect(isTextPart(part)).toBe(true);
      });

      it("returns false for image parts", () => {
        const part: ContentPart = {
          type: "image",
          source: { type: "base64", mediaType: "image/jpeg", data: "abc" },
        };
        expect(isTextPart(part)).toBe(false);
      });

      it("returns false for audio parts", () => {
        const part: ContentPart = {
          type: "audio",
          source: { type: "base64", mediaType: "audio/mp3", data: "abc" },
        };
        expect(isTextPart(part)).toBe(false);
      });
    });

    describe("isImagePart", () => {
      it("returns true for image parts", () => {
        const part: ContentPart = {
          type: "image",
          source: { type: "base64", mediaType: "image/png", data: "abc" },
        };
        expect(isImagePart(part)).toBe(true);
      });

      it("returns false for text parts", () => {
        const part: ContentPart = { type: "text", text: "Hello" };
        expect(isImagePart(part)).toBe(false);
      });
    });

    describe("isAudioPart", () => {
      it("returns true for audio parts", () => {
        const part: ContentPart = {
          type: "audio",
          source: { type: "base64", mediaType: "audio/wav", data: "abc" },
        };
        expect(isAudioPart(part)).toBe(true);
      });

      it("returns false for text parts", () => {
        const part: ContentPart = { type: "text", text: "Hello" };
        expect(isAudioPart(part)).toBe(false);
      });
    });

    describe("isBase64ImageSource / isUrlImageSource", () => {
      it("distinguishes base64 from URL sources", () => {
        const base64Source = { type: "base64" as const, mediaType: "image/jpeg" as const, data: "abc" };
        const urlSource = { type: "url" as const, url: "https://example.com/image.jpg" };

        expect(isBase64ImageSource(base64Source)).toBe(true);
        expect(isUrlImageSource(base64Source)).toBe(false);
        expect(isBase64ImageSource(urlSource)).toBe(false);
        expect(isUrlImageSource(urlSource)).toBe(true);
      });
    });
  });

  describe("Content Part Creation", () => {
    describe("text()", () => {
      it("creates a text content part", () => {
        const part = text("Hello, world!");
        expect(part).toEqual({
          type: "text",
          text: "Hello, world!",
        });
      });

      it("handles empty strings", () => {
        const part = text("");
        expect(part.text).toBe("");
      });

      it("preserves special characters", () => {
        const content = "Hello\nWorld\t!@#$%^&*()";
        const part = text(content);
        expect(part.text).toBe(content);
      });
    });

    describe("imageFromBase64()", () => {
      it("creates an image part from base64 data", () => {
        const part = imageFromBase64("SGVsbG8gV29ybGQ=", "image/jpeg");
        expect(part).toEqual({
          type: "image",
          source: {
            type: "base64",
            mediaType: "image/jpeg",
            data: "SGVsbG8gV29ybGQ=",
          },
        });
      });

      it("supports all image MIME types", () => {
        const mimeTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
        for (const mimeType of mimeTypes) {
          const part = imageFromBase64("abc", mimeType);
          expect(part.source.type).toBe("base64");
          if (part.source.type === "base64") {
            expect(part.source.mediaType).toBe(mimeType);
          }
        }
      });
    });

    describe("imageFromUrl()", () => {
      it("creates an image part from URL", () => {
        const url = "https://example.com/image.jpg";
        const part = imageFromUrl(url);
        expect(part).toEqual({
          type: "image",
          source: {
            type: "url",
            url,
          },
        });
      });
    });

    describe("imageFromBuffer()", () => {
      it("creates an image part from JPEG buffer", () => {
        // JPEG magic bytes: FF D8 FF
        const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
        const part = imageFromBuffer(jpegBuffer);

        expect(part.type).toBe("image");
        expect(part.source.type).toBe("base64");
        if (part.source.type === "base64") {
          expect(part.source.mediaType).toBe("image/jpeg");
        }
      });

      it("creates an image part from PNG buffer", () => {
        // PNG magic bytes: 89 50 4E 47
        const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
        const part = imageFromBuffer(pngBuffer);

        expect(part.source.type).toBe("base64");
        if (part.source.type === "base64") {
          expect(part.source.mediaType).toBe("image/png");
        }
      });

      it("creates an image part from GIF buffer", () => {
        // GIF magic bytes: 47 49 46 38
        const gifBuffer = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
        const part = imageFromBuffer(gifBuffer);

        expect(part.source.type).toBe("base64");
        if (part.source.type === "base64") {
          expect(part.source.mediaType).toBe("image/gif");
        }
      });

      it("creates an image part from WebP buffer", () => {
        // WebP: RIFF....WEBP (bytes 0-3: RIFF, bytes 8-11: WEBP)
        const webpBuffer = Buffer.from([
          0x52, 0x49, 0x46, 0x46, // RIFF
          0x00, 0x00, 0x00, 0x00, // file size (placeholder)
          0x57, 0x45, 0x42, 0x50, // WEBP
        ]);
        const part = imageFromBuffer(webpBuffer);

        expect(part.source.type).toBe("base64");
        if (part.source.type === "base64") {
          expect(part.source.mediaType).toBe("image/webp");
        }
      });

      it("uses explicit mediaType when provided", () => {
        const buffer = Buffer.from([0x00, 0x00, 0x00]); // Unknown format
        const part = imageFromBuffer(buffer, "image/jpeg");

        expect(part.source.type).toBe("base64");
        if (part.source.type === "base64") {
          expect(part.source.mediaType).toBe("image/jpeg");
        }
      });

      it("throws when MIME type cannot be detected", () => {
        const unknownBuffer = Buffer.from([0x00, 0x00, 0x00, 0x00]);
        expect(() => imageFromBuffer(unknownBuffer)).toThrow(
          "Could not detect image MIME type",
        );
      });

      it("works with Uint8Array", () => {
        const jpegArray = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
        const part = imageFromBuffer(jpegArray);

        expect(part.source.type).toBe("base64");
        if (part.source.type === "base64") {
          expect(part.source.mediaType).toBe("image/jpeg");
        }
      });
    });

    describe("audioFromBase64()", () => {
      it("creates an audio part from base64 data", () => {
        const part = audioFromBase64("YXVkaW8gZGF0YQ==", "audio/mp3");
        expect(part).toEqual({
          type: "audio",
          source: {
            type: "base64",
            mediaType: "audio/mp3",
            data: "YXVkaW8gZGF0YQ==",
          },
        });
      });

      it("supports all audio MIME types", () => {
        const mimeTypes = ["audio/mp3", "audio/mpeg", "audio/wav", "audio/webm", "audio/ogg"] as const;
        for (const mimeType of mimeTypes) {
          const part = audioFromBase64("abc", mimeType);
          expect(part.source.mediaType).toBe(mimeType);
        }
      });
    });

    describe("audioFromBuffer()", () => {
      it("creates an audio part from MP3 buffer (frame sync)", () => {
        // MP3 frame sync: FF FB
        const mp3Buffer = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
        const part = audioFromBuffer(mp3Buffer);

        expect(part.source.mediaType).toBe("audio/mp3");
      });

      it("creates an audio part from MP3 buffer (ID3 tag)", () => {
        // ID3 tag: 49 44 33
        const mp3Buffer = Buffer.from([0x49, 0x44, 0x33, 0x04]);
        const part = audioFromBuffer(mp3Buffer);

        expect(part.source.mediaType).toBe("audio/mp3");
      });

      it("creates an audio part from OGG buffer", () => {
        // OGG: 4F 67 67 53
        const oggBuffer = Buffer.from([0x4f, 0x67, 0x67, 0x53]);
        const part = audioFromBuffer(oggBuffer);

        expect(part.source.mediaType).toBe("audio/ogg");
      });

      it("creates an audio part from WAV buffer", () => {
        // WAV: RIFF....WAVE
        const wavBuffer = Buffer.from([
          0x52, 0x49, 0x46, 0x46, // RIFF
          0x00, 0x00, 0x00, 0x00, // file size
          0x57, 0x41, 0x56, 0x45, // WAVE
        ]);
        const part = audioFromBuffer(wavBuffer);

        expect(part.source.mediaType).toBe("audio/wav");
      });

      it("creates an audio part from WebM buffer", () => {
        // WebM/Matroska: 1A 45 DF A3
        const webmBuffer = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
        const part = audioFromBuffer(webmBuffer);

        expect(part.source.mediaType).toBe("audio/webm");
      });

      it("uses explicit mediaType when provided", () => {
        const buffer = Buffer.from([0x00, 0x00, 0x00]);
        const part = audioFromBuffer(buffer, "audio/wav");

        expect(part.source.mediaType).toBe("audio/wav");
      });

      it("throws when MIME type cannot be detected", () => {
        const unknownBuffer = Buffer.from([0x00, 0x00, 0x00, 0x00]);
        expect(() => audioFromBuffer(unknownBuffer)).toThrow(
          "Could not detect audio MIME type",
        );
      });
    });
  });

  describe("MIME Type Detection", () => {
    describe("detectImageMimeType()", () => {
      it("detects JPEG", () => {
        const jpeg = Buffer.from([0xff, 0xd8, 0xff]);
        expect(detectImageMimeType(jpeg)).toBe("image/jpeg");
      });

      it("detects PNG", () => {
        const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
        expect(detectImageMimeType(png)).toBe("image/png");
      });

      it("detects GIF", () => {
        const gif = Buffer.from([0x47, 0x49, 0x46, 0x38]);
        expect(detectImageMimeType(gif)).toBe("image/gif");
      });

      it("detects WebP", () => {
        const webp = Buffer.from([
          0x52, 0x49, 0x46, 0x46,
          0x00, 0x00, 0x00, 0x00,
          0x57, 0x45, 0x42, 0x50,
        ]);
        expect(detectImageMimeType(webp)).toBe("image/webp");
      });

      it("returns null for unknown format", () => {
        const unknown = Buffer.from([0x00, 0x00, 0x00, 0x00]);
        expect(detectImageMimeType(unknown)).toBeNull();
      });

      it("returns null for empty buffer", () => {
        const empty = Buffer.from([]);
        expect(detectImageMimeType(empty)).toBeNull();
      });

      it("does not detect RIFF as WebP if WEBP marker is missing", () => {
        // RIFF without WEBP marker (could be WAV or other RIFF format)
        const riff = Buffer.from([
          0x52, 0x49, 0x46, 0x46,
          0x00, 0x00, 0x00, 0x00,
          0x41, 0x56, 0x49, 0x20, // "AVI " instead of "WEBP"
        ]);
        expect(detectImageMimeType(riff)).toBeNull();
      });
    });

    describe("detectAudioMimeType()", () => {
      it("detects MP3 (frame sync FF FB)", () => {
        const mp3 = Buffer.from([0xff, 0xfb, 0x90]);
        expect(detectAudioMimeType(mp3)).toBe("audio/mp3");
      });

      it("detects MP3 (frame sync FF FA)", () => {
        const mp3 = Buffer.from([0xff, 0xfa, 0x90]);
        expect(detectAudioMimeType(mp3)).toBe("audio/mp3");
      });

      it("detects MP3 (ID3 tag)", () => {
        const mp3 = Buffer.from([0x49, 0x44, 0x33]);
        expect(detectAudioMimeType(mp3)).toBe("audio/mp3");
      });

      it("detects OGG", () => {
        const ogg = Buffer.from([0x4f, 0x67, 0x67, 0x53]);
        expect(detectAudioMimeType(ogg)).toBe("audio/ogg");
      });

      it("detects WAV", () => {
        const wav = Buffer.from([
          0x52, 0x49, 0x46, 0x46,
          0x00, 0x00, 0x00, 0x00,
          0x57, 0x41, 0x56, 0x45,
        ]);
        expect(detectAudioMimeType(wav)).toBe("audio/wav");
      });

      it("detects WebM/Matroska", () => {
        const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
        expect(detectAudioMimeType(webm)).toBe("audio/webm");
      });

      it("returns null for unknown format", () => {
        const unknown = Buffer.from([0x00, 0x00, 0x00, 0x00]);
        expect(detectAudioMimeType(unknown)).toBeNull();
      });

      it("does not detect RIFF as WAV if WAVE marker is missing", () => {
        // RIFF without WAVE marker
        const riff = Buffer.from([
          0x52, 0x49, 0x46, 0x46,
          0x00, 0x00, 0x00, 0x00,
          0x41, 0x56, 0x49, 0x20, // "AVI " instead of "WAVE"
        ]);
        expect(detectAudioMimeType(riff)).toBeNull();
      });
    });
  });

  describe("toBase64()", () => {
    it("converts Buffer to base64", () => {
      const buffer = Buffer.from("Hello, World!");
      const result = toBase64(buffer);
      expect(result).toBe("SGVsbG8sIFdvcmxkIQ==");
    });

    it("converts Uint8Array to base64", () => {
      const array = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      const result = toBase64(array);
      expect(result).toBe("SGVsbG8=");
    });

    it("passes through string unchanged (assumes already base64)", () => {
      const base64 = "SGVsbG8gV29ybGQ=";
      const result = toBase64(base64);
      expect(result).toBe(base64);
    });

    it("handles empty buffer", () => {
      const empty = Buffer.from([]);
      const result = toBase64(empty);
      expect(result).toBe("");
    });

    it("handles binary data", () => {
      const binary = Buffer.from([0x00, 0xff, 0x80, 0x7f]);
      const result = toBase64(binary);
      expect(result).toBe("AP+Afw==");
    });
  });

  describe("Data URL Utilities", () => {
    describe("isDataUrl()", () => {
      it("returns true for valid data URLs", () => {
        expect(isDataUrl("data:image/jpeg;base64,/9j/4AAQ")).toBe(true);
        expect(isDataUrl("data:text/plain;base64,SGVsbG8=")).toBe(true);
        expect(isDataUrl("data:application/json,{}")).toBe(true);
      });

      it("returns false for regular URLs", () => {
        expect(isDataUrl("https://example.com/image.jpg")).toBe(false);
        expect(isDataUrl("http://example.com")).toBe(false);
        expect(isDataUrl("file:///path/to/file")).toBe(false);
      });

      it("returns false for non-URLs", () => {
        expect(isDataUrl("hello world")).toBe(false);
        expect(isDataUrl("")).toBe(false);
        expect(isDataUrl("/path/to/file")).toBe(false);
      });
    });

    describe("parseDataUrl()", () => {
      it("parses valid base64 data URLs", () => {
        const result = parseDataUrl("data:image/jpeg;base64,/9j/4AAQ");
        expect(result).toEqual({
          mimeType: "image/jpeg",
          data: "/9j/4AAQ",
        });
      });

      it("parses data URLs with various MIME types", () => {
        const pngResult = parseDataUrl("data:image/png;base64,iVBORw0KGgo=");
        expect(pngResult?.mimeType).toBe("image/png");

        const audioResult = parseDataUrl("data:audio/mp3;base64,//uQxAAA");
        expect(audioResult?.mimeType).toBe("audio/mp3");

        const textResult = parseDataUrl("data:text/plain;base64,SGVsbG8=");
        expect(textResult?.mimeType).toBe("text/plain");
      });

      it("returns null for invalid data URLs", () => {
        expect(parseDataUrl("https://example.com")).toBeNull();
        expect(parseDataUrl("data:image/jpeg,notbase64")).toBeNull();
        expect(parseDataUrl("not a url")).toBeNull();
        expect(parseDataUrl("")).toBeNull();
      });

      it("handles data URLs with special characters in base64", () => {
        const result = parseDataUrl("data:image/png;base64,abc+def/ghi=");
        expect(result).toEqual({
          mimeType: "image/png",
          data: "abc+def/ghi=",
        });
      });
    });
  });

  describe("Integration", () => {
    it("creates mixed content array", () => {
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

      const content: ContentPart[] = [
        text("What's in this image?"),
        imageFromBuffer(jpegBuffer),
      ];

      expect(content).toHaveLength(2);
      expect(isTextPart(content[0]!)).toBe(true);
      expect(isImagePart(content[1]!)).toBe(true);
    });

    it("preserves type information through narrowing", () => {
      const parts: ContentPart[] = [
        text("Hello"),
        imageFromUrl("https://example.com/img.jpg"),
        audioFromBase64("abc", "audio/mp3"),
      ];

      for (const part of parts) {
        if (isTextPart(part)) {
          expect(part.text).toBeDefined();
        } else if (isImagePart(part)) {
          expect(part.source).toBeDefined();
        } else if (isAudioPart(part)) {
          expect(part.source.mediaType).toBeDefined();
        }
      }
    });
  });
});
