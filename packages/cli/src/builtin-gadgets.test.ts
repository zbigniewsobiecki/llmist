import { HumanInputRequiredException, TaskCompletionSignal } from "llmist";
import { describe, expect, it } from "vitest";
import { askUser, finish, getBuiltinGadgets, tellUser } from "./builtin-gadgets.js";

// ─────────────────────────────────────────────────────────────────────────────
// askUser
// ─────────────────────────────────────────────────────────────────────────────

describe("askUser gadget", () => {
  it("throws HumanInputRequiredException with the provided question", () => {
    expect(() => askUser.execute({ question: "What is your name?" })).toThrow(
      HumanInputRequiredException,
    );
  });

  it("includes the question in the thrown exception message", () => {
    const question = "Which file would you like me to modify?";
    expect(() => askUser.execute({ question })).toThrow(question);
  });

  it("stores the question on the exception's question property", () => {
    const question = "Are you sure you want to proceed?";
    let caught: HumanInputRequiredException | null = null;
    try {
      askUser.execute({ question });
    } catch (e) {
      caught = e as HumanInputRequiredException;
    }
    expect(caught).not.toBeNull();
    expect(caught?.question).toBe(question);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tellUser
// ─────────────────────────────────────────────────────────────────────────────

describe("tellUser gadget", () => {
  describe("message prefixes by type", () => {
    it("prefixes info messages with ℹ️", () => {
      const result = tellUser.execute({ message: "Here is some info.", type: "info" });
      expect(result).toContain("ℹ️");
      expect(result).toContain("Here is some info.");
    });

    it("prefixes success messages with ✅", () => {
      const result = tellUser.execute({ message: "Task completed!", type: "success" });
      expect(result).toContain("✅");
      expect(result).toContain("Task completed!");
    });

    it("prefixes warning messages with ⚠️", () => {
      const result = tellUser.execute({ message: "Be careful.", type: "warning" });
      expect(result).toContain("⚠️");
      expect(result).toContain("Be careful.");
    });

    it("prefixes error messages with ❌", () => {
      const result = tellUser.execute({ message: "Something went wrong.", type: "error" });
      expect(result).toContain("❌");
      expect(result).toContain("Something went wrong.");
    });
  });

  describe("empty / missing message handling", () => {
    it("returns a fallback string when message is undefined", () => {
      // The schema defines message as optional, so undefined is valid.
      const result = tellUser.execute({ message: undefined, type: "info" });
      expect(typeof result).toBe("string");
      expect(result).toContain("TellUser was called without a message");
    });

    it("returns a fallback string when message is an empty string", () => {
      const result = tellUser.execute({ message: "", type: "info" });
      expect(typeof result).toBe("string");
      expect(result).toContain("TellUser was called without a message");
    });

    it("returns a fallback string when message is whitespace-only", () => {
      const result = tellUser.execute({ message: "   ", type: "info" });
      expect(typeof result).toBe("string");
      expect(result).toContain("TellUser was called without a message");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// finish
// ─────────────────────────────────────────────────────────────────────────────

describe("finish gadget", () => {
  it("throws TaskCompletionSignal", () => {
    expect(() => finish.execute({})).toThrow(TaskCompletionSignal);
  });

  it("includes a message in the thrown TaskCompletionSignal", () => {
    let caught: TaskCompletionSignal | null = null;
    try {
      finish.execute({});
    } catch (e) {
      caught = e as TaskCompletionSignal;
    }
    expect(caught).not.toBeNull();
    expect(caught?.message).toBeTruthy();
  });

  it("thrown error has name TaskCompletionSignal", () => {
    let caught: Error | null = null;
    try {
      finish.execute({});
    } catch (e) {
      caught = e as Error;
    }
    expect(caught?.name).toBe("TaskCompletionSignal");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getBuiltinGadgets
// ─────────────────────────────────────────────────────────────────────────────

describe("getBuiltinGadgets", () => {
  it("returns exactly 4 gadgets by default", () => {
    const gadgets = getBuiltinGadgets();
    expect(gadgets).toHaveLength(4);
  });

  it("returned array includes askUser gadget", () => {
    const gadgets = getBuiltinGadgets();
    const names = gadgets.map((g) => g.name);
    expect(names).toContain("AskUser");
  });

  it("returned array includes tellUser gadget", () => {
    const gadgets = getBuiltinGadgets();
    const names = gadgets.map((g) => g.name);
    expect(names).toContain("TellUser");
  });

  it("returned array includes finish gadget", () => {
    const gadgets = getBuiltinGadgets();
    const names = gadgets.map((g) => g.name);
    expect(names).toContain("Finish");
  });

  it("returned array includes TextToSpeech gadget as the fourth entry", () => {
    const gadgets = getBuiltinGadgets();
    const names = gadgets.map((g) => g.name);
    expect(names).toContain("TextToSpeech");
  });

  describe("with speechConfig", () => {
    it("returns 4 gadgets when speechConfig is provided", () => {
      const gadgets = getBuiltinGadgets({ model: "tts-1-hd", voice: "alloy" });
      expect(gadgets).toHaveLength(4);
    });

    it("applies speechConfig to the TextToSpeech gadget description", () => {
      const gadgets = getBuiltinGadgets({ voice: "onyx" });
      const tts = gadgets.find((g) => g.name === "TextToSpeech");
      expect(tts).toBeDefined();
      // The description mentions the configured voice
      expect(tts?.description).toContain("onyx");
    });

    it("without speechConfig TextToSpeech uses default voice nova", () => {
      const gadgets = getBuiltinGadgets();
      const tts = gadgets.find((g) => g.name === "TextToSpeech");
      expect(tts).toBeDefined();
      expect(tts?.description).toContain("nova");
    });

    it("without speechConfig TextToSpeech uses default format mp3", () => {
      const gadgets = getBuiltinGadgets();
      const tts = gadgets.find((g) => g.name === "TextToSpeech");
      expect(tts).toBeDefined();
      expect(tts?.description).toContain("mp3");
    });
  });
});
