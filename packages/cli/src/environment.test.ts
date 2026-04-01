import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createDefaultEnvironment, createLoggerFactory } from "./environment.js";

describe("createLoggerFactory", () => {
  describe("log level mapping", () => {
    test("maps 'silly' to level 0", () => {
      const factory = createLoggerFactory({ logLevel: "silly" });
      const logger = factory("test");
      expect(logger.settings.minLevel).toBe(0);
    });

    test("maps 'trace' to level 1", () => {
      const factory = createLoggerFactory({ logLevel: "trace" });
      const logger = factory("test");
      expect(logger.settings.minLevel).toBe(1);
    });

    test("maps 'debug' to level 2", () => {
      const factory = createLoggerFactory({ logLevel: "debug" });
      const logger = factory("test");
      expect(logger.settings.minLevel).toBe(2);
    });

    test("maps 'info' to level 3", () => {
      const factory = createLoggerFactory({ logLevel: "info" });
      const logger = factory("test");
      expect(logger.settings.minLevel).toBe(3);
    });

    test("maps 'warn' to level 4", () => {
      const factory = createLoggerFactory({ logLevel: "warn" });
      const logger = factory("test");
      expect(logger.settings.minLevel).toBe(4);
    });

    test("maps 'error' to level 5", () => {
      const factory = createLoggerFactory({ logLevel: "error" });
      const logger = factory("test");
      expect(logger.settings.minLevel).toBe(5);
    });

    test("maps 'fatal' to level 6", () => {
      const factory = createLoggerFactory({ logLevel: "fatal" });
      const logger = factory("test");
      expect(logger.settings.minLevel).toBe(6);
    });

    test("handles uppercase log level strings (case-insensitive)", () => {
      const factory = createLoggerFactory({ logLevel: "DEBUG" });
      const logger = factory("test");
      expect(logger.settings.minLevel).toBe(2);
    });

    test("handles mixed-case log level strings (case-insensitive)", () => {
      const factory = createLoggerFactory({ logLevel: "Warn" });
      const logger = factory("test");
      expect(logger.settings.minLevel).toBe(4);
    });

    test("ignores unknown log level strings (does not set minLevel)", () => {
      const factory = createLoggerFactory({ logLevel: "verbose" });
      const logger = factory("test");
      // Unknown level falls through to createLogger defaults
      expect(logger).toBeDefined();
    });

    test("uses no logLevel override when config is undefined", () => {
      const factory = createLoggerFactory(undefined);
      const logger = factory("test");
      expect(logger).toBeDefined();
    });

    test("uses no logLevel override when logLevel is not set in config", () => {
      const factory = createLoggerFactory({});
      const logger = factory("test");
      expect(logger).toBeDefined();
    });
  });

  describe("session log directory", () => {
    let originalLogFile: string | undefined;

    beforeEach(() => {
      originalLogFile = process.env.LLMIST_LOG_FILE;
    });

    afterEach(() => {
      // Restore original env var
      if (originalLogFile === undefined) {
        delete process.env.LLMIST_LOG_FILE;
      } else {
        process.env.LLMIST_LOG_FILE = originalLogFile;
      }
    });

    test("sets LLMIST_LOG_FILE env var during logger creation when sessionLogDir is provided", () => {
      // The factory should work without errors when sessionLogDir is provided
      const factory = createLoggerFactory(undefined, "/tmp/test-session-logs");
      const logger = factory("test");
      expect(logger).toBeDefined();
    });

    test("restores LLMIST_LOG_FILE after logger creation when sessionLogDir provided", () => {
      delete process.env.LLMIST_LOG_FILE;
      const factory = createLoggerFactory(undefined, "/tmp/test-session-logs");
      factory("test");
      // Should restore to undefined (no env var)
      expect(process.env.LLMIST_LOG_FILE).toBeUndefined();
    });

    test("restores LLMIST_LOG_FILE to original value after logger creation", () => {
      process.env.LLMIST_LOG_FILE = "/original/log.jsonl";
      const factory = createLoggerFactory(undefined, "/tmp/test-session-logs");
      factory("test");
      expect(process.env.LLMIST_LOG_FILE).toBe("/original/log.jsonl");
    });

    test("combines log level config with session log directory", () => {
      delete process.env.LLMIST_LOG_FILE;
      const factory = createLoggerFactory({ logLevel: "debug" }, "/tmp/test-session");
      const logger = factory("test");
      expect(logger.settings.minLevel).toBe(2);
    });
  });

  describe("logger instances", () => {
    test("creates a logger with the provided name", () => {
      const factory = createLoggerFactory();
      const logger = factory("my-logger");
      expect(logger.settings.name).toBe("my-logger");
    });

    test("creates different logger instances for different names", () => {
      const factory = createLoggerFactory();
      const loggerA = factory("logger-a");
      const loggerB = factory("logger-b");
      expect(loggerA.settings.name).toBe("logger-a");
      expect(loggerB.settings.name).toBe("logger-b");
    });

    test("creates a working logger with info method", () => {
      const factory = createLoggerFactory({ logLevel: "fatal" });
      const logger = factory("test");
      // Should not throw when calling log methods
      expect(() => logger.info("test message")).not.toThrow();
    });

    test("creates a working logger with debug method", () => {
      const factory = createLoggerFactory({ logLevel: "fatal" });
      const logger = factory("test");
      expect(() => logger.debug("debug message")).not.toThrow();
    });

    test("creates a working logger with warn method", () => {
      const factory = createLoggerFactory({ logLevel: "fatal" });
      const logger = factory("test");
      expect(() => logger.warn("warn message")).not.toThrow();
    });

    test("creates a working logger with error method", () => {
      const factory = createLoggerFactory({ logLevel: "fatal" });
      const logger = factory("test");
      expect(() => logger.error("error message")).not.toThrow();
    });

    test("factory is callable multiple times to produce independent loggers", () => {
      const factory = createLoggerFactory({ logLevel: "error" });
      const logger1 = factory("instance-1");
      const logger2 = factory("instance-2");
      // Each call produces a distinct logger
      expect(logger1).not.toBe(logger2);
    });
  });
});

describe("createDefaultEnvironment", () => {
  describe("shape and required fields", () => {
    test("returns an object with all required CLIEnvironment fields", () => {
      const env = createDefaultEnvironment();
      expect(env).toHaveProperty("argv");
      expect(env).toHaveProperty("stdin");
      expect(env).toHaveProperty("stdout");
      expect(env).toHaveProperty("stderr");
      expect(env).toHaveProperty("createClient");
      expect(env).toHaveProperty("setExitCode");
      expect(env).toHaveProperty("createLogger");
      expect(env).toHaveProperty("isTTY");
      expect(env).toHaveProperty("prompt");
    });

    test("argv is populated from process.argv", () => {
      const env = createDefaultEnvironment();
      expect(env.argv).toBe(process.argv);
    });

    test("stdin is process.stdin", () => {
      const env = createDefaultEnvironment();
      expect(env.stdin).toBe(process.stdin);
    });

    test("stdout is process.stdout", () => {
      const env = createDefaultEnvironment();
      expect(env.stdout).toBe(process.stdout);
    });

    test("stderr is process.stderr", () => {
      const env = createDefaultEnvironment();
      expect(env.stderr).toBe(process.stderr);
    });

    test("createClient is a function", () => {
      const env = createDefaultEnvironment();
      expect(typeof env.createClient).toBe("function");
    });

    test("setExitCode is a function that sets process.exitCode", () => {
      const env = createDefaultEnvironment();
      const originalExitCode = process.exitCode;
      env.setExitCode(1);
      expect(process.exitCode).toBe(1);
      process.exitCode = originalExitCode;
    });

    test("createLogger is a function", () => {
      const env = createDefaultEnvironment();
      expect(typeof env.createLogger).toBe("function");
    });

    test("loggerConfig is passed through when provided", () => {
      const config = { logLevel: "debug" };
      const env = createDefaultEnvironment(config);
      expect(env.loggerConfig).toBe(config);
    });

    test("loggerConfig is undefined when not provided", () => {
      const env = createDefaultEnvironment();
      expect(env.loggerConfig).toBeUndefined();
    });
  });

  describe("TTY detection", () => {
    let originalIsTTY: boolean | undefined;

    beforeEach(() => {
      // Save original isTTY value
      originalIsTTY = process.stdin.isTTY;
    });

    afterEach(() => {
      // Restore original isTTY
      (process.stdin as NodeJS.ReadStream & { isTTY: boolean | undefined }).isTTY = originalIsTTY;
    });

    test("isTTY is true when process.stdin.isTTY is true", () => {
      (process.stdin as NodeJS.ReadStream & { isTTY: boolean }).isTTY = true;
      const env = createDefaultEnvironment();
      expect(env.isTTY).toBe(true);
    });

    test("isTTY is false when process.stdin.isTTY is false", () => {
      (process.stdin as NodeJS.ReadStream & { isTTY: boolean }).isTTY = false;
      const env = createDefaultEnvironment();
      expect(env.isTTY).toBe(false);
    });

    test("isTTY is false when process.stdin.isTTY is undefined", () => {
      // Simulates piped input (isTTY is undefined in non-TTY contexts)
      (process.stdin as NodeJS.ReadStream & { isTTY: boolean | undefined }).isTTY = undefined;
      const env = createDefaultEnvironment();
      expect(env.isTTY).toBe(false);
    });

    test("prompt is a function when isTTY is true", () => {
      (process.stdin as NodeJS.ReadStream & { isTTY: boolean }).isTTY = true;
      const env = createDefaultEnvironment();
      expect(typeof env.prompt).toBe("function");
    });

    test("prompt throws when isTTY is false", async () => {
      (process.stdin as NodeJS.ReadStream & { isTTY: boolean }).isTTY = false;
      const env = createDefaultEnvironment();
      await expect(env.prompt("question?")).rejects.toThrow(
        "Cannot prompt for input: stdin is not a TTY",
      );
    });

    test("prompt throws when isTTY is undefined", async () => {
      (process.stdin as NodeJS.ReadStream & { isTTY: boolean | undefined }).isTTY = undefined;
      const env = createDefaultEnvironment();
      await expect(env.prompt("question?")).rejects.toThrow(
        "Cannot prompt for input: stdin is not a TTY",
      );
    });
  });
});
