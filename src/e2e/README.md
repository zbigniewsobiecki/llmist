# E2E Tests

This directory contains end-to-end tests for the LLMist library using real LLM APIs.

## Setup

1. Copy `.env.example` to `.env`
2. Add your API keys:
   ```
   OPENAI_API_KEY=sk-your-key
   ANTHROPIC_API_KEY=your-key
   GEMINI_API_KEY=your-key
   ```

## Running Tests

```bash
# Run all E2E tests
npm run test:e2e

# Run with debug output
DEBUG_E2E=true npm run test:e2e

# Watch mode
npm run test:e2e:watch
```

## Known Issues

### Test Model Behavior

Some models used in tests may be research/test models with unusual behavior:

- **gpt-5-nano**: This model consumes tokens as "reasoning_tokens" without producing visible text output.
  This is expected behavior for this model. The API calls succeed but return empty text content.

- **claude-3-7-sonnet-20250219**: May be a test model with limited availability

- **gemini-2.5-pro**: May be a test model with specific behavior patterns

### Debugging Model Issues

To debug model responses, you can use the debug script:

```javascript
// debug-gpt5.js - Example debug script
import 'dotenv/config';
import { LLMist } from './dist/index.js';

const client = new LLMist({ autoDiscoverProviders: true });
const stream = await client.stream({
  model: 'openai:gpt-5-nano',
  messages: [{ role: 'user', content: 'Say hello' }],
  maxTokens: 50,
});

for await (const chunk of stream) {
  console.log('Chunk:', JSON.stringify(chunk, null, 2));
}
```

## Test Structure

- `setup.ts`: Test utilities and helpers
- `core-flow.e2e.test.ts`: Tests for AgentLoop with real LLMs
- `providers.e2e.test.ts`: Provider integration tests
- `simple-provider.e2e.test.ts`: Basic connectivity tests