import { z } from "zod";
import type { LLMStream, LLMStreamChunk } from "llmist";
import { HumanInputRequiredException } from "llmist";
import { Gadget } from "llmist";

/**
 * Mock gadget that returns a simple result
 */
export class TestGadget extends Gadget({
  name: "TestGadget",
  description: "A test gadget that echoes parameters",
  schema: z.object({
    message: z.string().describe("Message to echo").optional(),
  }),
}) {
  execute(params: this["params"]): string {
    return `Echo: ${params.message ?? "no message"}`;
  }
}

/**
 * Mock gadget that throws an error
 */
export class ErrorGadget extends Gadget({
  name: "ErrorGadget",
  description: "A gadget that always throws an error",
  schema: z.object({}),
}) {
  execute(): string {
    throw new Error("Intentional error from ErrorGadget");
  }
}

/**
 * Mock async gadget
 */
export class AsyncGadget extends Gadget({
  name: "AsyncGadget",
  description: "An async gadget with configurable delay",
  schema: z.object({
    delay: z.number().int().nonnegative().default(0).describe("Delay in milliseconds"),
    result: z.string().describe("Result to return"),
  }),
}) {
  async execute(params: this["params"]): Promise<string> {
    const delay = params.delay ?? 0;
    await new Promise((resolve) => setTimeout(resolve, delay));
    return `Async result: ${params.result ?? "done"}`;
  }
}

/**
 * Mock gadget for math operations
 */
export class MathGadget extends Gadget({
  name: "MathGadget",
  description: "Performs math operations",
  schema: z.object({
    operation: z.enum(["add", "multiply"]).describe("add or multiply"),
    a: z.number().describe("First number"),
    b: z.number().describe("Second number"),
  }),
}) {
  execute(params: this["params"]): string {
    const { a, b, operation } = params;

    if (operation === "add") {
      return String(a + b);
    } else if (operation === "multiply") {
      return String(a * b);
    }

    throw new Error(`Unknown operation: ${operation}`);
  }
}

/**
 * Mock gadget that requests human input
 */
export class AskUserGadget extends Gadget({
  name: "AskUser",
  description: "Ask the user a question and get their answer",
  schema: z.object({
    question: z.string().min(1).describe("Question to ask the user"),
  }),
}) {
  execute(params: this["params"]): string {
    throw new HumanInputRequiredException(params.question);
  }
}

/**
 * Creates a mock LLM stream from text chunks
 */
export async function* createMockStream(chunks: string[]): LLMStream {
  for (const text of chunks) {
    yield { text };
  }
  yield { text: "", finishReason: "stop" };
}

/**
 * Creates a mock stream with gadget calls embedded
 */
export async function* createGadgetStream(chunks: LLMStreamChunk[]): LLMStream {
  for (const chunk of chunks) {
    yield chunk;
  }
}

/**
 * Sample gadget invocation text
 */
export const SAMPLE_GADGET_CALL = `!!!GADGET_START:TestGadget:123
message: Hello World
!!!GADGET_END:TestGadget:123`;

/**
 * Sample text with multiple gadgets
 */
export const SAMPLE_MULTIPLE_GADGETS = `Let me help you.
!!!GADGET_START:MathGadget:001
operation: add
a: 5
b: 3
!!!GADGET_END:MathGadget:001
Now let's multiply.
!!!GADGET_START:MathGadget:002
operation: multiply
a: 8
b: 7
!!!GADGET_END:MathGadget:002
Done!`;

/**
 * Sample incomplete gadget (missing end marker)
 */
export const SAMPLE_INCOMPLETE_GADGET = `!!!GADGET_START:TestGadget:999
message: incomplete`;

/**
 * Sample invalid YAML
 */
export const SAMPLE_INVALID_YAML = `!!!GADGET_START:TestGadget:555
invalid: [yaml: content
!!!GADGET_END:TestGadget:555`;

/**
 * Collects all events from an async generator into an array
 */
export async function collectEvents<T>(generator: AsyncGenerator<T>): Promise<T[]> {
  const events: T[] = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

/**
 * Collects all events from a sync generator into an array
 */
export function collectSyncEvents<T>(generator: Generator<T>): T[] {
  const events: T[] = [];
  for (const event of generator) {
    events.push(event);
  }
  return events;
}
