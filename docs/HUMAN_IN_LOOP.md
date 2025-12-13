# Human-in-the-Loop

Enable interactive conversations where the agent can ask the user questions.

## Quick Start

```typescript
import { LLMist, Gadget, HumanInputRequiredException, z } from 'llmist';

// Gadget that requests user input
class AskUser extends Gadget({
  description: 'Ask the user a question when you need more information',
  schema: z.object({
    question: z.string().describe('The question to ask'),
  }),
}) {
  execute(params: this['params']): string {
    throw new HumanInputRequiredException(params.question);
  }
}

// Handle the input request
const answer = await LLMist.createAgent()
  .withModel('sonnet')
  .withGadgets(AskUser)
  .onHumanInput(async (question) => {
    // Your input function (readline, prompt, etc.)
    return await promptUser(question);
  })
  .askAndCollect('Help me plan a trip');
```

## How It Works

1. LLM calls the `AskUser` gadget with a question
2. Gadget throws `HumanInputRequiredException`
3. Agent pauses and emits `human_input_required` event
4. Your `onHumanInput` handler is called
5. User's response is sent back to the LLM
6. Agent continues

## Event Handling

### With `askWith()`

```typescript
await LLMist.createAgent()
  .withGadgets(AskUser)
  .onHumanInput(async (question) => {
    return await getUserInput(question);
  })
  .askWith('Help me', {
    onText: (text) => console.log(text),
    onHumanInputRequired: (data) => {
      console.log(`Agent is asking: ${data.question}`);
    },
  });
```

### With `run()`

```typescript
const agent = LLMist.createAgent()
  .withGadgets(AskUser)
  .onHumanInput(async (question) => {
    return await getUserInput(question);
  })
  .ask('Help me plan');

for await (const event of agent.run()) {
  if (event.type === 'human_input_required') {
    console.log(`Agent needs input: ${event.question}`);
    // Input will be handled by onHumanInput
  }
}
```

## Readline Example

```typescript
import * as readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function promptUser(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(`${question}\n> `, (answer) => {
      resolve(answer);
    });
  });
}

const answer = await LLMist.createAgent()
  .withModel('sonnet')
  .withGadgets(AskUser)
  .onHumanInput(promptUser)
  .askAndCollect('Interview me about my preferences');

rl.close();
```

## Multiple Questions

The agent can ask multiple questions in sequence:

```typescript
class AskUser extends Gadget({
  description: 'Ask user a question. Use for: preferences, clarification, choices',
  schema: z.object({
    question: z.string(),
    context: z.string().optional().describe('Why you need this info'),
  }),
}) {
  execute(params: this['params']): string {
    const fullQuestion = params.context
      ? `${params.context}\n\n${params.question}`
      : params.question;
    throw new HumanInputRequiredException(fullQuestion);
  }
}

// Agent might ask:
// 1. "What's your budget?"
// 2. "Do you prefer beach or mountains?"
// 3. "How long is your trip?"
```

## Confirmation Pattern

Ask for confirmation before actions:

```typescript
class ConfirmAction extends Gadget({
  description: 'Ask user to confirm before proceeding with an action',
  schema: z.object({
    action: z.string().describe('What will be done'),
    consequences: z.string().optional(),
  }),
}) {
  execute(params: this['params']): string {
    const message = params.consequences
      ? `${params.action}\n\nNote: ${params.consequences}\n\nProceed? (yes/no)`
      : `${params.action}\n\nProceed? (yes/no)`;
    throw new HumanInputRequiredException(message);
  }
}

// Use with other gadgets
.withGadgets(ConfirmAction, DeleteFile, SendEmail)
```

## Text-Only Handler

Control behavior when LLM responds without calling gadgets:

```typescript
.withTextOnlyHandler('terminate')      // Default: end loop
.withTextOnlyHandler('acknowledge')    // Continue for another iteration
.withTextOnlyHandler('wait_for_input') // Wait for user input

// Custom handler
.withTextOnlyHandler({
  type: 'custom',
  handler: async (context) => {
    if (context.text.includes('?')) {
      return { action: 'wait_for_input', question: context.text };
    }
    return { action: 'continue' };
  },
})
```

## See Also

- **[Gadgets Guide](./GADGETS.md)** - Creating custom gadgets
- **[Streaming Guide](./STREAMING.md)** - Event handling
- **[Error Handling](./ERROR_HANDLING.md)** - Handling input errors
