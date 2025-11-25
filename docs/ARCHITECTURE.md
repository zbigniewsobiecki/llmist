# Architecture

Technical overview of llmist's design.

## Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Your Application                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ AgentBuilder│──│    Agent    │──│  StreamProcessor    │ │
│  │  (fluent)   │  │   (loop)    │  │  (events/hooks)     │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
│         │                │                   │              │
│         ▼                ▼                   ▼              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   LLMist    │  │GadgetRegistry│  │  GadgetExecutor    │ │
│  │  (client)   │  │  (tools)    │  │  (timeout/errors)  │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
│         │                                                   │
│         ▼                                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                Provider Adapters                     │   │
│  │  ┌─────────┐  ┌───────────┐  ┌────────────────┐    │   │
│  │  │ OpenAI  │  │ Anthropic │  │     Gemini     │    │   │
│  │  └─────────┘  └───────────┘  └────────────────┘    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Core Components

### LLMist (Client)

The main client for LLM interactions.

**Responsibilities:**
- Provider discovery and management
- Model registry with specs and pricing
- Streaming API
- Token counting

**Location:** `src/core/client.ts`

```typescript
const client = new LLMist();
const stream = client.stream({ model, messages });
const tokens = await client.countTokens(model, messages);
```

### AgentBuilder

Fluent API for configuring agents.

**Responsibilities:**
- Chainable configuration
- Model resolution (shortcuts)
- Gadget registration
- Hook setup

**Location:** `src/agent/builder.ts`

```typescript
LLMist.createAgent()
  .withModel('sonnet')
  .withGadgets(Calculator)
  .ask('prompt');
```

### Agent

The agent loop orchestrator.

**Responsibilities:**
- Iteration control
- Message history
- Stream coordination
- Event emission

**Location:** `src/agent/agent.ts`

```typescript
for await (const event of agent.run()) {
  // text, gadget_call, gadget_result, human_input_required
}
```

### StreamProcessor

Processes LLM streams with hooks.

**Responsibilities:**
- Parse gadget calls from stream
- Execute hooks (observers, interceptors, controllers)
- Coordinate gadget execution
- Handle special exceptions

**Location:** `src/agent/stream-processor.ts`

### GadgetRegistry

Registry of available tools.

**Responsibilities:**
- Store gadget instances
- Name resolution
- Generate LLM instructions

**Location:** `src/gadgets/registry.ts`

### GadgetExecutor

Executes gadgets with safety.

**Responsibilities:**
- Parameter validation (Zod)
- Timeout handling
- Error wrapping
- Exception handling

**Location:** `src/gadgets/executor.ts`

### Provider Adapters

Abstraction over LLM APIs.

**Responsibilities:**
- API communication
- Response streaming
- Token counting
- Model catalog

**Location:** `src/providers/*.ts`

## Data Flow

### 1. User Request

```
User Prompt → AgentBuilder → Agent → StreamProcessor
```

### 2. LLM Call

```
StreamProcessor → LLMist → Provider Adapter → API
```

### 3. Stream Processing

```
API Response → Provider Adapter → LLMist → StreamProcessor
                                              ↓
                                         Parse chunks
                                              ↓
                                    ┌─────────┴─────────┐
                                    ↓                   ↓
                               Text Event          Gadget Call
                                    ↓                   ↓
                               Emit to User      GadgetExecutor
                                                        ↓
                                                   Gadget Result
                                                        ↓
                                                 Add to Context
```

### 4. Agent Loop

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐             │
│  │  Build  │───▶│  Call   │───▶│ Process │             │
│  │ Messages│    │   LLM   │    │ Stream  │             │
│  └─────────┘    └─────────┘    └─────────┘             │
│       ▲                              │                  │
│       │                              ▼                  │
│       │                        ┌─────────┐             │
│       │                        │ Execute │             │
│       │                        │ Gadgets │             │
│       │                        └─────────┘             │
│       │                              │                  │
│       │         ┌────────────────────┼────────────────┐│
│       │         ▼                    ▼                ││
│       │    ┌─────────┐         ┌─────────┐           ││
│       └────│ Continue│         │  Break  │───────────┘│
│            └─────────┘         └─────────┘            │
│                                                        │
└──────────────────────────────────────────────────────────┘
```

## Key Patterns

### Template Method (Providers)

```typescript
abstract class BaseProviderAdapter {
  abstract createStream(): AsyncIterable<Chunk>;
  abstract formatMessages(): ProviderMessages;

  stream(options) {
    const messages = this.formatMessages(options.messages);
    return this.createStream(messages);
  }
}
```

### Builder Pattern (Agent)

```typescript
class AgentBuilder {
  withModel(m) { this.model = m; return this; }
  withGadgets(...g) { this.gadgets.push(...g); return this; }
  ask(prompt) { return new Agent(this.build()); }
}
```

### Registry Pattern (Gadgets)

```typescript
class GadgetRegistry {
  register(name, gadget) { this.gadgets.set(name, gadget); }
  get(name) { return this.gadgets.get(name); }
}
```

### Observer Pattern (Hooks)

```typescript
interface Observers {
  onLLMCallStart?: (ctx) => void;
  onLLMCallComplete?: (ctx) => void;
  onGadgetExecutionComplete?: (ctx) => void;
}
```

## Module Structure

```
src/
├── core/           # LLM client, messages, model catalog
│   ├── client.ts
│   ├── messages.ts
│   ├── model-registry.ts
│   └── model-shortcuts.ts
├── agent/          # Agent loop and orchestration
│   ├── agent.ts
│   ├── builder.ts
│   ├── stream-processor.ts
│   ├── hooks.ts
│   └── hook-presets.ts
├── gadgets/        # Tool system
│   ├── gadget.ts
│   ├── typed-gadget.ts
│   ├── create-gadget.ts
│   ├── executor.ts
│   ├── registry.ts
│   └── validation.ts    # Standalone validation utilities
├── providers/      # LLM provider adapters
│   ├── openai.ts
│   ├── anthropic.ts
│   └── gemini.ts
├── testing/        # Mock and testing utilities
│   ├── mock-builder.ts
│   ├── mock-adapter.ts
│   ├── mock-gadget.ts   # Mock gadget factory
│   └── gadget-testing.ts # Gadget test helpers
└── cli/            # Command line interface
    ├── program.ts
    └── commands/
```

## Extension Points

1. **Custom Providers** - Implement `ProviderAdapter`
2. **Custom Gadgets** - Extend `Gadget()` or use `createGadget()`
3. **Custom Hooks** - Add observers, interceptors, controllers
4. **Custom Models** - Register via `modelRegistry.registerModel()`

## See Also

- **[Hooks Guide](./HOOKS.md)** - Lifecycle hooks
- **[Providers Guide](./PROVIDERS.md)** - Provider adapters
- **[Custom Models](./CUSTOM_MODELS.md)** - Model registration
