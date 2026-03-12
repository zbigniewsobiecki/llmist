import { PassThrough, Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  collectOutput,
  createMockPrompt,
  createMockReadable,
  createMockWritable,
  createTestEnvironment,
  getBufferedOutput,
  MockPromptRecorder,
  waitFor,
} from "./cli-helpers.js";

describe("cli-helpers", () => {
  describe("createTestEnvironment()", () => {
    it("creates a default test environment", () => {
      const env = createTestEnvironment();

      expect(env.stdin).toBeInstanceOf(Readable);
      expect(env.stdout).toBeInstanceOf(PassThrough);
      expect(env.stderr).toBeInstanceOf(PassThrough);
      expect(env.isTTY).toBe(false);
      expect(env.argv).toEqual(["node", "llmist"]);
      expect(env.env).toBeDefined();
      expect(env.exitCode).toBeUndefined();
    });

    it("respects provided options", () => {
      const customArgv = ["custom", "args"];
      const customEnv = { TEST_VAR: "value" };
      const env = createTestEnvironment({
        isTTY: true,
        argv: customArgv,
        env: customEnv,
      });

      expect(env.isTTY).toBe(true);
      expect(env.argv).toEqual(customArgv);
      expect(env.env.TEST_VAR).toBe("value");
      // Original env should also be there
      expect(env.env.PATH).toBeDefined();
    });

    it("handles exit code", () => {
      const env = createTestEnvironment();
      expect(env.exitCode).toBeUndefined();

      env.setExitCode(1);
      expect(env.exitCode).toBe(1);

      env.setExitCode(0);
      expect(env.exitCode).toBe(0);
    });
  });

  describe("createMockReadable()", () => {
    it("creates an empty stream when no input is provided", async () => {
      const stream = createMockReadable();
      const chunks: string[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk.toString());
      }
      expect(chunks).toEqual([]);
    });

    it("creates a stream from a string", async () => {
      const input = "test input";
      const stream = createMockReadable(input);
      let output = "";
      for await (const chunk of stream) {
        output += chunk.toString();
      }
      expect(output).toBe(input);
    });

    it("creates a stream from an array of strings", async () => {
      const input = ["line 1", "line 2"];
      const stream = createMockReadable(input);
      let output = "";
      for await (const chunk of stream) {
        output += chunk.toString();
      }
      expect(output).toBe("line 1\nline 2\n");
    });
  });

  describe("createMockWritable()", () => {
    it("collects written data", () => {
      const writable = createMockWritable();
      writable.write("hello ");
      writable.write("world");
      expect(writable.getData()).toBe("hello world");
    });
  });

  describe("collectOutput()", () => {
    it("collects all output until the stream ends", async () => {
      const stream = new PassThrough();
      const outputPromise = collectOutput(stream);

      stream.write("part 1");
      stream.write(" part 2");
      stream.end();

      const output = await outputPromise;
      expect(output).toBe("part 1 part 2");
    });

    it("resolves with what it has after a timeout", async () => {
      const stream = new PassThrough();
      // Use a short timeout for the test
      const outputPromise = collectOutput(stream, 100);

      stream.write("timed out");
      // Don't call end()

      const output = await outputPromise;
      expect(output).toBe("timed out");
    });

    it("rejects on stream error", async () => {
      const stream = new PassThrough();
      const outputPromise = collectOutput(stream);

      stream.emit("error", new Error("stream error"));

      await expect(outputPromise).rejects.toThrow("stream error");
    });
  });

  describe("getBufferedOutput()", () => {
    it("reads currently buffered data without ending the stream", () => {
      const stream = new PassThrough();
      stream.write("buffered data");

      const output = getBufferedOutput(stream);
      expect(output).toBe("buffered data");

      // Stream is still open and we can write more
      stream.write(" more data");
      expect(getBufferedOutput(stream)).toBe(" more data");
    });

    it("returns empty string if nothing is buffered", () => {
      const stream = new PassThrough();
      expect(getBufferedOutput(stream)).toBe("");
    });
  });

  describe("createMockPrompt()", () => {
    it("returns responses in order", async () => {
      const prompt = createMockPrompt(["yes", "no"]);
      expect(await prompt("Question 1?")).toBe("yes");
      expect(await prompt("Question 2?")).toBe("no");
    });

    it("throws when responses are exhausted", async () => {
      const prompt = createMockPrompt(["yes"]);
      await prompt("Question 1?");
      await expect(prompt("Question 2?")).rejects.toThrow("Mock prompt exhausted");
    });
  });

  describe("MockPromptRecorder", () => {
    it("records questions and returns responses", async () => {
      const recorder = new MockPromptRecorder(["res 1", "res 2"]);
      expect(recorder.getQuestionCount()).toBe(0);

      const r1 = await recorder.prompt("q 1");
      expect(r1).toBe("res 1");
      expect(recorder.getQuestionCount()).toBe(1);
      expect(recorder.getQuestions()).toEqual(["q 1"]);

      const r2 = await recorder.prompt("q 2");
      expect(r2).toBe("res 2");
      expect(recorder.getQuestions()).toEqual(["q 1", "q 2"]);
    });

    it("throws when responses are exhausted", async () => {
      const recorder = new MockPromptRecorder(["res 1"]);
      await recorder.prompt("q 1");
      await expect(recorder.prompt("q 2")).rejects.toThrow("Mock prompt exhausted");
    });

    it("resets state", async () => {
      const recorder = new MockPromptRecorder(["res 1"]);
      await recorder.prompt("q 1");
      expect(recorder.getQuestionCount()).toBe(1);

      recorder.reset(["new res"]);
      expect(recorder.getQuestionCount()).toBe(0);
      expect(recorder.getQuestions()).toEqual([]);

      const r = await recorder.prompt("new q");
      expect(r).toBe("new res");
    });
  });

  describe("waitFor()", () => {
    it("resolves when condition becomes true", async () => {
      let condition = false;
      setTimeout(() => {
        condition = true;
      }, 50);

      await waitFor(() => condition, 200, 10);
      expect(condition).toBe(true);
    });

    it("throws on timeout", async () => {
      const condition = false;
      await expect(waitFor(() => condition, 100, 10)).rejects.toThrow("waitFor timed out");
    });
  });
});
