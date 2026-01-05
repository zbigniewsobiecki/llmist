---
title: Retry Strategies
description: Configure automatic retry behavior for transient LLM API failures
---

LLM APIs can fail transiently due to rate limits, server overload, or network issues. llmist provides a **two-layer protection system** to handle these failures reliably.

## Two-Layer Protection

llmist uses two complementary strategies for rate limit handling:

| Layer | Purpose | How it Works |
|-------|---------|--------------|
| **Proactive** | Prevent errors | Track usage and delay requests before hitting limits |
| **Reactive** | Handle errors | Retry with backoff when errors occur, respecting `Retry-After` headers |

```typescript
const agent = LLMist.createAgent()
  .withModel('sonnet')

  // Layer 1: Proactive throttling
  .withRateLimits({
    requestsPerMinute: 50,
    tokensPerMinute: 100000,
  })

  // Layer 2: Reactive retry (enabled by default)
  .withRetry({
    retries: 3,
    respectRetryAfter: true,
  })

  .ask('...');
```

## Quick Start

Retry is **enabled by default** with sensible settings:

```typescript
// Default behavior - automatic retry on transient errors
const agent = await LLMist.createAgent()
  .withModel('sonnet')
  .ask('...');
```

To customize:

```typescript
// Custom retry configuration
.withRetry({
  retries: 5,           // Max 5 attempts
  minTimeout: 2000,     // Start with 2s delay
  maxTimeout: 60000,    // Cap at 60s
  onRetry: (error, attempt) => {
    console.log(`Retry ${attempt}: ${error.message}`);
  },
})

// Disable retry
.withRetry({ enabled: false })
```

## Configuration Options

The `RetryConfig` interface supports these options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable retry |
| `retries` | number | `3` | Maximum retry attempts |
| `minTimeout` | number | `1000` | Initial delay in ms |
| `maxTimeout` | number | `30000` | Maximum delay in ms |
| `factor` | number | `2` | Exponential backoff factor |
| `randomize` | boolean | `true` | Add jitter to prevent thundering herd |
| `respectRetryAfter` | boolean | `true` | Honor Retry-After headers from providers |
| `maxRetryAfterMs` | number | `120000` | Cap on server-requested wait time |

### Callbacks

```typescript
.withRetry({
  // Called before each retry
  onRetry: (error: Error, attempt: number) => {
    metrics.increment('llm.retry', { attempt });
    console.warn(`Retry ${attempt}: ${error.message}`);
  },

  // Called when all retries exhausted
  onRetriesExhausted: (error: Error, attempts: number) => {
    alerting.notify(`LLM failed after ${attempts} attempts`);
  },
})
```

### Custom Retry Logic

Override the default error classification:

```typescript
.withRetry({
  shouldRetry: (error: Error) => {
    // Only retry rate limits, not server errors
    return error.message.includes('429');
  },
})
```

## Automatic Error Classification

By default, llmist retries these errors automatically:

### Retried Errors

| Error Type | Examples |
|------------|----------|
| **Rate Limits** | 429, "rate limit exceeded", "rate_limit" |
| **Server Errors** | 500, 502, 503, 504, "internal server error" |
| **Timeouts** | "timeout", "etimedout", "timed out" |
| **Connection Issues** | "econnreset", "econnrefused", "enotfound" |
| **Provider Overload** | "overloaded", "capacity" |

### Non-Retried Errors

| Error Type | Examples |
|------------|----------|
| **Authentication** | 401, 403, "unauthorized", "forbidden" |
| **Bad Request** | 400, "invalid" |
| **Not Found** | 404 |
| **Content Policy** | "content policy", "safety" |

### Provider-Specific Errors

llmist handles provider-specific error patterns:

| Provider | Retryable Errors |
|----------|------------------|
| **Gemini** | `RESOURCE_EXHAUSTED`, `UNAVAILABLE`, `DEADLINE_EXCEEDED`, "quota exceeded" |
| **Anthropic** | `overloaded_error`, `api_error` |
| **OpenAI** | `RateLimitError`, `ServiceUnavailableError`, `APITimeoutError` |

## Proactive Rate Limiting

Prevent rate limit errors before they occur by configuring usage limits:

```typescript
const agent = LLMist.createAgent()
  .withRateLimits({
    requestsPerMinute: 60,      // Your API tier's RPM limit
    tokensPerMinute: 100000,    // Your API tier's TPM limit
    tokensPerDay: 1000000,      // Optional daily limit (Gemini free tier)
    safetyMargin: 0.9,          // Start throttling at 90% of limit
  })
  .ask('...');
```

### Rate Limit Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `requestsPerMinute` | number | - | Max RPM for your tier |
| `tokensPerMinute` | number | - | Max TPM for your tier |
| `tokensPerDay` | number | - | Daily token limit |
| `safetyMargin` | number | `0.9` | Threshold to start throttling |
| `enabled` | boolean | `true` | Enable/disable proactive limiting |

### Provider Rate Limit Tiers

Example configurations for common tiers:

```typescript
// Gemini free tier
.withRateLimits({
  requestsPerMinute: 15,
  tokensPerMinute: 1_000_000,
  tokensPerDay: 1_500_000,
})

// OpenAI Tier 1
.withRateLimits({
  requestsPerMinute: 500,
  tokensPerMinute: 200_000,
})

// Anthropic Tier 1
.withRateLimits({
  requestsPerMinute: 50,
  tokensPerMinute: 40_000,
})
```

## Retry-After Header Support

llmist automatically parses and respects `Retry-After` headers from providers:

```typescript
.withRetry({
  respectRetryAfter: true,    // Default: true
  maxRetryAfterMs: 60000,     // Cap wait at 1 minute
})
```

### Provider Support

| Provider | Retry-After Format |
|----------|-------------------|
| **Anthropic** | HTTP header (seconds) |
| **OpenAI** | HTTP header (seconds) |
| **Gemini** | Parsed from error message (e.g., "retry in 45.2s") |

When a provider sends `Retry-After: 30`, llmist will wait 30 seconds before retrying instead of using exponential backoff.

## Backoff Calculation

The delay between retries follows exponential backoff:

```
delay = min(minTimeout * (factor ^ attempt), maxTimeout)
```

With `randomize: true` (default), jitter is added:

```
delay = delay * random(0.5, 1.5)
```

**Example with defaults:**
- Attempt 1: ~1-1.5s
- Attempt 2: ~2-3s
- Attempt 3: ~4-6s

## Usage Examples

### High-Reliability Configuration

```typescript
const agent = LLMist.createAgent()
  .withRetry({
    retries: 5,
    minTimeout: 2000,
    maxTimeout: 120000,  // Up to 2 minutes between retries
    onRetry: (error, attempt) => {
      logger.warn(`LLM retry ${attempt}/5`, { error: error.message });
    },
    onRetriesExhausted: (error, attempts) => {
      logger.error(`LLM failed permanently after ${attempts} attempts`);
      alerting.trigger('llm_failure');
    },
  })
  .ask('...');
```

### Fast-Fail for Interactive Use

```typescript
const agent = LLMist.createAgent()
  .withRetry({
    retries: 1,        // Only one retry
    minTimeout: 500,   // Short delay
    maxTimeout: 2000,  // Cap quickly
  })
  .ask('...');
```

### Disable Retry

```typescript
// For testing or when you handle retries externally
const agent = LLMist.createAgent()
  .withRetry({ enabled: false })
  .ask('...');
```

### Selective Retry

```typescript
const agent = LLMist.createAgent()
  .withRetry({
    shouldRetry: (error) => {
      // Only retry rate limits and overload
      const msg = error.message.toLowerCase();
      return msg.includes('429') ||
             msg.includes('rate limit') ||
             msg.includes('overloaded');
    },
  })
  .ask('...');
```

### Metrics Integration

```typescript
const agent = LLMist.createAgent()
  .withRetry({
    onRetry: (error, attempt) => {
      statsd.increment('llm.retries', {
        attempt: String(attempt),
        error_type: classifyError(error),
      });
    },
    onRetriesExhausted: (error, attempts) => {
      statsd.increment('llm.failures', {
        total_attempts: String(attempts),
      });
    },
  })
  .ask('...');
```

## Error Formatting

llmist also provides `formatLLMError()` to clean up verbose API error messages:

```typescript
import { formatLLMError } from 'llmist';

try {
  await agent.askAndCollect('...');
} catch (error) {
  // Instead of: "{\"error\":{\"message\":\"Rate limit exceeded...\"}}"
  // You get: "Rate limit exceeded (429) - retry after a few seconds"
  console.error(formatLLMError(error));
}
```

## See Also

- [Error Handling](/library/guides/error-handling/) - Comprehensive error handling guide
- [Hooks System](/library/guides/hooks/) - Add custom retry logic via hooks
- [Cost Tracking](/library/guides/cost-tracking/) - Monitor costs across retries
