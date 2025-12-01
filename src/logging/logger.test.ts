import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createLogger, type LoggerOptions } from "./logger.js";

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
