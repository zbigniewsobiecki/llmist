import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _resetFileLoggingState, createLogger, stripAnsi } from "./logger.js";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe("createLogger", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clean up environment variables before each test
    delete process.env.LLMIST_LOG_LEVEL;
    delete process.env.LLMIST_LOG_FILE;
    delete process.env.LLMIST_LOG_RESET;
  });

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv };
  });

  describe("defaults", () => {
    it("should use defaults when no options provided", () => {
      const logger = createLogger();

      expect(logger).toBeDefined();
      // Default minLevel is 4 (warn)
      expect(logger.settings.minLevel).toBe(4);
    });

    it("should use default name 'llmist'", () => {
      const logger = createLogger();

      expect(logger.settings.name).toBe("llmist");
    });
  });

  describe("minLevel option", () => {
    it("should respect minLevel option", () => {
      const logger = createLogger({ minLevel: 2 });

      expect(logger.settings.minLevel).toBe(2);
    });

    it("should respect minLevel=0 (silly)", () => {
      const logger = createLogger({ minLevel: 0 });

      expect(logger.settings.minLevel).toBe(0);
    });

    it("should respect minLevel=6 (fatal)", () => {
      const logger = createLogger({ minLevel: 6 });

      expect(logger.settings.minLevel).toBe(6);
    });
  });

  describe("type option", () => {
    it("should use pretty type by default", () => {
      const logger = createLogger();

      expect(logger.settings.type).toBe("pretty");
    });

    it("should respect type option", () => {
      const logger = createLogger({ type: "json" });

      expect(logger.settings.type).toBe("json");
    });

    it("should support hidden type", () => {
      const logger = createLogger({ type: "hidden" });

      expect(logger.settings.type).toBe("hidden");
    });
  });

  describe("name option", () => {
    it("should use custom name when provided", () => {
      const logger = createLogger({ name: "custom-logger" });

      expect(logger.settings.name).toBe("custom-logger");
    });
  });

  describe("environment variables", () => {
    it("should read LLMIST_LOG_LEVEL from environment", () => {
      process.env.LLMIST_LOG_LEVEL = "2";
      const logger = createLogger();

      expect(logger.settings.minLevel).toBe(2);
    });

    it("should parse numeric log levels", () => {
      process.env.LLMIST_LOG_LEVEL = "3";
      const logger = createLogger();

      expect(logger.settings.minLevel).toBe(3);
    });

    it("should parse named log levels", () => {
      process.env.LLMIST_LOG_LEVEL = "debug";
      const logger = createLogger();

      expect(logger.settings.minLevel).toBe(2); // debug = 2
    });

    it("should handle case-insensitive named levels", () => {
      process.env.LLMIST_LOG_LEVEL = "DEBUG";
      const logger = createLogger();

      expect(logger.settings.minLevel).toBe(2);
    });

    it("should clamp numeric values to 0-6 range (high)", () => {
      process.env.LLMIST_LOG_LEVEL = "10";
      const logger = createLogger();

      expect(logger.settings.minLevel).toBe(6);
    });

    it("should clamp numeric values to 0-6 range (low)", () => {
      process.env.LLMIST_LOG_LEVEL = "-1";
      const logger = createLogger();

      expect(logger.settings.minLevel).toBe(0);
    });

    it("should ignore empty LLMIST_LOG_LEVEL", () => {
      process.env.LLMIST_LOG_LEVEL = "";
      const logger = createLogger();

      expect(logger.settings.minLevel).toBe(4); // default
    });

    it("should ignore whitespace-only LLMIST_LOG_LEVEL", () => {
      process.env.LLMIST_LOG_LEVEL = "   ";
      const logger = createLogger();

      expect(logger.settings.minLevel).toBe(4); // default
    });

    it("should prefer option over environment variable", () => {
      process.env.LLMIST_LOG_LEVEL = "2";
      const logger = createLogger({ minLevel: 5 });

      expect(logger.settings.minLevel).toBe(5);
    });

    it("should handle all named log levels", () => {
      const levels = [
        ["silly", 0],
        ["trace", 1],
        ["debug", 2],
        ["info", 3],
        ["warn", 4],
        ["error", 5],
        ["fatal", 6],
      ] as const;

      for (const [name, expected] of levels) {
        process.env.LLMIST_LOG_LEVEL = name;
        const logger = createLogger();
        expect(logger.settings.minLevel).toBe(expected);
      }
    });
  });

  describe("silent logger", () => {
    it("should create a silent logger with type hidden", () => {
      const logger = createLogger({ type: "hidden" });

      expect(logger.settings.type).toBe("hidden");
      // Should still function without errors
      expect(() => logger.info("test")).not.toThrow();
    });
  });

  describe("production optimizations", () => {
    it("should hide log position for json type", () => {
      const logger = createLogger({ type: "json" });

      expect(logger.settings.hideLogPositionForProduction).toBe(true);
    });

    it("should show log position for pretty type", () => {
      const logger = createLogger({ type: "pretty" });

      expect(logger.settings.hideLogPositionForProduction).toBe(false);
    });
  });

  describe("logging methods", () => {
    it("should have all standard logging methods", () => {
      const logger = createLogger({ type: "hidden" });

      expect(typeof logger.silly).toBe("function");
      expect(typeof logger.trace).toBe("function");
      expect(typeof logger.debug).toBe("function");
      expect(typeof logger.info).toBe("function");
      expect(typeof logger.warn).toBe("function");
      expect(typeof logger.error).toBe("function");
      expect(typeof logger.fatal).toBe("function");
    });

    it("should not throw when calling logging methods", () => {
      const logger = createLogger({ type: "hidden" });

      expect(() => logger.silly("silly message")).not.toThrow();
      expect(() => logger.trace("trace message")).not.toThrow();
      expect(() => logger.debug("debug message")).not.toThrow();
      expect(() => logger.info("info message")).not.toThrow();
      expect(() => logger.warn("warn message")).not.toThrow();
      expect(() => logger.error("error message")).not.toThrow();
      expect(() => logger.fatal("fatal message")).not.toThrow();
    });

    it("should accept objects as log arguments", () => {
      const logger = createLogger({ type: "hidden" });

      expect(() => logger.info({ key: "value" })).not.toThrow();
      expect(() => logger.info("message", { data: 123 })).not.toThrow();
    });
  });
});

describe("stripAnsi", () => {
  it("should strip ANSI color codes from strings", () => {
    const colored = "\x1b[31mred text\x1b[0m";
    expect(stripAnsi(colored)).toBe("red text");
  });

  it("should strip multiple ANSI codes", () => {
    const colored = "\x1b[1m\x1b[32mbold green\x1b[0m normal";
    expect(stripAnsi(colored)).toBe("bold green normal");
  });

  it("should handle strings without ANSI codes", () => {
    const plain = "no colors here";
    expect(stripAnsi(plain)).toBe("no colors here");
  });

  it("should handle empty strings", () => {
    expect(stripAnsi("")).toBe("");
  });

  it("should strip complex ANSI sequences", () => {
    const complex = "\x1b[38;5;196mextended color\x1b[0m";
    expect(stripAnsi(complex)).toBe("extended color");
  });
});

describe("file logging", () => {
  const originalEnv = { ...process.env };
  let testLogFile: string;

  beforeEach(() => {
    // Create unique temp file for each test
    testLogFile = join(tmpdir(), `llmist-test-${Date.now()}-${Math.random().toString(36).slice(2)}.log`);
    // Reset file logging state before each test
    _resetFileLoggingState();
    // Clean up environment variables
    delete process.env.LLMIST_LOG_LEVEL;
    delete process.env.LLMIST_LOG_FILE;
    delete process.env.LLMIST_LOG_RESET;
  });

  afterEach(async () => {
    // Reset file logging state to close streams
    _resetFileLoggingState();
    // Restore original environment
    process.env = { ...originalEnv };
    // Clean up test log file
    await sleep(50); // Give time for stream to close
    if (existsSync(testLogFile)) {
      try {
        unlinkSync(testLogFile);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe("LLMIST_LOG_FILE activation", () => {
    it("should create log file when LLMIST_LOG_FILE is set", async () => {
      process.env.LLMIST_LOG_FILE = testLogFile;
      process.env.LLMIST_LOG_LEVEL = "0"; // silly - log everything
      const logger = createLogger({ name: "test" });

      logger.info("test message");
      await sleep(50); // Allow async write

      expect(existsSync(testLogFile)).toBe(true);
    });

    it("should write log messages to file", async () => {
      process.env.LLMIST_LOG_FILE = testLogFile;
      process.env.LLMIST_LOG_LEVEL = "0";
      const logger = createLogger({ name: "test" });

      logger.info("hello world");
      await sleep(50);

      const content = readFileSync(testLogFile, "utf-8");
      expect(content).toContain("hello world");
      expect(content).toContain("[test]");
      expect(content).toContain("INFO");
    });

    it("should use pretty type internally for file logging", () => {
      process.env.LLMIST_LOG_FILE = testLogFile;
      const logger = createLogger({ name: "test" });

      // When file logging is active, type is set to "pretty" to enable formatting
      expect(logger.settings.type).toBe("pretty");
    });
  });

  describe("logReset behavior", () => {
    it("should truncate file when LLMIST_LOG_RESET=true", async () => {
      process.env.LLMIST_LOG_FILE = testLogFile;
      process.env.LLMIST_LOG_LEVEL = "0";
      process.env.LLMIST_LOG_RESET = "true";

      // Create initial content
      const logger1 = createLogger({ name: "first" });
      logger1.info("first message");
      await sleep(50);

      // Reset state and create new logger with reset
      _resetFileLoggingState();
      process.env.LLMIST_LOG_RESET = "true";
      const logger2 = createLogger({ name: "second" });
      logger2.info("second message");
      await sleep(50);

      const content = readFileSync(testLogFile, "utf-8");
      expect(content).toContain("second message");
      expect(content).not.toContain("first message");
    });

    it("should append to file when LLMIST_LOG_RESET=false", async () => {
      process.env.LLMIST_LOG_FILE = testLogFile;
      process.env.LLMIST_LOG_LEVEL = "0";
      process.env.LLMIST_LOG_RESET = "false";

      const logger1 = createLogger({ name: "first" });
      logger1.info("first message");
      await sleep(50);

      // Reset state but keep append mode
      _resetFileLoggingState();
      process.env.LLMIST_LOG_RESET = "false";
      const logger2 = createLogger({ name: "second" });
      logger2.info("second message");
      await sleep(50);

      const content = readFileSync(testLogFile, "utf-8");
      expect(content).toContain("first message");
      expect(content).toContain("second message");
    });

    it("should default to append mode", async () => {
      process.env.LLMIST_LOG_FILE = testLogFile;
      process.env.LLMIST_LOG_LEVEL = "0";
      // No LLMIST_LOG_RESET set

      const logger1 = createLogger({ name: "first" });
      logger1.info("first message");
      await sleep(50);

      _resetFileLoggingState();
      const logger2 = createLogger({ name: "second" });
      logger2.info("second message");
      await sleep(50);

      const content = readFileSync(testLogFile, "utf-8");
      expect(content).toContain("first message");
      expect(content).toContain("second message");
    });
  });

  describe("ANSI stripping", () => {
    it("should strip ANSI codes from file output", async () => {
      process.env.LLMIST_LOG_FILE = testLogFile;
      process.env.LLMIST_LOG_LEVEL = "0";
      const logger = createLogger({ name: "test" });

      logger.info("clean message");
      await sleep(50);

      const content = readFileSync(testLogFile, "utf-8");
      // Should not contain ANSI escape codes
      // biome-ignore lint/suspicious/noControlCharactersInRegex: Testing for ANSI codes requires matching escape sequences
      expect(content).not.toMatch(/\x1b\[/);
      expect(content).toContain("clean message");
    });
  });

  describe("object serialization", () => {
    it("should serialize objects to JSON in file output", async () => {
      process.env.LLMIST_LOG_FILE = testLogFile;
      process.env.LLMIST_LOG_LEVEL = "0";
      const logger = createLogger({ name: "test" });

      logger.info("message", { foo: "bar", count: 42 });
      await sleep(50);

      const content = readFileSync(testLogFile, "utf-8");
      expect(content).toContain('"foo":"bar"');
      expect(content).toContain('"count":42');
    });
  });

  describe("singleton behavior", () => {
    it("should share log file across multiple createLogger calls", async () => {
      process.env.LLMIST_LOG_FILE = testLogFile;
      process.env.LLMIST_LOG_LEVEL = "0";

      const logger1 = createLogger({ name: "logger1" });
      const logger2 = createLogger({ name: "logger2" });
      const logger3 = createLogger({ name: "logger3" });

      logger1.info("from logger1");
      logger2.info("from logger2");
      logger3.info("from logger3");
      await sleep(50);

      const content = readFileSync(testLogFile, "utf-8");
      expect(content).toContain("[logger1]");
      expect(content).toContain("[logger2]");
      expect(content).toContain("[logger3]");
      expect(content).toContain("from logger1");
      expect(content).toContain("from logger2");
      expect(content).toContain("from logger3");
    });

    it("should reuse same file path without creating new streams", async () => {
      process.env.LLMIST_LOG_FILE = testLogFile;
      process.env.LLMIST_LOG_LEVEL = "0";

      // Create multiple loggers rapidly - should all share same stream
      const loggers = [];
      for (let i = 0; i < 10; i++) {
        loggers.push(createLogger({ name: `logger${i}` }));
      }

      for (let i = 0; i < 10; i++) {
        loggers[i].info(`message ${i}`);
      }
      await sleep(100);

      const content = readFileSync(testLogFile, "utf-8");
      for (let i = 0; i < 10; i++) {
        expect(content).toContain(`message ${i}`);
      }
    });
  });

  describe("log format", () => {
    it("should include timestamp, level, name, and message", async () => {
      process.env.LLMIST_LOG_FILE = testLogFile;
      process.env.LLMIST_LOG_LEVEL = "0";
      const logger = createLogger({ name: "format-test" });

      logger.warn("warning message");
      await sleep(50);

      const content = readFileSync(testLogFile, "utf-8");
      // Check format: timestamp\tLEVEL\t[name]\tmessage
      expect(content).toMatch(/\d{4}-\d{2}-\d{2}/); // Date
      expect(content).toMatch(/\d{2}:\d{2}:\d{2}:\d{3}/); // Time with ms
      expect(content).toContain("WARN");
      expect(content).toContain("[format-test]");
      expect(content).toContain("warning message");
    });

    it("should use tab separators", async () => {
      process.env.LLMIST_LOG_FILE = testLogFile;
      process.env.LLMIST_LOG_LEVEL = "0";
      const logger = createLogger({ name: "tab-test" });

      logger.info("test");
      await sleep(50);

      const content = readFileSync(testLogFile, "utf-8");
      // Should have tabs as separators
      expect(content).toContain("\t");
    });
  });

  describe("error handling", () => {
    it("should not throw when log file directory does not exist", () => {
      process.env.LLMIST_LOG_FILE = join(tmpdir(), `nonexistent-dir-${Date.now()}`, "test.log");

      // Should not throw - will create directory
      expect(() => createLogger({ name: "test" })).not.toThrow();
    });
  });
});
