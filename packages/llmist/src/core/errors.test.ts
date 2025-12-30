import { describe, expect, it } from "vitest";

import { isAbortError } from "./errors.js";

describe("isAbortError", () => {
  describe("returns false for non-Error values", () => {
    it("returns false for null", () => {
      expect(isAbortError(null)).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(isAbortError(undefined)).toBe(false);
    });

    it("returns false for strings", () => {
      expect(isAbortError("abort")).toBe(false);
      expect(isAbortError("AbortError")).toBe(false);
    });

    it("returns false for plain objects", () => {
      expect(isAbortError({ name: "AbortError" })).toBe(false);
      expect(isAbortError({ message: "aborted" })).toBe(false);
    });

    it("returns false for numbers", () => {
      expect(isAbortError(42)).toBe(false);
    });
  });

  describe("detects standard AbortError", () => {
    it("returns true for AbortError by name", () => {
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      expect(isAbortError(error)).toBe(true);
    });

    it("returns true for DOMException AbortError", () => {
      // DOMException with AbortError name (common in browsers/fetch)
      const error = new DOMException("signal is aborted", "AbortError");
      expect(isAbortError(error)).toBe(true);
    });
  });

  describe("detects Anthropic SDK abort errors", () => {
    it("returns true for APIConnectionAbortedError", () => {
      const error = new Error("Connection aborted");
      error.name = "APIConnectionAbortedError";
      expect(isAbortError(error)).toBe(true);
    });
  });

  describe("detects OpenAI SDK abort errors", () => {
    it("returns true for APIUserAbortError", () => {
      const error = new Error("Request aborted by user");
      error.name = "APIUserAbortError";
      expect(isAbortError(error)).toBe(true);
    });
  });

  describe("detects abort errors by message", () => {
    it("returns true when message contains 'abort'", () => {
      const error = new Error("The request was aborted by the user");
      expect(isAbortError(error)).toBe(true);
    });

    it("returns true when message contains 'cancelled' (British spelling)", () => {
      const error = new Error("Operation cancelled");
      expect(isAbortError(error)).toBe(true);
    });

    it("returns true when message contains 'canceled' (American spelling)", () => {
      const error = new Error("Operation canceled");
      expect(isAbortError(error)).toBe(true);
    });

    it("is case-insensitive for message matching", () => {
      expect(isAbortError(new Error("ABORT"))).toBe(true);
      expect(isAbortError(new Error("Cancelled"))).toBe(true);
      expect(isAbortError(new Error("CANCELED"))).toBe(true);
    });
  });

  describe("returns false for generic errors", () => {
    it("returns false for generic Error", () => {
      const error = new Error("Something went wrong");
      expect(isAbortError(error)).toBe(false);
    });

    it("returns false for TypeError", () => {
      const error = new TypeError("Cannot read property of undefined");
      expect(isAbortError(error)).toBe(false);
    });

    it("returns false for network errors without abort indicators", () => {
      const error = new Error("Network request failed");
      expect(isAbortError(error)).toBe(false);
    });

    it("returns false for timeout errors without abort indicators", () => {
      const error = new Error("Request timed out");
      expect(isAbortError(error)).toBe(false);
    });
  });
});
