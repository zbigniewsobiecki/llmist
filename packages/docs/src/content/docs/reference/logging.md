---
title: Logging
description: Configure logging for llmist
---

llmist uses structured logging for debugging and monitoring.

## Log Levels

| Level | Priority | Use Case |
|-------|----------|----------|
| `silly` | 0 | Most verbose, internal state dumps |
| `trace` | 1 | Detailed execution flow |
| `debug` | 2 | Debugging information |
| `info` | 3 | General operational info |
| `warn` | 4 | Warnings (default) |
| `error` | 5 | Errors that may need attention |
| `fatal` | 6 | Critical failures |

## Environment Variables

```bash
# Set log level
export LLMIST_LOG_LEVEL="debug"

# Log to file
export LLMIST_LOG_FILE="./llmist.log"

# Clear log file on start
export LLMIST_LOG_RESET="true"
```

### Variable Reference

| Variable | Description | Default |
|----------|-------------|---------|
| `LLMIST_LOG_LEVEL` | Minimum log level | `warn` |
| `LLMIST_LOG_FILE` | Path to log file | none (console only) |
| `LLMIST_LOG_RESET` | Clear log file on start | `false` |

## CLI Logging

Use command-line flags:

```bash
# Set log level
llmist agent "task" --log-level debug

# Log to file
llmist agent "task" --log-file ./debug.log

# Combine options
llmist agent "task" --log-level trace --log-file ./trace.log
```

Or configure in `~/.llmist/cli.toml`:

```toml
[agent]
log-level = "debug"
log-file = "~/.llmist/logs/agent.log"
```

## Programmatic Configuration

### Using .withLogger()

```typescript
import { LLMist, createLogger } from 'llmist';

const logger = createLogger({
  minLevel: 'debug',
});

await LLMist.createAgent()
  .withLogger(logger)
  .askAndCollect('Your prompt');
```

### Custom Logger

```typescript
import { createLogger } from 'llmist';

const logger = createLogger({
  minLevel: 'debug',
  name: 'my-app',
});

// Log directly
logger.debug('Custom message', { data: 'value' });
logger.info('Agent started');
logger.error('Something failed', { error });
```

### Silent Mode

Suppress all logging:

```typescript
const logger = createLogger({
  minLevel: 'fatal', // Only fatal errors
});
```

## Log Output Format

Console output:
```
[2024-01-15 10:23:45] DEBUG (llmist): LLM call started
  model: "anthropic:claude-sonnet-4-5"
  messageCount: 3
[2024-01-15 10:23:46] DEBUG (llmist): LLM call complete
  tokens: { input: 150, output: 80 }
  duration: 1234
```

File output (structured JSON):
```json
{"level":"debug","time":"2024-01-15T10:23:45.123Z","msg":"LLM call started","model":"anthropic:claude-sonnet-4-5"}
```

## Debugging with Logs

### Capture LLM Interactions

```bash
LLMIST_LOG_LEVEL=trace llmist agent "task" 2>&1 | tee debug.log
```

### Debug Gadget Execution

```typescript
const logger = createLogger({ minLevel: 'trace' });

await LLMist.createAgent()
  .withLogger(logger)
  .withGadgets(MyGadget)
  .askAndCollect('Test');
```

Trace output shows:
- Gadget parameters received
- Execution timing
- Return values

### Production Logging

```typescript
const isProd = process.env.NODE_ENV === 'production';

const logger = createLogger({
  minLevel: isProd ? 'warn' : 'debug',
});
```

## Integration with External Loggers

Wrap external loggers:

```typescript
import pino from 'pino';

const pinoLogger = pino({ level: 'debug' });

// Create adapter
const logger = {
  debug: (msg, data) => pinoLogger.debug(data, msg),
  info: (msg, data) => pinoLogger.info(data, msg),
  warn: (msg, data) => pinoLogger.warn(data, msg),
  error: (msg, data) => pinoLogger.error(data, msg),
};

await LLMist.createAgent()
  .withLogger(logger)
  .askAndCollect('Task');
```

## See Also

- [Debugging Guide](/reference/debugging/) - Troubleshooting techniques
- [CLI Configuration](/cli/configuration/) - CLI logging settings
- [Hooks Guide](/guides/hooks/) - Custom monitoring with hooks
