---
title: Multimodal
description: Image and speech generation
---

llmist supports image and speech generation with automatic cost tracking.

## Image Generation

```typescript
const result = await client.image.generate({
  model: 'dall-e-3',
  prompt: 'A 1990s desktop computer with flying toasters as a screensaver',
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
  prompt: '8-bit pixel art of a floppy disk with legs running away',
  responseFormat: 'b64_json',
});

const buffer = Buffer.from(result.images[0].b64Json!, 'base64');
fs.writeFileSync('floppy.png', buffer);
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
llmist image "A Windows 95 error dialog that says 'Success'" -m dall-e-3 -o success.png

# Speech
llmist speech "You've got mail!" -m tts-1 --voice nova -o aol.mp3
```

## Using with Gadgets

```typescript
class ScreenSaverGenerator extends Gadget({
  description: 'Generates a 90s-style screensaver image',
  schema: z.object({
    style: z.enum(['flying-toasters', '3d-pipes', 'starfield', 'maze']),
  }),
}) {
  async execute(params: this['params'], ctx?: ExecutionContext): Promise<string> {
    const result = await ctx!.llmist.image.generate({
      model: 'dall-e-3',
      prompt: `A ${params.style} screensaver in the style of Windows 95`,
    });
    // Cost is automatically tracked!
    return result.images[0]?.url ?? 'Screensaver generated';
  }
}
```

## See Also

- [Examples: Image Generation](https://github.com/zbigniewsobiecki/llmist/blob/main/examples/16-image-generation.ts)
- [Examples: Speech Generation](https://github.com/zbigniewsobiecki/llmist/blob/main/examples/17-speech-generation.ts)
