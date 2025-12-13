/**
 * Signal that a gadget throws to indicate task completion and agent termination.
 *
 * When a gadget throws this signal, the agent loop will:
 * 1. Complete the current iteration
 * 2. Return the signal message as the gadget's result
 * 3. Exit the loop instead of continuing to the next iteration
 *
 * @example
 * ```typescript
 * import { z } from 'zod';
 *
 * class FinishGadget extends Gadget({
 *   name: 'Finish',
 *   description: 'Signals task completion',
 *   schema: z.object({
 *     message: z.string().optional(),
 *   }),
 * }) {
 *   execute(params: this['params']): string {
 *     const message = params.message || 'Task completed';
 *     throw new TaskCompletionSignal(message);
 *   }
 * }
 * ```
 */
export class TaskCompletionSignal extends Error {
  constructor(message?: string) {
    super(message ?? "Agent loop terminated by gadget");
    this.name = "TaskCompletionSignal";
  }
}

/**
 * Exception that gadgets can throw to request human input during execution.
 *
 * When a gadget throws this exception, the agent loop will:
 * 1. Pause execution and wait for human input
 * 2. If `requestHumanInput` callback is provided, call it and await the answer
 * 3. Return the user's answer as the gadget's result
 * 4. Continue the loop with the answer added to conversation history
 *
 * If no callback is provided, the loop will yield a `human_input_required` event
 * and the caller must handle it externally.
 *
 * @example
 * ```typescript
 * import { z } from 'zod';
 *
 * class AskUserGadget extends Gadget({
 *   name: 'AskUser',
 *   description: 'Ask the user a question and get their answer',
 *   schema: z.object({
 *     question: z.string().min(1, 'Question is required'),
 *   }),
 * }) {
 *   execute(params: this['params']): string {
 *     throw new HumanInputRequiredException(params.question);
 *   }
 * }
 * ```
 */
export class HumanInputRequiredException extends Error {
  public readonly question: string;

  constructor(question: string) {
    super(`Human input required: ${question}`);
    this.name = "HumanInputRequiredException";
    this.question = question;
  }
}

/**
 * Exception thrown when a gadget execution exceeds its timeout limit.
 *
 * When a gadget's execution time exceeds either:
 * - The gadget's own `timeoutMs` property, or
 * - The global `defaultGadgetTimeoutMs` configured in runtime/agent loop options
 *
 * The executor will automatically throw this exception and return it as an error.
 *
 * @example
 * ```typescript
 * import { z } from 'zod';
 *
 * class SlowApiGadget extends Gadget({
 *   name: 'SlowApi',
 *   description: 'Calls a slow external API',
 *   timeoutMs: 5000, // 5 second timeout
 *   schema: z.object({
 *     endpoint: z.string(),
 *   }),
 * }) {
 *   async execute(params: this['params']): Promise<string> {
 *     // If this takes longer than 5 seconds, execution will be aborted
 *     const response = await fetch(params.endpoint);
 *     return await response.text();
 *   }
 * }
 * ```
 */
export class TimeoutException extends Error {
  public readonly timeoutMs: number;
  public readonly gadgetName: string;

  constructor(gadgetName: string, timeoutMs: number) {
    super(`Gadget '${gadgetName}' execution exceeded timeout of ${timeoutMs}ms`);
    this.name = "TimeoutException";
    this.gadgetName = gadgetName;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Exception thrown when gadget execution is aborted.
 *
 * Gadgets can throw this exception when they detect the abort signal has been
 * triggered. This is typically used via the `throwIfAborted()` helper method
 * on the Gadget base class.
 *
 * @example
 * ```typescript
 * class LongRunningGadget extends Gadget({
 *   name: 'LongRunning',
 *   description: 'Performs a long operation with checkpoints',
 *   schema: z.object({ data: z.string() }),
 * }) {
 *   async execute(params: this['params'], ctx: ExecutionContext): Promise<string> {
 *     // Check at key points - throws AbortException if aborted
 *     this.throwIfAborted(ctx);
 *
 *     await this.doPartOne(params.data);
 *
 *     this.throwIfAborted(ctx);
 *
 *     await this.doPartTwo(params.data);
 *
 *     return 'completed';
 *   }
 * }
 * ```
 */
export class AbortException extends Error {
  constructor(message?: string) {
    super(message || "Gadget execution was aborted");
    this.name = "AbortException";
  }
}

