/**
 * Runtime validators for hook action types.
 *
 * These validators ensure that controllers return valid action objects,
 * catching common mistakes like missing required fields.
 */

import type {
  AfterGadgetExecutionAction,
  AfterLLMCallAction,
  AfterLLMErrorAction,
  BeforeGadgetExecutionAction,
  BeforeLLMCallAction,
} from "./hooks.js";

export class HookValidationError extends Error {
  constructor(hookName: string, message: string) {
    super(`Invalid action from ${hookName}: ${message}`);
    this.name = "HookValidationError";
  }
}

/**
 * Validate beforeLLMCall action.
 */
export function validateBeforeLLMCallAction(action: BeforeLLMCallAction): void {
  if (!action || typeof action !== "object" || !("action" in action)) {
    throw new HookValidationError(
      "beforeLLMCall",
      "Must return an action object with an 'action' field",
    );
  }

  const actionType = action.action;
  if (actionType !== "proceed" && actionType !== "skip") {
    throw new HookValidationError(
      "beforeLLMCall",
      `Invalid action type: ${actionType}. Must be 'proceed' or 'skip'`,
    );
  }

  if (actionType === "skip" && !action.syntheticResponse) {
    throw new HookValidationError(
      "beforeLLMCall",
      "When action is 'skip', syntheticResponse is required",
    );
  }
}

/**
 * Validate afterLLMCall action.
 */
export function validateAfterLLMCallAction(action: AfterLLMCallAction): void {
  if (!action || typeof action !== "object" || !("action" in action)) {
    throw new HookValidationError(
      "afterLLMCall",
      "Must return an action object with an 'action' field",
    );
  }

  const actionType = action.action;
  const validActions = ["continue", "append_messages", "modify_and_continue", "append_and_modify"];
  if (!validActions.includes(actionType)) {
    throw new HookValidationError(
      "afterLLMCall",
      `Invalid action type: ${actionType}. Must be one of: ${validActions.join(", ")}`,
    );
  }

  if (actionType === "append_messages" || actionType === "append_and_modify") {
    if (!("messages" in action) || !action.messages || !Array.isArray(action.messages)) {
      throw new HookValidationError(
        "afterLLMCall",
        `When action is '${actionType}', messages array is required`,
      );
    }

    if (action.messages.length === 0) {
      throw new HookValidationError(
        "afterLLMCall",
        `When action is '${actionType}', messages array must not be empty`,
      );
    }

    // Validate each message
    for (let i = 0; i < action.messages.length; i++) {
      const msg = action.messages[i];
      if (!msg || typeof msg !== "object") {
        throw new HookValidationError("afterLLMCall", `Message at index ${i} must be an object`);
      }
      if (!msg.role || !msg.content) {
        throw new HookValidationError(
          "afterLLMCall",
          `Message at index ${i} must have 'role' and 'content' fields`,
        );
      }
      if (!["system", "user", "assistant"].includes(msg.role)) {
        throw new HookValidationError(
          "afterLLMCall",
          `Message at index ${i} has invalid role: ${msg.role}`,
        );
      }
    }
  }

  if (actionType === "modify_and_continue" || actionType === "append_and_modify") {
    if (!("modifiedMessage" in action) || !action.modifiedMessage) {
      throw new HookValidationError(
        "afterLLMCall",
        `When action is '${actionType}', modifiedMessage is required`,
      );
    }
  }
}

/**
 * Validate afterLLMError action.
 */
export function validateAfterLLMErrorAction(action: AfterLLMErrorAction): void {
  if (!action || typeof action !== "object" || !("action" in action)) {
    throw new HookValidationError(
      "afterLLMError",
      "Must return an action object with an 'action' field",
    );
  }

  const actionType = action.action;
  if (actionType !== "rethrow" && actionType !== "recover") {
    throw new HookValidationError(
      "afterLLMError",
      `Invalid action type: ${actionType}. Must be 'rethrow' or 'recover'`,
    );
  }

  if (actionType === "recover" && !action.fallbackResponse) {
    throw new HookValidationError(
      "afterLLMError",
      "When action is 'recover', fallbackResponse is required",
    );
  }
}

/**
 * Validate beforeGadgetExecution action.
 */
export function validateBeforeGadgetExecutionAction(action: BeforeGadgetExecutionAction): void {
  if (!action || typeof action !== "object" || !("action" in action)) {
    throw new HookValidationError(
      "beforeGadgetExecution",
      "Must return an action object with an 'action' field",
    );
  }

  const actionType = action.action;
  if (actionType !== "proceed" && actionType !== "skip") {
    throw new HookValidationError(
      "beforeGadgetExecution",
      `Invalid action type: ${actionType}. Must be 'proceed' or 'skip'`,
    );
  }

  if (actionType === "skip" && !action.syntheticResult) {
    throw new HookValidationError(
      "beforeGadgetExecution",
      "When action is 'skip', syntheticResult is required",
    );
  }
}

/**
 * Validate afterGadgetExecution action.
 */
export function validateAfterGadgetExecutionAction(action: AfterGadgetExecutionAction): void {
  if (!action || typeof action !== "object" || !("action" in action)) {
    throw new HookValidationError(
      "afterGadgetExecution",
      "Must return an action object with an 'action' field",
    );
  }

  const actionType = action.action;
  if (actionType !== "continue" && actionType !== "recover") {
    throw new HookValidationError(
      "afterGadgetExecution",
      `Invalid action type: ${actionType}. Must be 'continue' or 'recover'`,
    );
  }

  if (actionType === "recover" && !action.fallbackResult) {
    throw new HookValidationError(
      "afterGadgetExecution",
      "When action is 'recover', fallbackResult is required",
    );
  }
}
