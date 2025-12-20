---
title: Architecture
description: Technical overview of llmist's design
---

Technical overview of llmist's design.

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                       Your Application                           │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌───────────────────────┐   │
│  │ AgentBuilder│──│    Agent    │──│   StreamProcessor     │   │
│  │  (fluent)   │  │   (loop)    │  │   (events/hooks)      │   │
│  └─────────────┘  └──────┬──────┘  └───────────┬───────────┘   │
│         │                │                     │                │
│         │                ▼                     ▼                │
│         │         ┌─────────────┐      ┌─────────────────┐     │
│         │         │ExecutionTree│      │  GadgetExecutor │     │
│         │         │(cost/tokens)│      │(timeout/errors) │     │
│         │         └─────────────┘      └────────┬────────┘     │
│         ▼                                       ▼               │
│  ┌─────────────┐                       ┌─────────────────┐     │
│  │   LLMist    │                       │  GadgetRegistry │     │
│  │  (client)   │                       │    (tools)      │     │
│  └──────┬──────┘                       └─────────────────┘     │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                  Provider Adapters                       │   │
│  │  ┌─────────┐  ┌───────────┐  ┌────────────────┐        │   │
│  │  │ OpenAI  │  │ Anthropic │  │     Gemini     │        │   │
│  │  └─────────┘  └───────────┘  └────────────────┘        │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Core Components

| Component | Location | Responsibility |
|-----------|----------|----------------|
| **LLMist** | `src/core/client.ts` | Provider discovery, model registry, streaming API |
| **AgentBuilder** | `src/agent/builder.ts` | Fluent configuration, model resolution, gadget registration |
| **Agent** | `src/agent/agent.ts` | Iteration control, message history, event emission |
| **StreamProcessor** | `src/agent/stream-processor.ts` | Parse gadget calls, execute hooks, coordinate gadgets |
| **ExecutionTree** | `src/agent/execution-tree.ts` | Track LLM calls, gadget executions, costs, and hierarchy |
| **GadgetRegistry** | `src/gadgets/registry.ts` | Store gadgets, name resolution, generate instructions |
| **GadgetExecutor** | `src/gadgets/executor.ts` | Parameter validation, timeout, error wrapping |

## Message Flow

1. **User sends prompt** → AgentBuilder creates Agent
2. **Agent starts iteration** → Calls LLMist.stream()
3. **StreamProcessor** parses tokens → Detects gadget blocks
4. **GadgetExecutor** validates and runs gadgets
5. **Results added to history** → Next iteration begins
6. **ExecutionTree** tracks everything (costs, tokens, hierarchy)

## Key Patterns

- **Builder Pattern** - `AgentBuilder` for chainable configuration
- **Registry Pattern** - `GadgetRegistry` for tool discovery
- **Observer Pattern** - Hooks for lifecycle monitoring
- **Template Method** - Provider adapters for API abstraction
- **Composite Pattern** - `ExecutionTree` for hierarchical tracking

## Extension Points

1. **Custom Providers** - Implement `ProviderAdapter`
2. **Custom Gadgets** - Extend `Gadget()` or use `createGadget()`
3. **Custom Hooks** - Add observers, interceptors, controllers
4. **Custom Models** - Register via `modelRegistry.registerModel()`

## See Also

- [Hooks Guide](/guides/hooks/) - Lifecycle hooks
- [Execution Tree](/advanced/execution-tree/) - Tree structure details
- [Providers Guide](/advanced/providers/) - Provider adapters
- [Cost Tracking](/guides/cost-tracking/) - Token and cost monitoring
