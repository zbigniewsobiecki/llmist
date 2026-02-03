---
title: Streaming
description: Handle real-time LLM responses and events
---

llmist is streaming-first. All responses stream by default.

## Three Ways to Consume

### 1. `askAndCollect()` - Simple

Collect all text into a string:

```typescript
const answer = await LLMist.createAgent()
  .withModel('haiku')
  .withGadgets(FloppyDisk)
  .askAndCollect('How many floppies for a 10MB file?');

console.log(answer); // "A 10MB file requires 7 floppy disks."
```

### 2. `askWith()` - Event Handlers

Handle events as they happen:

```typescript
await LLMist.createAgent()
  .withModel('sonnet')
  .withGadgets(ArcadeHighScore)
  .askWith('Check high scores for Pac-Man', {
    onText: (text) => process.stdout.write(text),
    onGadgetCall: (call) => console.log(`Calling: ${call.gadgetName}`),
    onGadgetResult: (result) => console.log(`Result: ${result.result}`),
    onHumanInputRequired: (data) => console.log(`Question: ${data.question}`),
  });
```

### 3. `run()` - Manual Control

Full control with async iteration:

```typescript
const agent = LLMist.createAgent()
  .withModel('gpt4o')
  .withGadgets(DialUpModem)
  .ask('Connect me to AOL');

for await (const event of agent.run()) {
  switch (event.type) {
    case 'text':
      process.stdout.write(event.content);
      break;
    case 'gadget_call':
      console.log(`\nCalling: ${event.call.gadgetName}`);
      break;
    case 'gadget_result':
      console.log(`Result: ${event.result.result}`);
      break;
    case 'thinking':
      process.stdout.write(`💭 ${event.content}`);
      break;
    case 'human_input_required':
      console.log(`Question: ${event.question}`);
      break;
  }
}
```

## Event Types

| Type | Properties | Description |
|------|------------|-------------|
| `text` | `content: string` | Text chunk from LLM |
| `gadget_call` | `call: { gadgetName, parameters }` | Gadget about to execute |
| `gadget_result` | `result: { gadgetName, result?, error?, parameters }` | Gadget completed |
| `thinking` | `content: string, thinkingType: "thinking" \| "redacted"` | Reasoning model thinking content |
| `human_input_required` | `question, gadgetName, invocationId` | User input needed |

## Helper Functions

Import from `llmist`:

```typescript
import { collectText, collectEvents, runWithHandlers } from 'llmist';
```

### `collectText()`

```typescript
const text = await collectText(agent.run());
console.log(text);
```

### `collectEvents()`

```typescript
const { text, gadgetCalls, gadgetResults } = await collectEvents(agent.run(), {
  text: true,
  gadgetCalls: true,
  gadgetResults: true,
});

console.log('Response:', text.join(''));
console.log('Gadgets called:', gadgetCalls.length);
```

### `runWithHandlers()`

```typescript
await runWithHandlers(agent.run(), {
  onText: (text) => console.log(text),
  onGadgetResult: (result) => console.log(result),
});
```

## EventHandlers Interface

```typescript
interface EventHandlers {
  onText?: (content: string) => void | Promise<void>;
  onGadgetCall?: (call: {
    gadgetName: string;
    parameters?: Record<string, unknown>;
  }) => void | Promise<void>;
  onGadgetResult?: (result: {
    gadgetName: string;
    result?: string;
    error?: string;
    parameters: Record<string, unknown>;
  }) => void | Promise<void>;
  onHumanInputRequired?: (data: {
    question: string;
    gadgetName: string;
  }) => void | Promise<void>;
  onOther?: (event: StreamEvent) => void | Promise<void>;
}
```

## Quick Methods (No Gadgets)

For simple streaming without agents:

```typescript
// Static method
for await (const chunk of LLMist.stream('Tell me a story')) {
  process.stdout.write(chunk);
}

// Instance method
const client = new LLMist();
for await (const chunk of client.streamText('Tell me a story')) {
  process.stdout.write(chunk);
}
```

:::note[Reasoning Models]
For models with reasoning/thinking enabled, the `run()` loop also emits `thinking` events with internal reasoning content. For full details, see the [Reasoning Models](/library/guides/reasoning-models/) guide.
:::

## See Also

- [Gadgets Guide](/library/guides/gadgets/) - Creating tools
- [Hooks Guide](/library/guides/hooks/) - Monitoring streams
- [Human-in-the-Loop](/library/guides/human-in-loop/) - Handling user input events
- [Reasoning Models](/library/guides/reasoning-models/) - Thinking/reasoning model support
