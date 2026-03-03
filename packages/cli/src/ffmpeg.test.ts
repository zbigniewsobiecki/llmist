import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convertToMp3, isFFmpegAvailable, resetFFmpegCache } from "./ffmpeg.js";

// Mock child_process
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

describe("ffmpeg utilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFFmpegCache();
  });

  afterEach(() => {
    resetFFmpegCache();
  });

  describe("isFFmpegAvailable", () => {
    test("returns true when ffmpeg is available", async () => {
      const mockProcess = new EventEmitter() as ChildProcess;

      vi.mocked(nodeSpawn).mockReturnValue(mockProcess);

      const promise = isFFmpegAvailable();

      // Simulate ffmpeg exiting successfully
      process.nextTick(() => mockProcess.emit("close", 0));

      const result = await promise;
      expect(result).toBe(true);
    });

    test("returns false when ffmpeg exits with non-zero code", async () => {
      const mockProcess = new EventEmitter() as ChildProcess;

      vi.mocked(nodeSpawn).mockReturnValue(mockProcess);

      const promise = isFFmpegAvailable();

      // Simulate ffmpeg exiting with error
      process.nextTick(() => mockProcess.emit("close", 1));

      const result = await promise;
      expect(result).toBe(false);
    });

    test("returns false when ffmpeg command errors (not installed)", async () => {
      const mockProcess = new EventEmitter() as ChildProcess;

      vi.mocked(nodeSpawn).mockReturnValue(mockProcess);

      const promise = isFFmpegAvailable();

      // Simulate ENOENT error (command not found)
      process.nextTick(() => mockProcess.emit("error", new Error("ENOENT")));

      const result = await promise;
      expect(result).toBe(false);
    });

    test("caches result after first check", async () => {
      const mockProcess = new EventEmitter() as ChildProcess;

      vi.mocked(nodeSpawn).mockReturnValue(mockProcess);

      // First call
      const promise1 = isFFmpegAvailable();
      process.nextTick(() => mockProcess.emit("close", 0));
      await promise1;

      // Second call should not spawn again
      const result2 = await isFFmpegAvailable();

      expect(result2).toBe(true);
      // spawn should only be called once due to caching
      expect(nodeSpawn).toHaveBeenCalledTimes(1);
    });

    test("concurrent calls share the same Promise (no race condition)", async () => {
      const mockProcess = new EventEmitter() as ChildProcess;

      vi.mocked(nodeSpawn).mockReturnValue(mockProcess);

      // Start multiple concurrent calls BEFORE the first resolves
      const promise1 = isFFmpegAvailable();
      const promise2 = isFFmpegAvailable();
      const promise3 = isFFmpegAvailable();

      // Resolve after all calls have started
      process.nextTick(() => mockProcess.emit("close", 0));

      const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3]);

      // All should get the same result
      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(result3).toBe(true);

      // spawn should only be called ONCE despite concurrent calls
      // This verifies the race condition is fixed (Promise is cached, not boolean result)
      expect(nodeSpawn).toHaveBeenCalledTimes(1);
    });

    test("spawns ffmpeg with -version flag", async () => {
      const mockProcess = new EventEmitter() as ChildProcess;

      vi.mocked(nodeSpawn).mockReturnValue(mockProcess);

      const promise = isFFmpegAvailable();
      process.nextTick(() => mockProcess.emit("close", 0));
      await promise;

      expect(nodeSpawn).toHaveBeenCalledWith("ffmpeg", ["-version"], { stdio: "ignore" });
    });
  });

  describe("convertToMp3", () => {
    function createMockProcess() {
      const stdin = new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      });
      const stdout = new Readable({ read() {} });
      const mockProcess = new EventEmitter() as ChildProcess & {
        stdin: Writable;
        stdout: Readable;
      };
      mockProcess.stdin = stdin;
      mockProcess.stdout = stdout;
      return mockProcess;
    }

    test("converts audio buffer to mp3", async () => {
      const mockProcess = createMockProcess();
      vi.mocked(nodeSpawn).mockReturnValue(mockProcess as unknown as ChildProcess);

      const inputBuffer = Buffer.from("fake audio data");
      const promise = convertToMp3(inputBuffer, "wav");

      // Simulate ffmpeg output
      const outputData = Buffer.from("fake mp3 data");
      process.nextTick(() => {
        mockProcess.stdout.push(outputData);
        mockProcess.stdout.push(null); // Signal end of stream
        mockProcess.emit("close", 0);
      });

      const result = await promise;

      expect(result).toEqual(outputData);
    });

    test("returns null when conversion fails (non-zero exit)", async () => {
      const mockProcess = createMockProcess();
      vi.mocked(nodeSpawn).mockReturnValue(mockProcess as unknown as ChildProcess);

      const inputBuffer = Buffer.from("fake audio data");
      const promise = convertToMp3(inputBuffer, "wav");

      process.nextTick(() => {
        mockProcess.emit("close", 1);
      });

      const result = await promise;

      expect(result).toBeNull();
    });

    test("returns null when spawn errors", async () => {
      const mockProcess = createMockProcess();
      vi.mocked(nodeSpawn).mockReturnValue(mockProcess as unknown as ChildProcess);

      const inputBuffer = Buffer.from("fake audio data");
      const promise = convertToMp3(inputBuffer, "wav");

      process.nextTick(() => {
        mockProcess.emit("error", new Error("Spawn failed"));
      });

      const result = await promise;

      expect(result).toBeNull();
    });

    test("uses correct ffmpeg args for pcm16 input", async () => {
      const mockProcess = createMockProcess();
      vi.mocked(nodeSpawn).mockReturnValue(mockProcess as unknown as ChildProcess);

      const inputBuffer = Buffer.from("fake pcm16 data");
      const promise = convertToMp3(inputBuffer, "pcm16");

      process.nextTick(() => {
        mockProcess.emit("close", 0);
      });

      await promise;

      expect(nodeSpawn).toHaveBeenCalledWith(
        "ffmpeg",
        [
          "-f",
          "s16le",
          "-ar",
          "24000",
          "-ac",
          "1",
          "-i",
          "pipe:0",
          "-f",
          "mp3",
          "-ab",
          "128k",
          "pipe:1",
        ],
        { stdio: ["pipe", "pipe", "ignore"] },
      );
    });

    test("uses correct ffmpeg args for wav input", async () => {
      const mockProcess = createMockProcess();
      vi.mocked(nodeSpawn).mockReturnValue(mockProcess as unknown as ChildProcess);

      const inputBuffer = Buffer.from("fake wav data");
      const promise = convertToMp3(inputBuffer, "wav");

      process.nextTick(() => {
        mockProcess.emit("close", 0);
      });

      await promise;

      expect(nodeSpawn).toHaveBeenCalledWith(
        "ffmpeg",
        ["-f", "wav", "-i", "pipe:0", "-f", "mp3", "-ab", "128k", "pipe:1"],
        { stdio: ["pipe", "pipe", "ignore"] },
      );
    });

    test("concatenates multiple output chunks", async () => {
      const mockProcess = createMockProcess();
      vi.mocked(nodeSpawn).mockReturnValue(mockProcess as unknown as ChildProcess);

      const inputBuffer = Buffer.from("fake audio data");
      const promise = convertToMp3(inputBuffer, "wav");

      // Simulate ffmpeg outputting in chunks
      const chunk1 = Buffer.from("chunk1");
      const chunk2 = Buffer.from("chunk2");
      const chunk3 = Buffer.from("chunk3");

      process.nextTick(() => {
        mockProcess.stdout.push(chunk1);
        mockProcess.stdout.push(chunk2);
        mockProcess.stdout.push(chunk3);
        mockProcess.stdout.push(null);
        mockProcess.emit("close", 0);
      });

      const result = await promise;

      expect(result).toEqual(Buffer.concat([chunk1, chunk2, chunk3]));
    });

    test("writes input buffer to stdin", async () => {
      const writtenChunks: Buffer[] = [];
      const stdin = new Writable({
        write(chunk, _encoding, callback) {
          writtenChunks.push(chunk as Buffer);
          callback();
        },
      });
      const stdout = new Readable({ read() {} });
      const mockProcess = new EventEmitter() as ChildProcess & {
        stdin: Writable;
        stdout: Readable;
      };
      mockProcess.stdin = stdin;
      mockProcess.stdout = stdout;

      vi.mocked(nodeSpawn).mockReturnValue(mockProcess as unknown as ChildProcess);

      const inputBuffer = Buffer.from("test audio data");
      const promise = convertToMp3(inputBuffer, "wav");

      process.nextTick(() => {
        mockProcess.emit("close", 0);
      });

      await promise;

      // Verify the input buffer was written to stdin
      expect(Buffer.concat(writtenChunks)).toEqual(inputBuffer);
    });

    test("returns null on timeout", async () => {
      const mockProcess = createMockProcess();
      let killed = false;
      (mockProcess as any).kill = () => {
        killed = true;
      };

      vi.mocked(nodeSpawn).mockReturnValue(mockProcess as unknown as ChildProcess);

      const inputBuffer = Buffer.from("slow conversion");
      // Use a very short timeout for testing
      const promise = convertToMp3(inputBuffer, "wav", 50);

      // Don't emit close - simulate hanging process
      const result = await promise;

      expect(result).toBeNull();
      expect(killed).toBe(true);
    });

    test("handles stdin error gracefully", async () => {
      const stdin = new Writable({
        write(_chunk, _encoding, callback) {
          // Simulate stdin error after write
          process.nextTick(() => stdin.emit("error", new Error("Pipe broken")));
          callback();
        },
      });
      const stdout = new Readable({ read() {} });
      const mockProcess = new EventEmitter() as ChildProcess & {
        stdin: Writable;
        stdout: Readable;
      };
      mockProcess.stdin = stdin;
      mockProcess.stdout = stdout;

      vi.mocked(nodeSpawn).mockReturnValue(mockProcess as unknown as ChildProcess);

      const inputBuffer = Buffer.from("test audio");
      const promise = convertToMp3(inputBuffer, "wav");

      // Process still completes successfully despite stdin error
      process.nextTick(() => {
        mockProcess.stdout.push(Buffer.from("mp3 data"));
        mockProcess.stdout.push(null);
        mockProcess.emit("close", 0);
      });

      // Should not throw - stdin error is handled gracefully
      const result = await promise;
      expect(result).toEqual(Buffer.from("mp3 data"));
    });
  });

  describe("resetFFmpegCache", () => {
    test("allows re-checking ffmpeg availability", async () => {
      const mockProcess1 = new EventEmitter() as ChildProcess;
      const mockProcess2 = new EventEmitter() as ChildProcess;

      vi.mocked(nodeSpawn).mockReturnValueOnce(mockProcess1).mockReturnValueOnce(mockProcess2);

      // First check - available
      const promise1 = isFFmpegAvailable();
      process.nextTick(() => mockProcess1.emit("close", 0));
      const result1 = await promise1;
      expect(result1).toBe(true);

      // Reset cache
      resetFFmpegCache();

      // Second check - not available
      const promise2 = isFFmpegAvailable();
      process.nextTick(() => mockProcess2.emit("close", 1));
      const result2 = await promise2;
      expect(result2).toBe(false);

      // Both spawns should have been called
      expect(nodeSpawn).toHaveBeenCalledTimes(2);
    });
  });
});
