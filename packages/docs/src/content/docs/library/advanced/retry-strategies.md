---
title: Retry Strategies
description: Configure automatic retry behavior for transient LLM API failures
---

LLM APIs can fail transiently due to rate limits, server overload, or network issues. llmist automatically retries these failures with exponential backoff and jitter to maximize reliability.

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
