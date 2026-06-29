/**
 * Progressive gadget-argument streaming
 *
 * Render a gadget's arguments LIVE, as the model streams them — e.g. a form that
 * fills in field-by-field while a long value (`bio`) is still being written.
 *
 * The key event is `gadget_args_partial`: it carries the growing RAW value of one
 * argument field BEFORE the gadget block completes. Every partial shares the final
 * `gadget_call`'s `invocationId`, and all partials precede that `gadget_call`.
 *
 * A tiny inline mock adapter streams a canned response, so this runs with no API
 * key. (See the bottom of the file — it's just test scaffolding.)
 *
 * Run: npx tsx examples/31-progressive-form.ts
 */

import {
  AgentBuilder,
  GADGET_ARG_PREFIX,
  GADGET_END_PREFIX,
  GADGET_START_PREFIX,
  Gadget,
  LLMist,
  type LLMStream,
  type LLMStreamChunk,
  type ProviderAdapter,
} from "llmist";
import { z } from "zod";

// A gadget the agent calls to fill in a form. `bio` is a long text field that
// streams in progressively.
class FillForm extends Gadget({
  description: "Fill in the signup form",
  schema: z.object({
    name: z.string(),
    email: z.string(),
    bio: z.string(),
  }),
}) {
  execute(params: this["params"]): string {
    return `Saved signup form for ${params.name}`;
  }
}

async function main() {
  const agent = new AgentBuilder(mockClient(FORM_CALL))
    .withModel("mock:demo")
    .withGadgets(FillForm)
    .withMaxIterations(1) // one streamed call; don't loop back to the mock
    .ask("Fill in the signup form for Ada Lovelace.");

  console.log("=== Progressive form fill (watch `bio` grow) ===\n");

  const form = new Map<string, { value: string; done: boolean }>();
  let renderedLines = 0;

  const redraw = () => {
    const lines = [...form.entries()].map(
      ([field, { value, done }]) => `  ${field.padEnd(6)}: ${value}${done ? "  ✓" : " ▏"}`,
    );
    // On a TTY, move the cursor up over the previous render to update in place.
    if (process.stdout.isTTY && renderedLines > 0) process.stdout.write(`\x1b[${renderedLines}A`);
    process.stdout.write(`${lines.join("\n")}\n`);
    renderedLines = lines.length;
  };

  for await (const event of agent.run()) {
    if (event.type === "gadget_args_partial") {
      // `value` is the FULL accumulated value so far — prefer it over `delta`.
      form.set(event.fieldPath, { value: event.value, done: event.isFieldComplete });
      redraw();
    } else if (event.type === "gadget_call") {
      // The authoritative, validated + coerced parameters.
      console.log("\n[gadget_call] final parameters:");
      console.log(event.call.parameters);
    } else if (event.type === "gadget_result") {
      console.log(`[gadget_result] ${event.result.result}`);
    }
  }

  console.log("\n=== Done ===");
  console.log(
    "\nThe same data is also available via the `onGadgetArgsPartial` observer\n" +
      "(.withHooks({ observers: { onGadgetArgsPartial } })) and the\n" +
      "`onGadgetArgsPartial` handler for `agent.runWith(...)`.",
  );
}

// The exact block-format call the model "streams" back. The mock chunks it.
const FORM_CALL = [
  `${GADGET_START_PREFIX}FillForm`,
  `${GADGET_ARG_PREFIX}name`,
  "Ada Lovelace",
  `${GADGET_ARG_PREFIX}email`,
  "ada@analytical.engine",
  `${GADGET_ARG_PREFIX}bio`,
  "Mathematician and writer, best known for her work on Charles Babbage's " +
    "Analytical Engine — and for being arguably the first computer programmer.",
  GADGET_END_PREFIX,
].join("\n");

// --- test scaffolding: a tiny mock LLM so this runs with no API key ---
// Streams `responseText` back in small fixed-size chunks (chunking is what
// produces the progressive `gadget_args_partial` events).
function mockClient(responseText: string): LLMist {
  const CHUNK = 7;
  const adapter: ProviderAdapter = {
    providerId: "mock",
    supports: () => true,
    stream(): LLMStream {
      return (async function* () {
        for (let i = 0; i < responseText.length; i += CHUNK) {
          const isLast = i + CHUNK >= responseText.length;
          const chunk: LLMStreamChunk = { text: responseText.slice(i, i + CHUNK) };
          if (isLast) chunk.finishReason = "stop";
          yield chunk;
        }
      })();
    },
  };
  return new LLMist({ adapters: [adapter], autoDiscoverProviders: false, defaultProvider: "mock" });
}

main().catch(console.error);
