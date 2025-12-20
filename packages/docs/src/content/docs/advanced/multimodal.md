---
title: Multimodal
description: Image and speech generation
---

llmist supports image and speech generation with automatic cost tracking.

## Image Generation

```typescript
const result = await client.image.generate({
  model: 'dall-e-3',
  prompt: 'A serene mountain landscape at sunset',
  size: '1024x1024',
  quality: 'hd',
});
console.log('Image URL:', result.images[0].url);
console.log('Cost:', result.cost);
```

### Supported Models

| Model | Provider | Quality | Sizes |
|-------|----------|---------|-------|
| `dall-e-3` | OpenAI | standard, hd | 1024x1024, 1024x1792, 1792x1024 |
| `dall-e-2` | OpenAI | - | 256x256, 512x512, 1024x1024 |
| `gpt-image-1` | OpenAI | low, medium, high | 1024x1024, 1024x1536, 1536x1024 |

### Save to File

```typescript
const result = await client.image.generate({
  model: 'dall-e-3',
  prompt: 'A robot learning to paint',
  responseFormat: 'b64_json',
});

const buffer = Buffer.from(result.images[0].b64Json!, 'base64');
fs.writeFileSync('robot.png', buffer);
```

## Speech Generation (TTS)

```typescript
const result = await client.speech.generate({
  model: 'tts-1-hd',
  input: 'Hello, welcome to llmist!',
  voice: 'nova',
});
fs.writeFileSync('output.mp3', Buffer.from(result.audio));
console.log('Cost:', result.cost);
```

### Supported Models

| Model | Provider | Voices |
|-------|----------|--------|
| `tts-1` | OpenAI | alloy, echo, fable, onyx, nova, shimmer |
| `tts-1-hd` | OpenAI | alloy, echo, fable, onyx, nova, shimmer |

## CLI Commands

```bash
# Image
llmist image "A cat wearing a top hat" -m dall-e-3 -o cat.png

# Speech
llmist speech "Hello, world!" -m tts-1 --voice nova -o hello.mp3
```

## Using with Gadgets

```typescript
const ImageGenerator = createGadget({
  description: 'Generates an image',
  schema: z.object({
    prompt: z.string(),
  }),
  execute: async (params, ctx) => {
    const result = await ctx.llmist.image.generate({
      model: 'dall-e-3',
      prompt: params.prompt,
    });
    // Cost is automatically tracked!
    return result.images[0]?.url ?? 'Image generated';
  },
});
```

## See Also

- [Examples: Image Generation](https://github.com/zbigniewsobiecki/llmist/blob/main/examples/16-image-generation.ts)
- [Examples: Speech Generation](https://github.com/zbigniewsobiecki/llmist/blob/main/examples/17-speech-generation.ts)
