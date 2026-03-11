import { Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CLIEnvironment } from "./environment.js";
import { executeSpeech, type SpeechCommandOptions } from "./speech-command.js";

// Mock fs.writeFileSync
vi.mock("node:fs", () => ({
  writeFileSync: vi.fn(),
}));

import { writeFileSync } from "node:fs";

/**
 * Mock writable stream that captures output and has optional TTY flag.
 */
class MockWritableStream extends Writable {
  public output = "";
  isTTY: boolean;

  constructor(isTTY = false) {
    super();
    this.isTTY = isTTY;
  }

  _write(chunk: Buffer | string, _encoding: string, callback: () => void): void {
    this.output += chunk.toString();
    callback();
  }

  clear(): void {
    this.output = "";
  }
}

/**
 * Creates a mock LLMist client for speech generation.
 */
function createMockClient(result: {
  audio: ArrayBuffer | Uint8Array;
  format: string;
  usage: { characterCount: number };
  cost?: number;
}) {
  return {
    speech: {
      generate: vi.fn().mockResolvedValue(result),
    },
  };
}

/**
 * Creates a mock CLI environment.
 */
function createMockEnv(
  mockClient: ReturnType<typeof createMockClient>,
  options: { stderrTTY?: boolean; isTTY?: boolean } = {},
): CLIEnvironment & { stdout: MockWritableStream; stderr: MockWritableStream } {
  const stdout = new MockWritableStream();
  const stderr = new MockWritableStream(options.stderrTTY ?? false);

  return {
    stdin: process.stdin,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stderr as unknown as NodeJS.WriteStream,
    isTTY: options.isTTY ?? false,
    createClient: () => mockClient as any,
    setExitCode: vi.fn(),
  } as unknown as CLIEnvironment & {
    stdout: MockWritableStream;
    stderr: MockWritableStream;
  };
}

/**
 * Creates a mock audio result with a simple byte buffer.
 */
function createMockAudioResult(options: {
  format?: string;
  characterCount?: number;
  cost?: number;
}) {
  // Create a simple Uint8Array to represent audio data
  const audioData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  return {
    audio: audioData.buffer,
    format: options.format ?? "mp3",
    usage: { characterCount: options.characterCount ?? 100 },
    cost: options.cost,
  };
}

describe("speech-command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("executeSpeech", () => {
    it("should write audio buffer to stdout when no output file specified", async () => {
      const mockResult = createMockAudioResult({ format: "mp3", characterCount: 50 });
      const mockClient = createMockClient(mockResult);
      const env = createMockEnv(mockClient);

      const options: SpeechCommandOptions = {
        model: "tts-1",
        quiet: true,
      };

      await executeSpeech("Hello world", options, env);

      expect(mockClient.speech.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "tts-1",
          input: "Hello world",
        }),
      );

      // stdout should have received the audio buffer
      const expectedBuffer = Buffer.from(mockResult.audio);
      expect(env.stdout.output).toBe(expectedBuffer.toString());
    });

    it("should save audio to file when output option specified", async () => {
      const mockResult = createMockAudioResult({ format: "mp3", characterCount: 80 });
      const mockClient = createMockClient(mockResult);
      const env = createMockEnv(mockClient, { stderrTTY: true });

      const options: SpeechCommandOptions = {
        model: "tts-1",
        output: "/tmp/test-audio.mp3",
      };

      await executeSpeech("Save this to file", options, env);

      const expectedBuffer = Buffer.from(mockResult.audio);
      expect(writeFileSync).toHaveBeenCalledWith("/tmp/test-audio.mp3", expectedBuffer);
      expect(env.stderr.output).toContain("Audio saved to /tmp/test-audio.mp3");
    });

    it("should suppress progress and summary messages in quiet mode", async () => {
      const mockResult = createMockAudioResult({ format: "mp3", characterCount: 30 });
      const mockClient = createMockClient(mockResult);
      const env = createMockEnv(mockClient, { stderrTTY: true });

      const options: SpeechCommandOptions = {
        model: "tts-1",
        output: "/tmp/quiet-output.mp3",
        quiet: true,
      };

      await executeSpeech("Quiet text", options, env);

      // All stderr output should be suppressed in quiet mode
      expect(env.stderr.output).toBe("");
    });

    it("should pass voice option to speech.generate", async () => {
      const mockResult = createMockAudioResult({ format: "mp3" });
      const mockClient = createMockClient(mockResult);
      const env = createMockEnv(mockClient);

      const options: SpeechCommandOptions = {
        model: "tts-1",
        voice: "alloy",
        quiet: true,
      };

      await executeSpeech("Voice test", options, env);

      expect(mockClient.speech.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          voice: "alloy",
        }),
      );
    });

    it("should use default voice when voice option not specified", async () => {
      const mockResult = createMockAudioResult({ format: "mp3" });
      const mockClient = createMockClient(mockResult);
      const env = createMockEnv(mockClient);

      const options: SpeechCommandOptions = {
        model: "tts-1",
        quiet: true,
      };

      await executeSpeech("Default voice test", options, env);

      expect(mockClient.speech.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          voice: "nova",
        }),
      );
    });

    it("should parse and pass speed option to speech.generate", async () => {
      const mockResult = createMockAudioResult({ format: "mp3" });
      const mockClient = createMockClient(mockResult);
      const env = createMockEnv(mockClient);

      const options: SpeechCommandOptions = {
        model: "tts-1",
        speed: "1.5",
        quiet: true,
      };

      await executeSpeech("Speed test", options, env);

      expect(mockClient.speech.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          speed: 1.5,
        }),
      );
    });

    it("should not pass speed when speed option not specified", async () => {
      const mockResult = createMockAudioResult({ format: "mp3" });
      const mockClient = createMockClient(mockResult);
      const env = createMockEnv(mockClient);

      const options: SpeechCommandOptions = {
        model: "tts-1",
        quiet: true,
      };

      await executeSpeech("No speed", options, env);

      expect(mockClient.speech.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          speed: undefined,
        }),
      );
    });

    it("should pass mp3 format option to speech.generate", async () => {
      const mockResult = createMockAudioResult({ format: "mp3" });
      const mockClient = createMockClient(mockResult);
      const env = createMockEnv(mockClient);

      const options: SpeechCommandOptions = {
        model: "tts-1",
        format: "mp3",
        quiet: true,
      };

      await executeSpeech("Format mp3", options, env);

      expect(mockClient.speech.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          responseFormat: "mp3",
        }),
      );
    });

    it("should pass opus format option to speech.generate", async () => {
      const mockResult = createMockAudioResult({ format: "opus" });
      const mockClient = createMockClient(mockResult);
      const env = createMockEnv(mockClient);

      const options: SpeechCommandOptions = {
        model: "tts-1",
        format: "opus",
        quiet: true,
      };

      await executeSpeech("Format opus", options, env);

      expect(mockClient.speech.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          responseFormat: "opus",
        }),
      );
    });

    it("should pass aac format option to speech.generate", async () => {
      const mockResult = createMockAudioResult({ format: "aac" });
      const mockClient = createMockClient(mockResult);
      const env = createMockEnv(mockClient);

      const options: SpeechCommandOptions = {
        model: "tts-1",
        format: "aac",
        quiet: true,
      };

      await executeSpeech("Format aac", options, env);

      expect(mockClient.speech.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          responseFormat: "aac",
        }),
      );
    });

    it("should render summary with character count and format in TTY mode", async () => {
      const mockResult = createMockAudioResult({ format: "mp3", characterCount: 250 });
      const mockClient = createMockClient(mockResult);
      const env = createMockEnv(mockClient, { stderrTTY: true });

      const options: SpeechCommandOptions = {
        model: "tts-1",
      };

      await executeSpeech("Summary test text", options, env);

      expect(env.stderr.output).toContain("250 characters");
      expect(env.stderr.output).toContain("format: mp3");
    });

    it("should include cost in summary when cost is provided", async () => {
      const mockResult = createMockAudioResult({
        format: "mp3",
        characterCount: 100,
        cost: 0.0015,
      });
      const mockClient = createMockClient(mockResult);
      const env = createMockEnv(mockClient, { stderrTTY: true });

      const options: SpeechCommandOptions = {
        model: "tts-1",
      };

      await executeSpeech("Cost test", options, env);

      expect(env.stderr.output).toContain("cost:");
    });

    it("should not include cost in summary when cost is undefined", async () => {
      const mockResult = createMockAudioResult({ format: "mp3", characterCount: 100 });
      const mockClient = createMockClient(mockResult);
      const env = createMockEnv(mockClient, { stderrTTY: true });

      const options: SpeechCommandOptions = {
        model: "tts-1",
      };

      await executeSpeech("No cost test", options, env);

      expect(env.stderr.output).not.toContain("cost:");
    });

    it("should show progress message in TTY mode when not quiet", async () => {
      const mockResult = createMockAudioResult({ format: "mp3" });
      const mockClient = createMockClient(mockResult);
      const env = createMockEnv(mockClient, { stderrTTY: true });

      const options: SpeechCommandOptions = {
        model: "tts-1",
      };

      await executeSpeech("Progress test", options, env);

      expect(env.stderr.output).toContain("Generating speech with tts-1");
    });

    it("should not show summary when stderr is not TTY", async () => {
      const mockResult = createMockAudioResult({ format: "mp3", characterCount: 100 });
      const mockClient = createMockClient(mockResult);
      const env = createMockEnv(mockClient, { stderrTTY: false });

      const options: SpeechCommandOptions = {
        model: "tts-1",
        // quiet not set, but stderr is not TTY
      };

      await executeSpeech("No TTY test", options, env);

      // No status messages when not TTY
      expect(env.stderr.output).toBe("");
    });

    it("should not write to stdout when output file is specified", async () => {
      const mockResult = createMockAudioResult({ format: "mp3" });
      const mockClient = createMockClient(mockResult);
      const env = createMockEnv(mockClient);

      const options: SpeechCommandOptions = {
        model: "tts-1",
        output: "/tmp/output.mp3",
        quiet: true,
      };

      await executeSpeech("File output only", options, env);

      // stdout should be empty — data goes to file
      expect(env.stdout.output).toBe("");
      expect(writeFileSync).toHaveBeenCalled();
    });
  });
});
