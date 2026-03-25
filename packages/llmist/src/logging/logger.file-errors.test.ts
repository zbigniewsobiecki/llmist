/**
 * Tests for file logging init, logReset flag, and write error handling.
 * These tests mock node:fs to inspect createWriteStream arguments and simulate
 * stream errors without touching the real filesystem.
 */
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetFileLoggingState, createLogger } from "./logger.js";

// ---- node:fs mock --------------------------------------------------------
// vi.mock is hoisted above imports, so `createWriteStream` and `mkdirSync`
// inside logger.ts will both receive the mocked versions.

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    mkdirSync: vi.fn(), // avoid real dir creation
    createWriteStream: vi.fn(),
  };
});

// Import the mocked helpers so we can set up return values and inspect calls.
const { createWriteStream, mkdirSync } = await import("node:fs");
const mockCreateWriteStream = vi.mocked(createWriteStream);
const mockMkdirSync = vi.mocked(mkdirSync);

// ---------------------------------------------------------------------------

/** Minimal fake WriteStream backed by EventEmitter */
class FakeWriteStream extends EventEmitter {
  write = vi.fn().mockReturnValue(true);
  end = vi.fn();
}

const TEST_LOG_FILE = "/tmp/llmist-mock-test.log";

describe("file logging — init via createWriteStream", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    _resetFileLoggingState();
    delete process.env.LLMIST_LOG_FILE;
    delete process.env.LLMIST_LOG_LEVEL;
    delete process.env.LLMIST_LOG_RESET;
    delete process.env.LLMIST_LOG_TEE;

    // Default: createWriteStream returns a usable fake stream
    mockCreateWriteStream.mockReturnValue(
      new FakeWriteStream() as unknown as ReturnType<typeof createWriteStream>,
    );
  });

  afterEach(() => {
    _resetFileLoggingState();
    process.env = { ...originalEnv };
  });

  it("should call createWriteStream with the path from LLMIST_LOG_FILE", () => {
    process.env.LLMIST_LOG_FILE = TEST_LOG_FILE;

    createLogger({ name: "init-test" });

    expect(mockCreateWriteStream).toHaveBeenCalledOnce();
    expect(mockCreateWriteStream).toHaveBeenCalledWith(
      TEST_LOG_FILE,
      expect.objectContaining({ flags: expect.any(String) }),
    );
  });

  it("should also call mkdirSync to ensure the parent directory exists", () => {
    process.env.LLMIST_LOG_FILE = TEST_LOG_FILE;

    createLogger({ name: "mkdir-test" });

    expect(mockMkdirSync).toHaveBeenCalledOnce();
  });

  it("should NOT call createWriteStream when LLMIST_LOG_FILE is not set", () => {
    createLogger({ name: "no-file" });

    expect(mockCreateWriteStream).not.toHaveBeenCalled();
  });

  it("should reuse the existing stream on subsequent createLogger calls with the same path", () => {
    process.env.LLMIST_LOG_FILE = TEST_LOG_FILE;

    createLogger({ name: "first" });
    createLogger({ name: "second" });
    createLogger({ name: "third" });

    // Stream should only be created once (singleton)
    expect(mockCreateWriteStream).toHaveBeenCalledOnce();
  });

  it("should open a new stream when the log file path changes", () => {
    process.env.LLMIST_LOG_FILE = TEST_LOG_FILE;
    createLogger({ name: "first" });

    // Do NOT reset state here — logFileInitialized stays true so the second
    // createLogger exercises the sharedLogFilePath !== envLogFile branch.
    process.env.LLMIST_LOG_FILE = "/tmp/llmist-other.log";
    createLogger({ name: "second" });

    expect(mockCreateWriteStream).toHaveBeenCalledTimes(2);
  });
});

describe("file logging — logReset flag", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    _resetFileLoggingState();
    delete process.env.LLMIST_LOG_FILE;
    delete process.env.LLMIST_LOG_LEVEL;
    delete process.env.LLMIST_LOG_RESET;
    delete process.env.LLMIST_LOG_TEE;

    mockCreateWriteStream.mockReturnValue(
      new FakeWriteStream() as unknown as ReturnType<typeof createWriteStream>,
    );
  });

  afterEach(() => {
    _resetFileLoggingState();
    process.env = { ...originalEnv };
  });

  it("should open createWriteStream with flags='w' (truncate) when LLMIST_LOG_RESET=true", () => {
    process.env.LLMIST_LOG_FILE = TEST_LOG_FILE;
    process.env.LLMIST_LOG_RESET = "true";

    createLogger({ name: "reset-test" });

    expect(mockCreateWriteStream).toHaveBeenCalledWith(
      TEST_LOG_FILE,
      expect.objectContaining({ flags: "w" }),
    );
  });

  it("should open createWriteStream with flags='a' (append) when LLMIST_LOG_RESET=false", () => {
    process.env.LLMIST_LOG_FILE = TEST_LOG_FILE;
    process.env.LLMIST_LOG_RESET = "false";

    createLogger({ name: "append-test" });

    expect(mockCreateWriteStream).toHaveBeenCalledWith(
      TEST_LOG_FILE,
      expect.objectContaining({ flags: "a" }),
    );
  });

  it("should default to append mode (flags='a') when LLMIST_LOG_RESET is not set", () => {
    process.env.LLMIST_LOG_FILE = TEST_LOG_FILE;
    // LLMIST_LOG_RESET intentionally not set

    createLogger({ name: "default-append" });

    expect(mockCreateWriteStream).toHaveBeenCalledWith(
      TEST_LOG_FILE,
      expect.objectContaining({ flags: "a" }),
    );
  });

  it("should use flags='w' when options.logReset=true (option takes precedence over env)", () => {
    process.env.LLMIST_LOG_FILE = TEST_LOG_FILE;
    process.env.LLMIST_LOG_RESET = "false"; // env says append…

    createLogger({ name: "opt-reset", logReset: true }); // …but option says truncate

    expect(mockCreateWriteStream).toHaveBeenCalledWith(
      TEST_LOG_FILE,
      expect.objectContaining({ flags: "w" }),
    );
  });

  it("should use flags='a' when options.logReset=false overrides env true", () => {
    process.env.LLMIST_LOG_FILE = TEST_LOG_FILE;
    process.env.LLMIST_LOG_RESET = "true"; // env says truncate…

    createLogger({ name: "opt-append", logReset: false }); // …but option says append

    expect(mockCreateWriteStream).toHaveBeenCalledWith(
      TEST_LOG_FILE,
      expect.objectContaining({ flags: "a" }),
    );
  });
});

describe("file logging — write error handling", () => {
  const originalEnv = { ...process.env };
  const MAX_ERRORS = 5; // MAX_WRITE_ERRORS_BEFORE_DISABLE in logger.ts

  let fakeStream: FakeWriteStream;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    _resetFileLoggingState();
    delete process.env.LLMIST_LOG_FILE;
    delete process.env.LLMIST_LOG_LEVEL;
    delete process.env.LLMIST_LOG_RESET;
    delete process.env.LLMIST_LOG_TEE;

    fakeStream = new FakeWriteStream();
    mockCreateWriteStream.mockReturnValue(
      fakeStream as unknown as ReturnType<typeof createWriteStream>,
    );

    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    _resetFileLoggingState();
    consoleErrorSpy.mockRestore();
    process.env = { ...originalEnv };
  });

  it("should log an error message to console on first write error", () => {
    process.env.LLMIST_LOG_FILE = TEST_LOG_FILE;
    createLogger({ name: "err-test" });

    fakeStream.emit("error", new Error("disk full"));

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Log file write error"));
  });

  it("should not repeat the first-error console message on subsequent errors", () => {
    process.env.LLMIST_LOG_FILE = TEST_LOG_FILE;
    createLogger({ name: "err-test" });

    fakeStream.emit("error", new Error("err1"));
    fakeStream.emit("error", new Error("err2"));
    fakeStream.emit("error", new Error("err3"));

    // The "Log file write error" message should appear only once
    const firstErrCalls = consoleErrorSpy.mock.calls.filter((c) =>
      String(c[0]).includes("Log file write error"),
    );
    expect(firstErrCalls).toHaveLength(1);
  });

  it("should disable file logging after MAX_WRITE_ERRORS_BEFORE_DISABLE errors", () => {
    process.env.LLMIST_LOG_FILE = TEST_LOG_FILE;
    createLogger({ name: "threshold-test" });

    // Emit exactly the threshold number of errors
    for (let i = 0; i < MAX_ERRORS; i++) {
      fakeStream.emit("error", new Error(`write error ${i + 1}`));
    }

    // The stream should have been ended
    expect(fakeStream.end).toHaveBeenCalled();
  });

  it("should log a 'too many errors' message when threshold is reached", () => {
    process.env.LLMIST_LOG_FILE = TEST_LOG_FILE;
    createLogger({ name: "disable-msg-test" });

    for (let i = 0; i < MAX_ERRORS; i++) {
      fakeStream.emit("error", new Error("boom"));
    }

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Too many log file errors"),
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("disabling file logging"));
  });

  it("should NOT disable file logging before the threshold is reached", () => {
    process.env.LLMIST_LOG_FILE = TEST_LOG_FILE;
    createLogger({ name: "below-threshold" });

    // One fewer than the threshold
    for (let i = 0; i < MAX_ERRORS - 1; i++) {
      fakeStream.emit("error", new Error(`err ${i + 1}`));
    }

    // Stream should still be open
    expect(fakeStream.end).not.toHaveBeenCalled();
    // No "disabling" message yet
    const disableCalls = consoleErrorSpy.mock.calls.filter((c) =>
      String(c[0]).includes("disabling file logging"),
    );
    expect(disableCalls).toHaveLength(0);
  });

  it("should handle createWriteStream init error gracefully without throwing", () => {
    process.env.LLMIST_LOG_FILE = TEST_LOG_FILE;
    mockCreateWriteStream.mockImplementation(() => {
      throw new Error("permission denied");
    });

    // createLogger must not propagate the error to the caller
    expect(() => createLogger({ name: "init-err" })).not.toThrow();
  });

  it("should report init error to console.error when createWriteStream throws", () => {
    process.env.LLMIST_LOG_FILE = TEST_LOG_FILE;
    mockCreateWriteStream.mockImplementation(() => {
      throw new Error("cannot open");
    });

    createLogger({ name: "init-err-msg" });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to initialize LLMIST_LOG_FILE output"),
      expect.any(Error),
    );
  });
});
