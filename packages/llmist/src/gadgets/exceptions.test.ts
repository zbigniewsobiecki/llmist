import { describe, expect, it } from "vitest";

import {
  AbortException,
  HumanInputRequiredException,
  TaskCompletionSignal,
  TimeoutException,
} from "./exceptions.js";

describe("TaskCompletionSignal", () => {
  it("creates with custom message", () => {
    const exception = new TaskCompletionSignal("Task completed successfully");

    expect(exception.message).toBe("Task completed successfully");
  });

  it("creates with default message when no message provided", () => {
    const exception = new TaskCompletionSignal();

    expect(exception.message).toBe("Agent loop terminated by gadget");
  });

  it("creates with default message when undefined passed", () => {
    const exception = new TaskCompletionSignal(undefined);

    expect(exception.message).toBe("Agent loop terminated by gadget");
  });

  it("has correct name property", () => {
    const exception = new TaskCompletionSignal();

    // TaskCompletionSignal is now a deprecated alias for TaskCompletionSignal
    expect(exception.name).toBe("TaskCompletionSignal");
  });

  it("is instanceof Error", () => {
    const exception = new TaskCompletionSignal();

    expect(exception).toBeInstanceOf(Error);
  });

  it("has a stack trace", () => {
    const exception = new TaskCompletionSignal();

    expect(exception.stack).toBeDefined();
    // Stack trace contains the actual class name
    expect(exception.stack).toContain("TaskCompletionSignal");
  });
});

describe("HumanInputRequiredException", () => {
  it("creates with question", () => {
    const exception = new HumanInputRequiredException("What is your name?");

    expect(exception.question).toBe("What is your name?");
  });

  it("has correct message format", () => {
    const exception = new HumanInputRequiredException("What is your name?");

    expect(exception.message).toBe("Human input required: What is your name?");
  });

  it("has correct name property", () => {
    const exception = new HumanInputRequiredException("test");

    // HumanInputRequiredException is now a deprecated alias for HumanInputRequiredException
    expect(exception.name).toBe("HumanInputRequiredException");
  });

  it("is instanceof Error", () => {
    const exception = new HumanInputRequiredException("test");

    expect(exception).toBeInstanceOf(Error);
  });

  it("stores the question property separately from message", () => {
    const question = "Do you want to continue?";
    const exception = new HumanInputRequiredException(question);

    expect(exception.question).toBe(question);
    expect(exception.message).toContain(question);
    expect(exception.message).not.toBe(question);
  });

  it("handles empty question", () => {
    const exception = new HumanInputRequiredException("");

    expect(exception.question).toBe("");
    expect(exception.message).toBe("Human input required: ");
  });

  it("handles question with special characters", () => {
    const question = "Are you sure? (yes/no)";
    const exception = new HumanInputRequiredException(question);

    expect(exception.question).toBe(question);
    expect(exception.message).toBe(`Human input required: ${question}`);
  });
});

describe("TimeoutException", () => {
  it("creates with gadgetName and timeoutMs", () => {
    const exception = new TimeoutException("SlowGadget", 5000);

    expect(exception.gadgetName).toBe("SlowGadget");
    expect(exception.timeoutMs).toBe(5000);
  });

  it("has correct message format", () => {
    const exception = new TimeoutException("FetchData", 10000);

    expect(exception.message).toBe("Gadget 'FetchData' execution exceeded timeout of 10000ms");
  });

  it("has correct name property", () => {
    const exception = new TimeoutException("test", 1000);

    expect(exception.name).toBe("TimeoutException");
  });

  it("is instanceof Error", () => {
    const exception = new TimeoutException("test", 1000);

    expect(exception).toBeInstanceOf(Error);
  });

  it("stores gadgetName property", () => {
    const exception = new TimeoutException("MyGadget", 3000);

    expect(exception.gadgetName).toBe("MyGadget");
  });

  it("stores timeoutMs property", () => {
    const exception = new TimeoutException("MyGadget", 7500);

    expect(exception.timeoutMs).toBe(7500);
  });

  it("handles zero timeout", () => {
    const exception = new TimeoutException("InstantGadget", 0);

    expect(exception.timeoutMs).toBe(0);
    expect(exception.message).toBe("Gadget 'InstantGadget' execution exceeded timeout of 0ms");
  });

  it("handles very large timeout values", () => {
    const exception = new TimeoutException("LongRunning", 600000);

    expect(exception.timeoutMs).toBe(600000);
    expect(exception.message).toContain("600000ms");
  });

  it("handles gadget names with special characters", () => {
    const exception = new TimeoutException("My-Gadget_v2", 1000);

    expect(exception.gadgetName).toBe("My-Gadget_v2");
    expect(exception.message).toContain("'My-Gadget_v2'");
  });
});

describe("AbortException", () => {
  it("creates with custom message", () => {
    const exception = new AbortException("Custom abort message");

    expect(exception.message).toBe("Custom abort message");
  });

  it("creates with default message when no message provided", () => {
    const exception = new AbortException();

    expect(exception.message).toBe("Gadget execution was aborted");
  });

  it("has correct name property", () => {
    const exception = new AbortException();

    // AbortException is now a deprecated alias for AbortException
    expect(exception.name).toBe("AbortException");
  });

  it("is instanceof Error", () => {
    const exception = new AbortException();

    expect(exception).toBeInstanceOf(Error);
  });

  it("has a stack trace", () => {
    const exception = new AbortException();

    expect(exception.stack).toBeDefined();
    // Stack trace contains the actual class name
    expect(exception.stack).toContain("AbortException");
  });

  it("handles empty message by using default", () => {
    const exception = new AbortException("");

    // Empty string should fall back to default message
    expect(exception.message).toBe("Gadget execution was aborted");
  });

  it("handles undefined message by using default", () => {
    const exception = new AbortException(undefined);

    expect(exception.message).toBe("Gadget execution was aborted");
  });

  it("handles message with special characters", () => {
    const message = "Aborted: timeout (30s) exceeded!";
    const exception = new AbortException(message);

    expect(exception.message).toBe(message);
  });
});
