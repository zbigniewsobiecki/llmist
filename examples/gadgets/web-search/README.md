# Web Search Gadgets

Example gadgets for web search capabilities.

## GoogleSearch

Search the web using Google Custom Search API. Returns results with rich metadata including source info, content type, and publication dates when available.

### Setup

1. Get a Google API key from [Google Cloud Console](https://console.cloud.google.com/)
2. Create a Custom Search Engine at [Programmable Search Engine](https://programmablesearchengine.google.com/)
3. Set environment variables:

```bash
export GOOGLE_SEARCH_API_KEY="your-api-key"
export GOOGLE_SEARCH_ENGINE_ID="your-search-engine-id"
```

### Parameters

- `query` (string, required): Search query (2-5 words recommended)
- `maxResults` (number, 1-10, default: 10): Maximum results to return

### Query Operators

| Operator | Example | Description |
|----------|---------|-------------|
| `site:` | `site:github.com react` | Search within a domain |
| `"..."` | `"exact phrase"` | Match exact phrase |
| `-word` | `javascript -jquery` | Exclude term |
| `filetype:` | `api guide filetype:pdf` | Find specific file types |
| `intitle:` | `intitle:changelog` | Term must be in title |

### Output Format

```
Search results for "typescript generics" (3 of 12400000 results, 0.42s):

1. TypeScript: Documentation - Generics
   URL: https://www.typescriptlang.org/docs/handbook/2/generics.html
   Source: TypeScript | documentation
   A major part of software engineering is building components...

2. Understanding TypeScript Generics – Smashing Magazine
   URL: https://www.smashingmagazine.com/2020/10/understanding-generics/
   Source: Smashing Magazine | article | Oct 15, 2020
   TypeScript generics are one of the most powerful features...
```

The `Source:` line includes:
- **Site name**: From OpenGraph `og:site_name` or domain
- **Content type**: From `og:type` (article, video, product) or file format (pdf)
- **Publication date**: From `article:published_time` when available

### Usage

```typescript
import { LLMist } from "llmist";
import { googleSearch } from "./gadgets/web-search/index.js";

const agent = LLMist.createAgent()
  .withModel("gpt-4o-mini")
  .withGadgets(googleSearch);

const result = await agent.ask("Find the latest TypeScript 5.0 features");
```

### CLI Usage

```bash
npx tsx src/cli.ts agent "Search for React hooks tutorials" \
  --gadget ./examples/gadgets/web-search/index.ts
```

### Best Practices

1. **Keep queries short** - 2-5 words work best
2. **Use one quoted phrase max** - Multiple quotes often return no results
3. **Avoid OR/AND operators** - They frequently cause "no results"
4. **Simplify on failure** - If a query fails, remove quotes and reduce words
5. **Use site: for authority** - `site:docs.python.org` for official docs
