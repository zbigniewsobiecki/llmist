import { describe, expect, it } from "bun:test";
import {
  DEFAULT_RETRY_CONFIG,
  formatLLMError,
  isRetryableError,
  resolveRetryConfig,
  type RetryConfig,
} from "./retry.js";

describe("retry configuration", () => {
  describe("DEFAULT_RETRY_CONFIG", () => {
    it("should have sensible defaults", () => {
      expect(DEFAULT_RETRY_CONFIG).toEqual({
        enabled: true,
        retries: 3,
        minTimeout: 1000,
        maxTimeout: 30000,
        factor: 2,
        randomize: true,
      });
    });
  });

  describe("resolveRetryConfig", () => {
    it("should return defaults when no config provided", () => {
      const resolved = resolveRetryConfig();
      expect(resolved.enabled).toBe(true);
      expect(resolved.retries).toBe(3);
      expect(resolved.minTimeout).toBe(1000);
      expect(resolved.maxTimeout).toBe(30000);
      expect(resolved.factor).toBe(2);
      expect(resolved.randomize).toBe(true);
      expect(resolved.onRetry).toBeUndefined();
      expect(resolved.onRetriesExhausted).toBeUndefined();
      expect(resolved.shouldRetry).toBeUndefined();
    });

    it("should return defaults when empty config provided", () => {
      const resolved = resolveRetryConfig({});
      expect(resolved.enabled).toBe(true);
      expect(resolved.retries).toBe(3);
    });

    it("should override defaults with provided values", () => {
      const config: RetryConfig = {
        retries: 5,
        minTimeout: 2000,
        maxTimeout: 60000,
        factor: 3,
        randomize: false,
      };
      const resolved = resolveRetryConfig(config);
      expect(resolved.retries).toBe(5);
      expect(resolved.minTimeout).toBe(2000);
      expect(resolved.maxTimeout).toBe(60000);
      expect(resolved.factor).toBe(3);
      expect(resolved.randomize).toBe(false);
      // Defaults still applied
      expect(resolved.enabled).toBe(true);
    });

    it("should preserve callback functions", () => {
      const onRetry = (_error: Error, _attempt: number) => {};
      const onRetriesExhausted = (_error: Error, _attempts: number) => {};
      const shouldRetry = (_error: Error) => true;

      const resolved = resolveRetryConfig({
        onRetry,
        onRetriesExhausted,
        shouldRetry,
      });

      expect(resolved.onRetry).toBe(onRetry);
      expect(resolved.onRetriesExhausted).toBe(onRetriesExhausted);
      expect(resolved.shouldRetry).toBe(shouldRetry);
    });

    it("should allow disabling retry", () => {
      const resolved = resolveRetryConfig({ enabled: false });
      expect(resolved.enabled).toBe(false);
    });
  });

  describe("isRetryableError", () => {
    // Rate limit errors (429)
    it("should retry 429 errors", () => {
      expect(isRetryableError(new Error("Request failed with status 429"))).toBe(true);
      expect(isRetryableError(new Error("Rate limit exceeded"))).toBe(true);
      expect(isRetryableError(new Error("rate_limit_error"))).toBe(true);
    });

    // Server errors (5xx)
    it("should retry 500 errors", () => {
      expect(isRetryableError(new Error("Internal server error 500"))).toBe(true);
      expect(isRetryableError(new Error("Internal Server Error"))).toBe(true);
    });

    it("should retry 502 errors", () => {
      expect(isRetryableError(new Error("Bad gateway 502"))).toBe(true);
      expect(isRetryableError(new Error("Bad Gateway"))).toBe(true);
    });

    it("should retry 503 errors", () => {
      expect(isRetryableError(new Error("Service unavailable 503"))).toBe(true);
      expect(isRetryableError(new Error("Service Unavailable"))).toBe(true);
    });

    it("should retry 504 errors", () => {
      expect(isRetryableError(new Error("Gateway timeout 504"))).toBe(true);
      expect(isRetryableError(new Error("Gateway Timeout"))).toBe(true);
    });

    // Timeout errors
    it("should retry timeout errors", () => {
      expect(isRetryableError(new Error("Request timeout"))).toBe(true);
      expect(isRetryableError(new Error("ETIMEDOUT"))).toBe(true);
      expect(isRetryableError(new Error("Connection timed out"))).toBe(true);
    });

    // Connection errors
    it("should retry connection errors", () => {
      expect(isRetryableError(new Error("ECONNRESET"))).toBe(true);
      expect(isRetryableError(new Error("ECONNREFUSED"))).toBe(true);
      expect(isRetryableError(new Error("ENOTFOUND"))).toBe(true);
      expect(isRetryableError(new Error("Connection refused"))).toBe(true);
      expect(isRetryableError(new Error("Network error"))).toBe(true);
    });

    // Provider-specific errors
    it("should retry provider-specific errors by name", () => {
      const apiConnectionError = new Error("Connection failed");
      apiConnectionError.name = "APIConnectionError";
      expect(isRetryableError(apiConnectionError)).toBe(true);

      const rateLimitError = new Error("Too many requests");
      rateLimitError.name = "RateLimitError";
      expect(isRetryableError(rateLimitError)).toBe(true);

      const internalServerError = new Error("Server error");
      internalServerError.name = "InternalServerError";
      expect(isRetryableError(internalServerError)).toBe(true);

      const serviceUnavailableError = new Error("Service down");
      serviceUnavailableError.name = "ServiceUnavailableError";
      expect(isRetryableError(serviceUnavailableError)).toBe(true);

      const apiTimeoutError = new Error("Timed out");
      apiTimeoutError.name = "APITimeoutError";
      expect(isRetryableError(apiTimeoutError)).toBe(true);
    });

    // Overloaded errors (Claude-specific)
    it("should retry overloaded errors", () => {
      expect(isRetryableError(new Error("API is overloaded"))).toBe(true);
      expect(isRetryableError(new Error("At capacity, please retry"))).toBe(true);
    });

    // Non-retryable errors
    it("should NOT retry authentication errors", () => {
      expect(isRetryableError(new Error("401 Unauthorized"))).toBe(false);
      expect(isRetryableError(new Error("Authentication failed"))).toBe(false);
      expect(isRetryableError(new Error("Invalid API key"))).toBe(false);
    });

    it("should NOT retry permission errors", () => {
      expect(isRetryableError(new Error("403 Forbidden"))).toBe(false);
    });

    it("should NOT retry bad request errors", () => {
      expect(isRetryableError(new Error("400 Bad Request"))).toBe(false);
      expect(isRetryableError(new Error("Invalid request"))).toBe(false);
    });

    it("should NOT retry not found errors", () => {
      expect(isRetryableError(new Error("404 Not Found"))).toBe(false);
    });

    it("should NOT retry content policy errors", () => {
      expect(isRetryableError(new Error("Content policy violation"))).toBe(false);
    });

    it("should NOT retry errors with specific non-retryable names", () => {
      const authError = new Error("Auth failed");
      authError.name = "AuthenticationError";
      expect(isRetryableError(authError)).toBe(false);

      const badRequestError = new Error("Bad params");
      badRequestError.name = "BadRequestError";
      expect(isRetryableError(badRequestError)).toBe(false);

      const notFoundError = new Error("Not found");
      notFoundError.name = "NotFoundError";
      expect(isRetryableError(notFoundError)).toBe(false);

      const permissionError = new Error("Permission denied");
      permissionError.name = "PermissionDeniedError";
      expect(isRetryableError(permissionError)).toBe(false);
    });

    it("should NOT retry unknown errors by default", () => {
      expect(isRetryableError(new Error("Some random error"))).toBe(false);
      expect(isRetryableError(new Error("Unexpected issue"))).toBe(false);
    });
  });

  describe("formatLLMError", () => {
    it("should format rate limit errors (429)", () => {
      expect(formatLLMError(new Error("429 Too Many Requests"))).toBe(
        "Rate limit exceeded (429) - retry after a few seconds"
      );
      expect(formatLLMError(new Error("RESOURCE_EXHAUSTED: quota exceeded"))).toBe(
        "Rate limit exceeded (429) - retry after a few seconds"
      );
    });

    it("should format rate limit errors by message", () => {
      expect(formatLLMError(new Error("Rate limit exceeded"))).toBe(
        "Rate limit exceeded - retry after a few seconds"
      );
      expect(formatLLMError(new Error("rate_limit_error"))).toBe(
        "Rate limit exceeded - retry after a few seconds"
      );
    });

    it("should format overloaded/capacity errors", () => {
      expect(formatLLMError(new Error("API is overloaded, please retry"))).toBe(
        "API overloaded - retry later"
      );
      expect(formatLLMError(new Error("At capacity"))).toBe(
        "API overloaded - retry later"
      );
    });

    it("should format server errors (5xx)", () => {
      expect(formatLLMError(new Error("500 Internal Server Error"))).toBe(
        "Internal server error (500) - the API is experiencing issues"
      );
      expect(formatLLMError(new Error("502 Bad Gateway"))).toBe(
        "Bad gateway (502) - the API is temporarily unavailable"
      );
      expect(formatLLMError(new Error("503 Service Unavailable"))).toBe(
        "Service unavailable (503) - the API is temporarily down"
      );
      expect(formatLLMError(new Error("504 Gateway Timeout"))).toBe(
        "Gateway timeout (504) - the request took too long"
      );
    });

    it("should format timeout errors", () => {
      expect(formatLLMError(new Error("Request timeout"))).toBe(
        "Request timed out - the API took too long to respond"
      );
      expect(formatLLMError(new Error("Connection timed out"))).toBe(
        "Request timed out - the API took too long to respond"
      );
    });

    it("should format connection errors", () => {
      expect(formatLLMError(new Error("ECONNREFUSED"))).toBe(
        "Connection refused - unable to reach the API"
      );
      expect(formatLLMError(new Error("ECONNRESET"))).toBe(
        "Connection reset - the API closed the connection"
      );
      expect(formatLLMError(new Error("ENOTFOUND"))).toBe(
        "DNS error - unable to resolve API hostname"
      );
    });

    it("should format auth errors", () => {
      expect(formatLLMError(new Error("401 Unauthorized"))).toBe(
        "Authentication failed - check your API key"
      );
      expect(formatLLMError(new Error("403 Forbidden"))).toBe(
        "Permission denied - your API key lacks required permissions"
      );
    });

    it("should format bad request errors", () => {
      expect(formatLLMError(new Error("400 Bad Request"))).toBe(
        "Bad request - check your input parameters"
      );
      // Try to extract message from JSON-like content
      const jsonError = new Error('{"status": 400, "message": "Invalid model specified"}');
      expect(formatLLMError(jsonError)).toBe("Bad request: Invalid model specified");
    });

    it("should format content policy errors", () => {
      expect(formatLLMError(new Error("Content policy violation"))).toBe(
        "Content policy violation - the request was blocked"
      );
    });

    it("should extract message from JSON errors", () => {
      const jsonError = new Error('{"error": {"message": "Something went wrong"}}');
      expect(formatLLMError(jsonError)).toBe("Something went wrong");
    });

    it("should truncate very long messages", () => {
      const longMessage = "A".repeat(300);
      const result = formatLLMError(new Error(longMessage));
      expect(result.length).toBeLessThanOrEqual(153); // 150 + "..."
      expect(result.endsWith("...")).toBe(true);
    });

    it("should pass through short unknown messages unchanged", () => {
      expect(formatLLMError(new Error("Unknown error"))).toBe("Unknown error");
    });
  });
});
