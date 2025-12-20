---
title: Prompt Customization
description: Customize the internal prompts llmist uses to teach LLMs the gadget format
---

llmist uses carefully crafted prompts to teach LLMs how to invoke gadgets using text markers. You can customize these prompts for specialized use cases, different languages, or domain-specific requirements.

## Quick Start

Customize prompts using `withPromptTemplateConfig()`:

```typescript
const agent = await LLMist.createAgent()
  .withPromptTemplateConfig({
    mainInstruction: "USE THE GADGET MARKERS BELOW. DO NOT USE FUNCTION CALLING.",
    rules: [
      "Output only plain text with exact markers",
      "You can invoke multiple gadgets in parallel",
      "Always verify your work before finishing",
    ],
  })
  .withGadgets(MyGadget)
  .ask('...');
```

## Configuration Options

The `PromptTemplateConfig` interface supports these fields:

### mainInstruction

The opening instruction block that emphasizes using text markers instead of function calling.

```typescript
.withPromptTemplateConfig({
  mainInstruction: `
    CRITICAL: Use the gadget markers shown below.
    Never use function calling or tool calling APIs.
    Output markers as plain text.
  `,
})
```

**Default:**
```
CRITICAL: RESPOND ONLY WITH GADGET INVOCATIONS
DO NOT use function calling or tool calling
You must output the exact text markers shown below in plain text.
EACH MARKER MUST START WITH A NEWLINE.
```

### criticalUsage

Instruction emphasizing how to invoke gadgets.

```typescript
.withPromptTemplateConfig({
  criticalUsage: "ALWAYS invoke gadgets using markers - never describe your intentions.",
})
```

**Default:** `"INVOKE gadgets using the markers - do not describe what you want to do."`

### formatDescription

Description of the parameter format. Can be a static string or a function that receives context.

```typescript
.withPromptTemplateConfig({
  // Static string
  formatDescription: "Parameters use !!!ARG:name markers with values on the next line",

  // Dynamic based on context
  formatDescription: (ctx) =>
    `Parameters using ${ctx.argPrefix}name markers (value on next line)`,
})
```

### rules

Array of rules for gadget invocation. Can be a static array or a function.

```typescript
.withPromptTemplateConfig({
  // Static rules
  rules: [
    "Output only plain text with exact markers",
    "Invoke multiple gadgets in a single response when possible",
    "Always validate parameters before invoking",
  ],

  // Dynamic rules based on context
  rules: (ctx) => [
    `You have ${ctx.gadgetCount} gadgets available`,
    `Available gadgets: ${ctx.gadgetNames.join(', ')}`,
    "Complete your work efficiently",
  ],
})
```

**Default rules:**
- Output ONLY plain text with the exact markers - never use function/tool calling
- You can invoke multiple gadgets in a single response
- Gadgets without dependencies execute immediately (in parallel if multiple)
- Use :invocation_id:dep1,dep2 syntax when a gadget needs results from prior gadgets
- If any dependency fails, dependent gadgets are automatically skipped

### customExamples

Replace the default format examples entirely. Useful for domain-specific scenarios.

```typescript
.withPromptTemplateConfig({
  customExamples: (ctx) => `

EXAMPLE (Your Domain):

${ctx.startPrefix}analyze_data
${ctx.argPrefix}dataset
sales_2024
${ctx.argPrefix}metrics
revenue,growth,churn
${ctx.endPrefix}
  `,
})
```

## Context Object

Template functions receive a `PromptContext` object:

```typescript
interface PromptContext {
  startPrefix: string;   // e.g., "!!!GADGET_START:"
  endPrefix: string;     // e.g., "!!!GADGET_END"
  argPrefix: string;     // e.g., "!!!ARG:"
  gadgetCount: number;   // Number of registered gadgets
  gadgetNames: string[]; // Names of all gadgets
}
```

## Hint Templates

You can also customize the hints that guide LLM behavior during execution:

### parallelGadgetsHint

Shown when the LLM uses only one gadget per response:

```typescript
.withPromptTemplateConfig({
  parallelGadgetsHint: "Pro tip: Call multiple gadgets at once for faster execution!",
})
```

**Default:** `"Tip: You can call multiple gadgets in a single response for efficiency."`

### iterationProgressHint

Informs the LLM about iteration progress. Supports placeholders:

```typescript
.withPromptTemplateConfig({
  // String with placeholders
  iterationProgressHint: "Turn {iteration} of {maxIterations}. {remaining} turns remaining.",

  // Or a function
  iterationProgressHint: (ctx) =>
    ctx.remaining <= 2
      ? `URGENT: Only ${ctx.remaining} turns left!`
      : `Progress: ${ctx.iteration}/${ctx.maxIterations}`,
})
```

**Default:** `"[Iteration {iteration}/{maxIterations}] Plan your actions accordingly."`

## Use Cases

### Multilingual Prompts

```typescript
.withPromptTemplateConfig({
  mainInstruction: "WICHTIG: Verwende die Gadget-Marker unten. Keine Funktionsaufrufe.",
  criticalUsage: "RUFE Gadgets mit den Markern auf - beschreibe nicht deine Absichten.",
  rules: [
    "Gib nur reinen Text mit den exakten Markern aus",
    "Du kannst mehrere Gadgets parallel aufrufen",
  ],
})
```

### Strict Mode

```typescript
.withPromptTemplateConfig({
  mainInstruction: `
    STRICT MODE ENABLED.
    You MUST follow these rules EXACTLY.
    Any deviation will result in task failure.
    Use ONLY the text markers below.
  `,
  rules: [
    "NO exceptions to the format rules",
    "Verify each gadget call before output",
    "Report any uncertainties via AskUser gadget",
  ],
})
```

### Domain-Specific Context

```typescript
.withPromptTemplateConfig({
  rules: (ctx) => [
    "This is a medical research assistant",
    "Always cite sources when providing information",
    "Use the SearchPubMed gadget for literature searches",
    `Available tools: ${ctx.gadgetNames.join(', ')}`,
  ],
})
```

## See Also

- [Creating Gadgets](/library/guides/creating-gadgets/) - Define custom gadgets
- [Hints System](/library/advanced/hints/) - Advanced hint configuration
- [Agent Builder](/library/guides/agent-builder/) - Full builder API reference
