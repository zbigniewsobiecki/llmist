/**
 * CLI testing utilities for llmist.
 * Provides helpers for testing CLI commands without real I/O.
 */

import { PassThrough, Readable, Writable } from "node:stream";

/**
 * Options for creating a test environment.
 */
export interface TestEnvironmentOptions {
  /** Input to provide via stdin (string or line array) */
  stdin?: string | string[];
  /** Whether stdin is a TTY (default: false) */
  isTTY?: boolean;
  /** Environment variables to set */
  env?: Record<string, string>;
  /** Command line arguments (default: ["node", "llmist"]) */
  argv?: string[];
}

/**
 * A test environment with captured I/O streams.
 */
export interface TestEnvironment {
  /** Stdin readable stream */
  stdin: Readable;
  /** Stdout writable stream (PassThrough for capturing) */
  stdout: PassThrough;
  /** Stderr writable stream (PassThrough for capturing) */
  stderr: PassThrough;
  /** Whether stdin is TTY */
  isTTY: boolean;
  /** Command line arguments */
  argv: string[];
  /** Environment variables */
  env: Record<string, string>;
  /** Exit code if set */
  exitCode?: number;
  /** Function to set exit code */
  setExitCode: (code: number) => void;
}

/**
 * Create a test environment with mocked I/O streams.
 *
 * @param options - Configuration options
 * @returns A test environment with captured streams
 *
 * @example
 * ```typescript
 * const env = createTestEnvironment({
 *   stdin: '{"param": "value"}',
 *   isTTY: false
 * });
 *
 * // Pass to CLI command
 * await executeCommand(env);
 *
 * // Check output
 * const output = await collectOutput(env.stdout);
 * expect(output).toContain("Success");
 * ```
 */
export function createTestEnvironment(options: TestEnvironmentOptions = {}): TestEnvironment {
  const stdin = createMockReadable(options.stdin);
  const stdout = new PassThrough();
  const stderr = new PassThrough();

  let exitCode: number | undefined;

  return {
    stdin,
    stdout,
    stderr,
    isTTY: options.isTTY ?? false,
    argv: options.argv ?? ["node", "llmist"],
    env: { ...filterDefinedEnv(process.env), ...options.env },
    get exitCode() {
      return exitCode;
    },
    setExitCode: (code: number) => {
      exitCode = code;
    },
  };
}

/**
 * Create a readable stream from a string or array of lines.
 *
 * @param input - String content or array of lines
 * @returns A Readable stream
 *
 * @example
 * ```typescript
 * const stream = createMockReadable("line1\nline2\n");
 * // or
 * const stream = createMockReadable(["line1", "line2"]);
 * ```
 */
export function createMockReadable(input?: string | string[]): Readable {
  if (!input) {
    // Empty stream that ends immediately
    const stream = new Readable({ read() {} });
    stream.push(null);
    return stream;
  }

  const content = Array.isArray(input) ? `${input.join("\n")}\n` : input;

  const stream = new Readable({ read() {} });
  stream.push(content);
  stream.push(null);
  return stream;
}

/**
 * Create a writable stream that collects all written data.
 *
 * @returns A writable stream with getData() method
 */
export function createMockWritable(): Writable & { getData(): string } {
  const chunks: Buffer[] = [];

  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  }) as Writable & { getData(): string };

  stream.getData = () => Buffer.concat(chunks).toString("utf8");

  return stream;
}

/**
 * Collect all output from a PassThrough stream.
 * Waits for the stream to end before returning.
 *
 * @param stream - The stream to collect from
 * @param timeout - Maximum time to wait in ms (default: 5000)
 * @returns All data written to the stream
 *
 * @example
 * ```typescript
 * const output = await collectOutput(env.stdout);
 * expect(output).toContain("Expected text");
 * ```
 */
export async function collectOutput(stream: PassThrough, timeout = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    const timeoutId = setTimeout(() => {
      // Return what we have so far if timeout
      resolve(Buffer.concat(chunks).toString("utf8"));
    }, timeout);

    stream.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
    });

    stream.on("end", () => {
      clearTimeout(timeoutId);
      resolve(Buffer.concat(chunks).toString("utf8"));
    });

    stream.on("error", (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });
  });
}

/**
 * Collect output without waiting for stream end.
 * Returns immediately with whatever has been written.
 *
 * @param stream - The stream to read from
 * @returns Currently buffered data
 */
export function getBufferedOutput(stream: PassThrough): string {
  const chunks: Buffer[] = [];

  // Read all available data
  for (;;) {
    const chunk = stream.read() as Buffer | null;
    if (chunk === null) break;
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Create a mock prompt function for testing interactive input.
 *
 * @param responses - Array of responses to return in order
 * @returns A prompt function that returns the next response
 *
 * @example
 * ```typescript
 * const prompt = createMockPrompt(["yes", "no", "maybe"]);
 * expect(await prompt("Question 1?")).toBe("yes");
 * expect(await prompt("Question 2?")).toBe("no");
 * ```
 */
export function createMockPrompt(
  responses: string[],
): (question: string) => Promise<string> {
  let index = 0;

  return async (_question: string): Promise<string> => {
    if (index >= responses.length) {
      throw new Error(`Mock prompt exhausted: no response for question ${index + 1}`);
    }
    return responses[index++];
  };
}

/**
 * Mock prompt that records questions and returns configured responses.
 */
export class MockPromptRecorder {
  private responses: string[];
  private index = 0;
  private questions: string[] = [];

  constructor(responses: string[]) {
    this.responses = responses;
  }

  /**
   * The prompt function to use in tests.
   */
  prompt = async (question: string): Promise<string> => {
    this.questions.push(question);
    if (this.index >= this.responses.length) {
      throw new Error(`Mock prompt exhausted after ${this.index} questions`);
    }
    return this.responses[this.index++];
  };

  /**
   * Get all questions that were asked.
   */
  getQuestions(): string[] {
    return [...this.questions];
  }

  /**
   * Get the number of questions asked.
   */
  getQuestionCount(): number {
    return this.questions.length;
  }

  /**
   * Reset the recorder state.
   */
  reset(newResponses?: string[]): void {
    this.index = 0;
    this.questions = [];
    if (newResponses) {
      this.responses = newResponses;
    }
  }
}

/**
 * Wait for a condition to be true, with timeout.
 * Useful for async testing scenarios.
 *
 * @param condition - Function that returns true when condition is met
 * @param timeout - Maximum time to wait in ms (default: 5000)
 * @param interval - Check interval in ms (default: 50)
 */
export async function waitFor(
  condition: () => boolean,
  timeout = 5000,
  interval = 50,
): Promise<void> {
  const startTime = Date.now();

  while (!condition()) {
    if (Date.now() - startTime > timeout) {
      throw new Error(`waitFor timed out after ${timeout}ms`);
    }
    await sleep(interval);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function filterDefinedEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}
