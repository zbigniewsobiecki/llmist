/**
 * Types and interfaces for multimodal input content.
 *
 * These types define the structure for sending images, audio, and other
 * media alongside text in LLM messages. They complement the output types
 * in media-types.ts.
 */

// ============================================================================
// MIME Types
// ============================================================================

/**
 * Supported image MIME types for input.
 * All major providers support these formats.
 */
export type ImageMimeType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

/**
 * Supported audio MIME types for input.
 * Currently only Gemini supports audio input.
 */
export type AudioMimeType =
  | "audio/mp3"
  | "audio/mpeg"
  | "audio/wav"
  | "audio/webm"
  | "audio/ogg"
  | "audio/flac";

// ============================================================================
// Content Part Types
// ============================================================================

/**
 * Base interface for all content parts.
 */
export interface BaseContentPart {
  type: string;
}

/**
 * Text content part.
 */
export interface TextContentPart extends BaseContentPart {
  type: "text";
  text: string;
}

/**
 * Image content part.
 */
export interface ImageContentPart extends BaseContentPart {
  type: "image";
  source: ImageSource;
}

/**
 * Audio content part.
 * Currently only supported by Gemini.
 */
export interface AudioContentPart extends BaseContentPart {
  type: "audio";
  source: AudioSource;
}

/**
 * Union of all supported content part types.
 */
export type ContentPart = TextContentPart | ImageContentPart | AudioContentPart;

// ============================================================================
// Source Types
// ============================================================================

/**
 * Image can come from base64 data or a URL.
 */
export type ImageSource = ImageBase64Source | ImageUrlSource;

/**
 * Base64-encoded image data.
 * Supported by all providers.
 */
export interface ImageBase64Source {
  type: "base64";
  mediaType: ImageMimeType;
  data: string;
}

/**
 * Image URL reference.
 * Only supported by OpenAI.
 */
export interface ImageUrlSource {
  type: "url";
  url: string;
}

/**
 * Audio source (base64 only).
 * URL sources are not currently supported for audio.
 */
export interface AudioSource {
  type: "base64";
  mediaType: AudioMimeType;
  data: string;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a content part is a text part.
 */
export function isTextPart(part: ContentPart): part is TextContentPart {
  return part.type === "text";
}

/**
 * Check if a content part is an image part.
 */
export function isImagePart(part: ContentPart): part is ImageContentPart {
  return part.type === "image";
}

/**
 * Check if a content part is an audio part.
 */
export function isAudioPart(part: ContentPart): part is AudioContentPart {
  return part.type === "audio";
}

/**
 * Check if an image source is base64.
 */
export function isBase64ImageSource(source: ImageSource): source is ImageBase64Source {
  return source.type === "base64";
}

/**
 * Check if an image source is a URL.
 */
export function isUrlImageSource(source: ImageSource): source is ImageUrlSource {
  return source.type === "url";
}

// ============================================================================
// Helper Functions - Content Part Creation
// ============================================================================

/**
 * Create a text content part.
 *
 * @example
 * ```typescript
 * const part = text("What's in this image?");
 * ```
 */
export function text(content: string): TextContentPart {
  return { type: "text", text: content };
}

/**
 * Create an image content part from base64-encoded data.
 *
 * @param data - Base64-encoded image data
 * @param mediaType - MIME type of the image
 *
 * @example
 * ```typescript
 * const part = imageFromBase64(base64Data, "image/jpeg");
 * ```
 */
export function imageFromBase64(data: string, mediaType: ImageMimeType): ImageContentPart {
  return {
    type: "image",
    source: { type: "base64", mediaType, data },
  };
}

/**
 * Create an image content part from a URL.
 * Note: Only supported by OpenAI.
 *
 * @param url - URL to the image (must be accessible)
 *
 * @example
 * ```typescript
 * const part = imageFromUrl("https://example.com/image.jpg");
 * ```
 */
export function imageFromUrl(url: string): ImageContentPart {
  return {
    type: "image",
    source: { type: "url", url },
  };
}

/**
 * Magic bytes for detecting image MIME types.
 */
const IMAGE_MAGIC_BYTES: Array<{ bytes: number[]; mimeType: ImageMimeType }> = [
  { bytes: [0xff, 0xd8, 0xff], mimeType: "image/jpeg" },
  { bytes: [0x89, 0x50, 0x4e, 0x47], mimeType: "image/png" },
  { bytes: [0x47, 0x49, 0x46, 0x38], mimeType: "image/gif" },
  // WebP starts with RIFF....WEBP
  { bytes: [0x52, 0x49, 0x46, 0x46], mimeType: "image/webp" },
];

/**
 * Magic bytes for detecting audio MIME types.
 */
const AUDIO_MAGIC_BYTES: Array<{ bytes: number[]; mimeType: AudioMimeType }> = [
  // MP3 frame sync
  { bytes: [0xff, 0xfb], mimeType: "audio/mp3" },
  { bytes: [0xff, 0xfa], mimeType: "audio/mp3" },
  // ID3 tag (MP3)
  { bytes: [0x49, 0x44, 0x33], mimeType: "audio/mp3" },
  // OGG
  { bytes: [0x4f, 0x67, 0x67, 0x53], mimeType: "audio/ogg" },
  // WAV (RIFF)
  { bytes: [0x52, 0x49, 0x46, 0x46], mimeType: "audio/wav" },
  // WebM
  { bytes: [0x1a, 0x45, 0xdf, 0xa3], mimeType: "audio/webm" },
  // FLAC (fLaC)
  { bytes: [0x66, 0x4c, 0x61, 0x43], mimeType: "audio/flac" },
];

/**
 * Detect the MIME type of image data from magic bytes.
 *
 * @param data - Raw image data
 * @returns Detected MIME type or null if unknown
 */
export function detectImageMimeType(data: Buffer | Uint8Array): ImageMimeType | null {
  const bytes = data instanceof Buffer ? data : Buffer.from(data);

  for (const { bytes: magic, mimeType } of IMAGE_MAGIC_BYTES) {
    if (bytes.length >= magic.length) {
      let matches = true;
      for (let i = 0; i < magic.length; i++) {
        if (bytes[i] !== magic[i]) {
          matches = false;
          break;
        }
      }
      if (matches) {
        // Special case: RIFF could be WebP or WAV, check for WEBP marker
        if (mimeType === "image/webp") {
          // RIFF....WEBP - check bytes 8-11
          if (bytes.length >= 12) {
            const webpMarker =
              bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
            if (!webpMarker) continue; // Not WebP, try next pattern
          }
        }
        return mimeType;
      }
    }
  }
  return null;
}

/**
 * Detect the MIME type of audio data from magic bytes.
 *
 * @param data - Raw audio data
 * @returns Detected MIME type or null if unknown
 */
export function detectAudioMimeType(data: Buffer | Uint8Array): AudioMimeType | null {
  const bytes = data instanceof Buffer ? data : Buffer.from(data);

  for (const { bytes: magic, mimeType } of AUDIO_MAGIC_BYTES) {
    if (bytes.length >= magic.length) {
      let matches = true;
      for (let i = 0; i < magic.length; i++) {
        if (bytes[i] !== magic[i]) {
          matches = false;
          break;
        }
      }
      if (matches) {
        // Special case: RIFF could be WAV or WebP, check for WAVE marker
        if (mimeType === "audio/wav") {
          // RIFF....WAVE - check bytes 8-11
          if (bytes.length >= 12) {
            const waveMarker =
              bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45;
            if (!waveMarker) continue; // Not WAV, try next pattern
          }
        }
        return mimeType;
      }
    }
  }
  return null;
}

/**
 * Convert data to base64 string.
 *
 * @param data - Data to encode (Buffer, Uint8Array, or already base64 string)
 * @returns Base64-encoded string
 */
export function toBase64(data: Buffer | Uint8Array | string): string {
  if (typeof data === "string") {
    return data; // Assume already base64
  }
  return Buffer.from(data).toString("base64");
}

/**
 * Create an image content part from a Buffer or Uint8Array.
 * Automatically detects the MIME type if not provided.
 *
 * @param buffer - Image data
 * @param mediaType - Optional MIME type (auto-detected if not provided)
 *
 * @example
 * ```typescript
 * const imageData = await fs.readFile("photo.jpg");
 * const part = imageFromBuffer(imageData); // Auto-detects JPEG
 * ```
 */
export function imageFromBuffer(
  buffer: Buffer | Uint8Array,
  mediaType?: ImageMimeType,
): ImageContentPart {
  const detectedType = mediaType ?? detectImageMimeType(buffer);
  if (!detectedType) {
    throw new Error(
      "Could not detect image MIME type. Please provide the mediaType parameter explicitly.",
    );
  }
  return {
    type: "image",
    source: {
      type: "base64",
      mediaType: detectedType,
      data: toBase64(buffer),
    },
  };
}

/**
 * Create an audio content part from base64-encoded data.
 *
 * @param data - Base64-encoded audio data
 * @param mediaType - MIME type of the audio
 *
 * @example
 * ```typescript
 * const part = audioFromBase64(base64Audio, "audio/mp3");
 * ```
 */
export function audioFromBase64(data: string, mediaType: AudioMimeType): AudioContentPart {
  return {
    type: "audio",
    source: { type: "base64", mediaType, data },
  };
}

/**
 * Create an audio content part from a Buffer or Uint8Array.
 * Automatically detects the MIME type if not provided.
 *
 * @param buffer - Audio data
 * @param mediaType - Optional MIME type (auto-detected if not provided)
 *
 * @example
 * ```typescript
 * const audioData = await fs.readFile("audio.mp3");
 * const part = audioFromBuffer(audioData); // Auto-detects MP3
 * ```
 */
export function audioFromBuffer(
  buffer: Buffer | Uint8Array,
  mediaType?: AudioMimeType,
): AudioContentPart {
  const detectedType = mediaType ?? detectAudioMimeType(buffer);
  if (!detectedType) {
    throw new Error(
      "Could not detect audio MIME type. Please provide the mediaType parameter explicitly.",
    );
  }
  return {
    type: "audio",
    source: {
      type: "base64",
      mediaType: detectedType,
      data: toBase64(buffer),
    },
  };
}

// ============================================================================
// Data URL Utilities
// ============================================================================

/**
 * Check if a string is a data URL.
 *
 * @param input - String to check
 * @returns True if it's a data URL
 */
export function isDataUrl(input: string): boolean {
  return input.startsWith("data:");
}

/**
 * Parse a data URL into its components.
 *
 * @param url - Data URL to parse
 * @returns Parsed components or null if invalid
 *
 * @example
 * ```typescript
 * const result = parseDataUrl("data:image/jpeg;base64,/9j/4AAQ...");
 * // { mimeType: "image/jpeg", data: "/9j/4AAQ..." }
 * ```
 */
export function parseDataUrl(url: string): { mimeType: string; data: string } | null {
  const match = url.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}
