# Multimodal Generation

llmist supports image and speech (text-to-speech) generation with automatic cost tracking.

## Quick Start

```typescript
import { LLMist } from 'llmist';

const client = new LLMist();

// Generate an image
const imageResult = await client.image.generate({
  model: 'dall-e-3',
  prompt: 'A serene mountain landscape at sunset',
  size: '1024x1024',
  quality: 'hd',
});
console.log('Image URL:', imageResult.images[0].url);
console.log('Cost:', imageResult.cost);

// Generate speech
const speechResult = await client.speech.generate({
  model: 'tts-1-hd',
  input: 'Hello, welcome to llmist!',
  voice: 'nova',
});
// Save audio: fs.writeFileSync('output.mp3', Buffer.from(speechResult.audio));
console.log('Cost:', speechResult.cost);
```

## Image Generation

### Supported Models

| Model | Provider | Quality Levels | Sizes | Notes |
|-------|----------|----------------|-------|-------|
| `dall-e-3` | OpenAI | standard, hd | 1024x1024, 1024x1792, 1792x1024 | Best quality, revised prompts |
| `dall-e-2` | OpenAI | - | 256x256, 512x512, 1024x1024 | Legacy, faster |
| `gpt-image-1` | OpenAI | low, medium, high | 1024x1024, 1024x1536, 1536x1024 | Text rendering, transparency |
| `gpt-image-1-mini` | OpenAI | low, medium, high | 1024x1024, 1024x1536, 1536x1024 | Cost-effective |
| `imagen-3.0-generate-002` | Google | - | 1:1, 3:4, 4:3, 9:16, 16:9 | Imagen 3 |

### API Reference

```typescript
const result = await client.image.generate({
  model: string,           // Model ID (e.g., 'dall-e-3')
  prompt: string,          // Image description
  size?: string,           // Image dimensions (default varies by model)
  quality?: string,        // Quality level (model-specific)
  n?: number,              // Number of images (DALL-E 3 only supports 1)
  responseFormat?: 'url' | 'b64_json',  // Response type
});

// Result
{
  images: [
    {
      url?: string,           // Image URL (if responseFormat: 'url')
      b64Json?: string,       // Base64 data (if responseFormat: 'b64_json')
      revisedPrompt?: string, // DALL-E 3's enhanced prompt
    }
  ],
  model: string,
  usage: {
    imagesGenerated: number,
    size: string,
    quality: string,
  },
  cost?: number,  // USD cost
}
```

### Examples

**Save image to file:**
```typescript
const result = await client.image.generate({
  model: 'dall-e-3',
  prompt: 'A robot learning to paint',
  responseFormat: 'b64_json',
});

const buffer = Buffer.from(result.images[0].b64Json!, 'base64');
fs.writeFileSync('robot.png', buffer);
```

**List available image models:**
```typescript
const models = client.image.listModels();
for (const model of models) {
  console.log(`${model.modelId}: ${model.displayName}`);
  console.log(`  Sizes: ${model.supportedSizes?.join(', ')}`);
}
```

## Speech Generation (TTS)

### Supported Models

| Model | Provider | Voices | Formats | Speed Range |
|-------|----------|--------|---------|-------------|
| `tts-1` | OpenAI | alloy, echo, fable, onyx, nova, shimmer | mp3, opus, aac, flac, wav, pcm | 0.25-4.0 |
| `tts-1-hd` | OpenAI | alloy, echo, fable, onyx, nova, shimmer | mp3, opus, aac, flac, wav, pcm | 0.25-4.0 |

### API Reference

```typescript
const result = await client.speech.generate({
  model: string,           // Model ID (e.g., 'tts-1-hd')
  input: string,           // Text to convert to speech
  voice: string,           // Voice name
  responseFormat?: string, // Audio format (default: 'mp3')
  speed?: number,          // Speed multiplier (0.25-4.0, default: 1.0)
});

// Result
{
  audio: ArrayBuffer,    // Audio data
  model: string,
  usage: {
    characterCount: number,
  },
  cost?: number,         // USD cost
  format: string,        // Audio format
}
```

### Examples

**Generate and save speech:**
```typescript
import { writeFileSync } from 'fs';

const result = await client.speech.generate({
  model: 'tts-1-hd',
  input: 'Welcome to llmist, the streaming LLM framework!',
  voice: 'nova',
  responseFormat: 'mp3',
});

writeFileSync('welcome.mp3', Buffer.from(result.audio));
console.log(`Generated ${result.usage.characterCount} characters`);
console.log(`Cost: $${result.cost?.toFixed(6)}`);
```

**Different voices:**
```typescript
const voices = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];

for (const voice of voices) {
  const result = await client.speech.generate({
    model: 'tts-1',
    input: `This is the ${voice} voice.`,
    voice,
  });
  writeFileSync(`${voice}.mp3`, Buffer.from(result.audio));
}
```

**Adjust speed:**
```typescript
// Slower, more dramatic
await client.speech.generate({
  model: 'tts-1',
  input: 'The suspense is building...',
  voice: 'onyx',
  speed: 0.8,
});

// Faster, excited
await client.speech.generate({
  model: 'tts-1',
  input: 'Amazing news everyone!',
  voice: 'nova',
  speed: 1.3,
});
```

## Cost Tracking

Both image and speech generation include automatic cost calculation:

```typescript
const imageResult = await client.image.generate({
  model: 'dall-e-3',
  prompt: 'A sunset',
  quality: 'hd',
});
console.log(`Image cost: $${imageResult.cost}`);  // e.g., $0.08

const speechResult = await client.speech.generate({
  model: 'tts-1-hd',
  input: 'Hello world',
  voice: 'nova',
});
console.log(`Speech cost: $${speechResult.cost?.toFixed(6)}`);  // e.g., $0.000330
```

### Pricing (as of December 2025)

**Image Generation:**
| Model | Size | Standard | HD |
|-------|------|----------|-----|
| DALL-E 3 | 1024x1024 | $0.040 | $0.080 |
| DALL-E 3 | 1024x1792, 1792x1024 | $0.080 | $0.120 |
| DALL-E 2 | 256x256 | $0.016 | - |
| DALL-E 2 | 512x512 | $0.018 | - |
| DALL-E 2 | 1024x1024 | $0.020 | - |

**Speech Generation:**
| Model | Price per 1M characters |
|-------|------------------------|
| TTS-1 | $15.00 |
| TTS-1-HD | $30.00 |

## Using with Gadgets

Multimodal generation works seamlessly with gadgets for automatic cost tracking:

```typescript
import { createGadget, LLMist } from 'llmist';
import { z } from 'zod';
import { writeFileSync } from 'fs';

const ImageGenerator = createGadget({
  description: 'Generates an image from a text prompt',
  schema: z.object({
    prompt: z.string().describe('Description of the image'),
    style: z.enum(['realistic', 'artistic', 'cartoon']),
  }),
  execute: async (params, ctx) => {
    if (!ctx?.llmist) return 'Error: LLMist client not available';

    const stylePrompts = {
      realistic: 'photorealistic, high detail',
      artistic: 'oil painting style, expressive',
      cartoon: 'cartoon illustration, colorful',
    };

    const result = await ctx.llmist.image.generate({
      model: 'dall-e-3',
      prompt: `${params.prompt}, ${stylePrompts[params.style]}`,
    });

    // Cost is automatically tracked via ExecutionContext!
    return result.images[0]?.url ?? 'Image generated';
  },
});

// Run agent with the gadget
const result = await LLMist.createAgent()
  .withModel('haiku')
  .withGadgets(ImageGenerator)
  .askWith('Create an artistic image of a sunset', {
    onSummary: (summary) => {
      console.log(`Total cost: $${summary.cost.toFixed(4)}`);
      // Includes both LLM and image generation costs
    },
  });
```

## CLI Commands

### Image Generation

```bash
# Generate with DALL-E 3
llmist image "A cat wearing a top hat" -m dall-e-3 -o cat.png

# HD quality, specific size
llmist image "Mountain landscape" -m dall-e-3 --quality hd --size 1792x1024 -o mountains.png

# Multiple images (DALL-E 2)
llmist image "Abstract art" -m dall-e-2 --count 3
```

### Speech Generation

```bash
# Generate speech
llmist speech "Hello, world!" -m tts-1 --voice nova -o hello.mp3

# HD quality with different voice
llmist speech "Welcome to the future" -m tts-1-hd --voice onyx -o welcome.mp3

# Adjust speed
llmist speech "Slow and dramatic" -m tts-1 --voice onyx --speed 0.8 -o slow.mp3

# Pipe text input
cat script.txt | llmist speech -m tts-1 --voice nova -o script.mp3
```

## Configuration

Configure defaults in `~/.llmist/cli.toml`:

```toml
[image]
model = "dall-e-3"
size = "1024x1024"
quality = "standard"

[speech]
model = "tts-1"
voice = "nova"
format = "mp3"
speed = 1.0
```

## Error Handling

### Provider Support

Not all providers support multimodal generation:

```typescript
// Anthropic doesn't support image/speech generation
const anthropicClient = new LLMist({ defaultProvider: 'anthropic' });

try {
  await anthropicClient.image.generate({ model: 'dall-e-3', prompt: 'Test' });
} catch (error) {
  // Error: No provider supports image generation for model "dall-e-3"
}
```

### Model-Specific Limitations

```typescript
// DALL-E 3 only supports n=1
await client.image.generate({
  model: 'dall-e-3',
  prompt: 'Test',
  n: 5,  // Will be ignored, only 1 image generated
});

// DALL-E 2 doesn't support quality parameter
// (automatically handled - quality param is omitted)
```

## See Also

- [Examples: Image Generation](../examples/16-image-generation.ts)
- [Examples: Speech Generation](../examples/17-speech-generation.ts)
- [Examples: Multimodal Gadget](../examples/18-multimodal-gadget.ts)
- [CLI Reference](./CLI.md)
- [Configuration](./CONFIGURATION.md)
