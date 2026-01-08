---
title: Rate Limiting Patterns
description: Best practices for managing API rate limits across different scenarios
---

Practical patterns for configuring rate limits based on your API tier, deployment environment, and workload.

## Pattern 1: Multi-Tier Configuration

Adjust rate limits per environment using TOML profiles:

```toml
# ~/.llmist/cli.toml

# Development: Conservative limits to avoid burning quota
[dev.rate-limits]
requests-per-minute = 5
tokens-per-minute = 10000

# Production: Match your actual API tier
[prod.rate-limits]
requests-per-minute = 50
tokens-per-minute = 100000
```

Use with:
```bash
llmist dev "test prompt"     # Uses dev limits
llmist prod "real task"      # Uses prod limits
```

## Pattern 2: Provider-Specific Defaults

llmist auto-detects provider defaults, but override for your specific tier:

```typescript
import { LLMist } from 'llmist';

// Anthropic Tier 2 (100 RPM, 80K TPM)
const anthropicAgent = LLMist.createAgent()
  .withModel('sonnet')
  .withRateLimits({
    requestsPerMinute: 100,
    tokensPerMinute: 80_000,
  });

// Gemini 1.5 Pro with higher limits
const geminiAgent = LLMist.createAgent()
  .withModel('gemini:gemini-1.5-pro')
  .withRateLimits({
    requestsPerMinute: 360,
    tokensPerMinute: 4_000_000,
  });
```

## Pattern 3: Batch Processing with Rate Limits

Process multiple tasks while respecting rate limits:

```typescript
const tasks = ['task1', 'task2', 'task3', /* ...100 tasks */ ];

const agent = LLMist.createAgent()
  .withModel('haiku')
  .withRateLimits({
    requestsPerMinute: 50,
    tokensPerMinute: 100_000,
  })
  .withHooks({
    observers: {
      onRateLimitThrottle: (ctx) => {
        console.log(`[Throttled] Waiting ${Math.ceil(ctx.delayMs / 1000)}s...`);
      },
    },
  });

for (const task of tasks) {
  const result = await agent.askAndCollect(task);
  console.log(`Completed: ${task}`);
  // Agent automatically paces requests
}
```

## Pattern 4: Cost + Rate Limit Tracking

Track both cost and rate limit usage together:

```typescript
let totalCost = 0;
let throttleCount = 0;

const agent = LLMist.createAgent()
  .withModel('sonnet')
  .withRateLimits({
    requestsPerMinute: 50,
    tokensPerMinute: 40_000,
    safetyMargin: 0.8,  // Start throttling at 80%
  })
  .withHooks({
    observers: {
      onLLMCallComplete: (ctx) => {
        totalCost += ctx.cost ?? 0;
        console.log(`Cost so far: $${totalCost.toFixed(4)}`);
      },
      onRateLimitThrottle: (ctx) => {
        throttleCount++;
        console.log(`Throttled ${throttleCount}x (RPM: ${ctx.stats.requestsInCurrentMinute}/${ctx.stats.requestsPerMinute})`);
      },
    },
  });
```

## Pattern 5: Dynamic Rate Limits Based on Time

Adjust limits during peak/off-peak hours:

```typescript
function getRateLimits(): RateLimitConfig {
  const hour = new Date().getHours();
  const isPeakHours = hour >= 9 && hour <= 17;

  return {
    requestsPerMinute: isPeakHours ? 30 : 50,  // More conservative during peak
    tokensPerMinute: isPeakHours ? 60_000 : 100_000,
    safetyMargin: isPeakHours ? 0.7 : 0.8,
  };
}

const agent = LLMist.createAgent()
  .withModel('sonnet')
  .withRateLimits(getRateLimits())
  .ask('...');
```

## Pattern 6: Disable for Local/Mock Providers

Skip rate limiting for local models or mocks:

```typescript
const isLocal = process.env.LLM_PROVIDER === 'local';

const agent = LLMist.createAgent()
  .withModel(isLocal ? 'local:llama3' : 'sonnet')
  .withRateLimits(isLocal ? { enabled: false } : {
    requestsPerMinute: 50,
    tokensPerMinute: 40_000,
  });
```

## Pattern 7: Subagent Rate Limiting

When using subagents (like BrowseWeb), rate limits apply to each agent independently:

```typescript
// Parent agent: conservative limits
const parent = LLMist.createAgent()
  .withModel('sonnet')
  .withRateLimits({
    requestsPerMinute: 20,
    tokensPerMinute: 50_000,
  })
  .withGadgets(BrowseWeb);  // BrowseWeb is a subagent gadget

// BrowseWeb subagent inherits model but uses its own rate limit tracking
// Configure subagent limits in cli.toml:
// [subagents.BrowseWeb]
// model = "inherit"
```

Rate limit statistics in `onRateLimitThrottle` hooks are per-agent (parent and subagent tracked separately).

## Troubleshooting

**Problem:** Still hitting rate limits despite configuration

**Solution:** Check safety margin and actual token usage:
```typescript
.withHooks({
  observers: {
    onRateLimitThrottle: (ctx) => {
      const rpm = ctx.stats.requestsInCurrentMinute;
      const tpm = ctx.stats.tokensInCurrentMinute;
      console.log(`Current: RPM=${rpm}, TPM=${tpm}`);
      // If these are below your configured limits, increase safetyMargin
    },
  },
})
```

**Problem:** Too much throttling, performance is slow

**Solution:** Lower safety margin or increase limits:
```typescript
.withRateLimits({
  requestsPerMinute: 50,
  tokensPerMinute: 100_000,
  safetyMargin: 0.95,  // Only throttle at 95% usage
})
```

## See Also

- [Retry Strategies](/library/advanced/retry-strategies/) - Reactive error handling
- [Cost Tracking](/library/guides/cost-tracking/) - Monitor spending
- [Hooks Guide](/library/guides/hooks/) - Custom monitoring
- [CLI Configuration](/cli/configuration/toml-reference/) - TOML rate limit configuration
