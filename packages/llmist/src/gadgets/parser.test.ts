import { beforeEach, describe, expect, it } from "vitest";
import { collectSyncEvents } from "../../../testing/src/helpers.js";
import { GADGET_ARG_PREFIX, GADGET_END_PREFIX, GADGET_START_PREFIX } from "../core/constants.js";
import { GadgetCallParser, resetGlobalInvocationCounter } from "./parser.js";
import type { StreamEvent } from "./types.js";

describe("GadgetCallParser", () => {
  let parser: GadgetCallParser;

  beforeEach(() => {
    resetGlobalInvocationCounter();
    parser = new GadgetCallParser();
  });

  describe("basic parsing", () => {
    it("parses plain text without gadgets", () => {
      const events = collectSyncEvents(parser.feed("Hello, world!"));
      expect(events).toEqual([]);

      const finalEvents = collectSyncEvents(parser.finalize());
      expect(finalEvents).toEqual([{ type: "text", content: "Hello, world!" }]);
    });

    it("parses a single gadget call with block format", () => {
      const input = `${GADGET_START_PREFIX}TestGadget
${GADGET_ARG_PREFIX}message
Hello
${GADGET_ARG_PREFIX}count
42
${GADGET_END_PREFIX}`;

      const events = collectSyncEvents(parser.feed(input));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "TestGadget",
          invocationId: "gadget_1",
          parameters: {
            message: "Hello",
            count: 42, // Block format coerces numeric strings to numbers
          },
        },
      });
    });

    it("parses text before gadget with new format", () => {
      const input = `Some text before
${GADGET_START_PREFIX}TestGadget
${GADGET_ARG_PREFIX}value
test
${GADGET_END_PREFIX}`;

      const events = collectSyncEvents(parser.feed(input));

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({ type: "text", content: "Some text before\n" });
      expect(events[1]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "TestGadget",
          invocationId: "gadget_1",
        },
      });
    });

    it("parses gadget immediately after inline text without newline", () => {
      const input = `Some text before${GADGET_START_PREFIX}TestGadget
${GADGET_ARG_PREFIX}value
test
${GADGET_END_PREFIX}`;

      const events = collectSyncEvents(parser.feed(input));

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({ type: "text", content: "Some text before" });
      expect(events[1]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "TestGadget",
          invocationId: "gadget_1",
        },
      });
    });

    it("parses text after gadget in finalize with new format", () => {
      const input = `${GADGET_START_PREFIX}TestGadget
${GADGET_ARG_PREFIX}data
value
${GADGET_END_PREFIX}
Text after gadget`;

      const events = collectSyncEvents(parser.feed(input));
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("gadget_call");

      const finalEvents = collectSyncEvents(parser.finalize());
      expect(finalEvents).toEqual([{ type: "text", content: "\nText after gadget" }]);
    });
  });

  describe("block format parameters", () => {
    it("parses multiline values", () => {
      const input = `${GADGET_START_PREFIX}WriteFile
${GADGET_ARG_PREFIX}filePath
README.md
${GADGET_ARG_PREFIX}content
# Title

This is multiline content.
- Item 1
- Item 2
${GADGET_END_PREFIX}`;

      const events = collectSyncEvents(parser.feed(input));

      expect(events).toHaveLength(1);
      const event = events[0];
      expect(event?.type).toBe("gadget_call");

      if (event?.type === "gadget_call") {
        expect(event.call.parameters?.filePath).toBe("README.md");
        const content = event.call.parameters?.content as string;
        expect(content).toContain("# Title");
        expect(content).toContain("- Item 1");
        expect(content).toContain("- Item 2");
      }
    });

    it("parses nested objects with JSON Pointer paths", () => {
      const input = `${GADGET_START_PREFIX}Config
${GADGET_ARG_PREFIX}config/timeout
30
${GADGET_ARG_PREFIX}config/retries
3
${GADGET_END_PREFIX}`;

      const events = collectSyncEvents(parser.feed(input));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "Config",
          parameters: {
            config: { timeout: 30, retries: 3 }, // Numbers coerced from strings
          },
        },
      });
    });

    it("parses arrays with numeric indices", () => {
      const input = `${GADGET_START_PREFIX}ArrayTest
${GADGET_ARG_PREFIX}items/0
first
${GADGET_ARG_PREFIX}items/1
second
${GADGET_ARG_PREFIX}items/2
third
${GADGET_END_PREFIX}`;

      const events = collectSyncEvents(parser.feed(input));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "ArrayTest",
          parameters: {
            items: ["first", "second", "third"],
          },
        },
      });
    });

    it("handles code content without escaping", () => {
      const input = `${GADGET_START_PREFIX}WriteCode
${GADGET_ARG_PREFIX}filename
example.ts
${GADGET_ARG_PREFIX}code
function hello() {
  console.log("Hello, World!");
  return { key: "value" };
}
${GADGET_END_PREFIX}`;

      const events = collectSyncEvents(parser.feed(input));

      expect(events).toHaveLength(1);
      const event = events[0];
      if (event?.type === "gadget_call") {
        const code = event.call.parameters?.code as string;
        expect(code).toContain("function hello()");
        expect(code).toContain('console.log("Hello, World!")');
        expect(code).toContain('{ key: "value" }');
      }
    });
  });

  describe("multiple gadgets", () => {
    it("parses multiple consecutive gadgets with block format", () => {
      const input = `${GADGET_START_PREFIX}Adder
${GADGET_ARG_PREFIX}a
5
${GADGET_ARG_PREFIX}b
3
${GADGET_END_PREFIX}
${GADGET_START_PREFIX}Multiplier
${GADGET_ARG_PREFIX}x
2
${GADGET_ARG_PREFIX}y
4
${GADGET_END_PREFIX}`;

      const events = collectSyncEvents(parser.feed(input));

      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "Adder",
          invocationId: "gadget_1",
          parameters: { a: 5, b: 3 },
        },
      });
      expect(events[1]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "Multiplier",
          invocationId: "gadget_2",
          parameters: { x: 2, y: 4 },
        },
      });
    });

    it("parses gadgets with text between them", () => {
      const input = `Start
${GADGET_START_PREFIX}First
${GADGET_ARG_PREFIX}param
one
${GADGET_END_PREFIX}
Middle text
${GADGET_START_PREFIX}Second
${GADGET_ARG_PREFIX}param
two
${GADGET_END_PREFIX}
End`;

      const events = collectSyncEvents(parser.feed(input));

      expect(events).toHaveLength(4);
      expect(events[0]).toEqual({ type: "text", content: "Start\n" });
      expect(events[1]?.type).toBe("gadget_call");
      expect(events[2]).toEqual({ type: "text", content: "\nMiddle text\n" });
      expect(events[3]?.type).toBe("gadget_call");

      const finalEvents = collectSyncEvents(parser.finalize());
      expect(finalEvents).toEqual([{ type: "text", content: "\nEnd" }]);
    });

    it("parses multiple consecutive gadgets without newlines between them", () => {
      const input = `Let's get started.${GADGET_START_PREFIX}SetTodoStatus
${GADGET_ARG_PREFIX}index
1
${GADGET_ARG_PREFIX}status
done
${GADGET_END_PREFIX}${GADGET_START_PREFIX}SetTodoStatus
${GADGET_ARG_PREFIX}index
2
${GADGET_ARG_PREFIX}status
in_progress
${GADGET_END_PREFIX}`;

      const events = collectSyncEvents(parser.feed(input));

      expect(events).toHaveLength(3);
      expect(events[0]).toEqual({ type: "text", content: "Let's get started." });
      expect(events[1]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "SetTodoStatus",
          invocationId: "gadget_1",
          parameters: { index: 1, status: "done" },
        },
      });
      expect(events[2]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "SetTodoStatus",
          invocationId: "gadget_2",
          parameters: { index: 2, status: "in_progress" },
        },
      });
    });
  });

  describe("incomplete data handling", () => {
    it("waits for complete gadget before yielding", () => {
      // Feed incomplete gadget (missing end marker)
      const events1 = collectSyncEvents(
        parser.feed(`${GADGET_START_PREFIX}TestGadget
${GADGET_ARG_PREFIX}message
incomplete`),
      );

      // The gadget_call is not yielded until the block completes (partials may stream).
      expect(events1.filter((e) => e.type === "gadget_call")).toEqual([]);

      // Complete the gadget
      const events2 = collectSyncEvents(parser.feed(`\n${GADGET_END_PREFIX}`));

      const calls2 = events2.filter((e) => e.type === "gadget_call");
      expect(calls2).toHaveLength(1);
      expect(calls2[0]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "TestGadget",
          parameters: { message: "incomplete" },
        },
      });
    });

    it("waits for newline after gadget name", () => {
      const events1 = collectSyncEvents(parser.feed(`${GADGET_START_PREFIX}TestGadget`));
      expect(events1).toEqual([]);

      const events2 = collectSyncEvents(
        parser.feed(`
${GADGET_ARG_PREFIX}param
value
${GADGET_END_PREFIX}`),
      );
      expect(events2).toHaveLength(1);
    });

    it("handles streaming text chunk by chunk", () => {
      const chunks = [
        "Hello ",
        "world! ",
        `${GADGET_START_PREFIX}Test\n`,
        `${GADGET_ARG_PREFIX}data\n`,
        "123\n",
        `${GADGET_END_PREFIX}`,
        " Done",
      ];

      let allEvents: StreamEvent[] = [];
      for (const chunk of chunks) {
        allEvents = [...allEvents, ...collectSyncEvents(parser.feed(chunk))];
      }

      expect(allEvents.length).toBeGreaterThanOrEqual(2);
      expect(allEvents.some((e) => e.type === "text")).toBe(true);
      expect(allEvents.some((e) => e.type === "gadget_call")).toBe(true);
    });
  });

  describe("error handling", () => {
    it("handles invalid block format gracefully", () => {
      // Block format should still parse even with unusual content
      const input = `${GADGET_START_PREFIX}TestGadget
${GADGET_ARG_PREFIX}bad
[invalid: {content
${GADGET_END_PREFIX}`;

      const events = collectSyncEvents(parser.feed(input));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "TestGadget",
          parameters: { bad: "[invalid: {content" },
        },
      });
    });

    it("handles empty parameters", () => {
      const input = `${GADGET_START_PREFIX}EmptyGadget
${GADGET_END_PREFIX}`;

      const events = collectSyncEvents(parser.feed(input));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "EmptyGadget",
          parameters: {},
        },
      });
    });
  });

  describe("state management", () => {
    it("resets state correctly", () => {
      const input1 = `${GADGET_START_PREFIX}First
${GADGET_ARG_PREFIX}data
one
${GADGET_END_PREFIX}`;

      const events1 = collectSyncEvents(parser.feed(input1));
      expect(events1).toHaveLength(1);

      parser.reset();

      const input2 = `${GADGET_START_PREFIX}Second
${GADGET_ARG_PREFIX}data
two
${GADGET_END_PREFIX}`;

      const events2 = collectSyncEvents(parser.feed(input2));
      expect(events2).toHaveLength(1);
      expect(events2[0]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "Second",
        },
      });
    });

    it("handles finalize after reset", () => {
      parser.feed("Some text");
      parser.reset();

      const events = collectSyncEvents(parser.finalize());
      expect(events).toEqual([]);
    });
  });

  describe("custom prefixes", () => {
    it("uses custom start and end prefixes", () => {
      const customParser = new GadgetCallParser({
        startPrefix: "<<<START:",
        endPrefix: "<<<END:",
      });

      const input = `<<<START:CustomGadget
${GADGET_ARG_PREFIX}param
value
<<<END:`;

      const events = collectSyncEvents(customParser.feed(input));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "CustomGadget",
          parameters: { param: "value" },
        },
      });
    });

    it("does not parse default prefixes when using custom ones", () => {
      const customParser = new GadgetCallParser({
        startPrefix: "<<<START:",
        endPrefix: "<<<END:",
      });

      const input = `${GADGET_START_PREFIX}TestGadget
${GADGET_ARG_PREFIX}data
test
${GADGET_END_PREFIX}`;

      const events = collectSyncEvents(customParser.feed(input));
      expect(events).toEqual([]);

      const finalEvents = collectSyncEvents(customParser.finalize());
      expect(finalEvents[0]).toMatchObject({
        type: "text",
        content: expect.stringContaining(GADGET_START_PREFIX),
      });
    });

    it("generates globally unique IDs across multiple parser instances", () => {
      // First parser gets gadget_1
      const parser1 = new GadgetCallParser();
      const input = `${GADGET_START_PREFIX}TestGadget
${GADGET_ARG_PREFIX}x
1
${GADGET_END_PREFIX}`;
      const events1 = collectSyncEvents(parser1.feed(input));

      // Second parser gets gadget_2 (not gadget_1 again!)
      const parser2 = new GadgetCallParser();
      const events2 = collectSyncEvents(parser2.feed(input));

      // Third parser gets gadget_3
      const parser3 = new GadgetCallParser();
      const events3 = collectSyncEvents(parser3.feed(input));

      expect(events1[0]).toMatchObject({
        call: { invocationId: "gadget_1" },
      });
      expect(events2[0]).toMatchObject({
        call: { invocationId: "gadget_2" },
      });
      expect(events3[0]).toMatchObject({
        call: { invocationId: "gadget_3" },
      });
    });
  });

  describe("robust gadget termination", () => {
    it("parses gadget when stream ends without end marker", () => {
      const events = collectSyncEvents(
        parser.feed(`${GADGET_START_PREFIX}Test
${GADGET_ARG_PREFIX}key
value
`),
      );
      // During feed(), no gadget_call yet — only progressive partials.
      expect(events.filter((e) => e.type === "gadget_call")).toEqual([]);

      // On finalize, the incomplete gadget should be parsed
      const finalEvents = collectSyncEvents(parser.finalize());
      const finalCalls = finalEvents.filter((e) => e.type === "gadget_call");
      expect(finalCalls).toHaveLength(1);
      expect(finalCalls[0]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "Test",
          parameters: { key: "value" },
        },
      });
    });

    it("ends gadget when next gadget starts without end marker", () => {
      const events = collectSyncEvents(
        parser.feed(
          `${GADGET_START_PREFIX}First
${GADGET_ARG_PREFIX}a
1
${GADGET_START_PREFIX}Second
${GADGET_ARG_PREFIX}b
2
${GADGET_END_PREFIX}`,
        ),
      );

      // Should parse both gadgets - first one ends implicitly when second starts
      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "First",
          parameters: { a: 1 },
        },
      });
      expect(events[1]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "Second",
          parameters: { b: 2 },
        },
      });
    });

    it("handles text before incomplete gadget at stream end", () => {
      const events = collectSyncEvents(
        parser.feed(`Some text
${GADGET_START_PREFIX}Test
${GADGET_ARG_PREFIX}key
value`),
      );
      // During feed(), the text is yielded first (progressive partials may follow).
      expect(events[0]).toEqual({ type: "text", content: "Some text\n" });
      expect(events.filter((e) => e.type === "gadget_call")).toEqual([]);

      // On finalize, the incomplete gadget should be parsed
      const finalEvents = collectSyncEvents(parser.finalize());
      const finalCalls = finalEvents.filter((e) => e.type === "gadget_call");
      expect(finalCalls).toHaveLength(1);
      expect(finalCalls[0]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "Test",
          parameters: { key: "value" },
        },
      });
    });

    it("handles three consecutive gadgets without any end markers", () => {
      const events = collectSyncEvents(
        parser.feed(
          `${GADGET_START_PREFIX}First
${GADGET_ARG_PREFIX}a
1
${GADGET_START_PREFIX}Second
${GADGET_ARG_PREFIX}b
2
${GADGET_START_PREFIX}Third
${GADGET_ARG_PREFIX}c
3
`,
        ),
      );

      // First two should be parsed (each ends when next starts); Third streams partials.
      const calls = events.filter((e) => e.type === "gadget_call");
      expect(calls).toHaveLength(2);
      expect(calls[0]).toMatchObject({
        type: "gadget_call",
        call: { gadgetName: "First", parameters: { a: 1 } },
      });
      expect(calls[1]).toMatchObject({
        type: "gadget_call",
        call: { gadgetName: "Second", parameters: { b: 2 } },
      });

      // Third gadget parsed on finalize
      const finalEvents = collectSyncEvents(parser.finalize());
      const finalCalls = finalEvents.filter((e) => e.type === "gadget_call");
      expect(finalCalls).toHaveLength(1);
      expect(finalCalls[0]).toMatchObject({
        type: "gadget_call",
        call: { gadgetName: "Third", parameters: { c: 3 } },
      });
    });
  });
});

describe("stripMarkdownFences", () => {
  let stripMarkdownFences: (content: string) => string;

  beforeEach(async () => {
    const module = await import("./parser.js");
    stripMarkdownFences = module.stripMarkdownFences;
  });

  describe("various fences", () => {
    it("strips ```toml and ``` fences", () => {
      const input = `\`\`\`toml
command = "ls -la"
timeout = 30000
\`\`\``;
      const result = stripMarkdownFences(input);
      expect(result).toBe(`command = "ls -la"
timeout = 30000`);
    });

    it("strips ```json and ``` fences", () => {
      const input = `\`\`\`json
{"name": "test", "count": 42}
\`\`\``;
      const result = stripMarkdownFences(input);
      expect(result).toBe('{"name": "test", "count": 42}');
    });

    it("strips plain ``` fences without language specifier", () => {
      const input = `\`\`\`
command = "echo hello"
\`\`\``;
      const result = stripMarkdownFences(input);
      expect(result).toBe('command = "echo hello"');
    });
  });

  describe("no fences", () => {
    it("returns content unchanged when no fences present", () => {
      const input = `${GADGET_ARG_PREFIX}command
ls -la
${GADGET_ARG_PREFIX}timeout
30000`;
      const result = stripMarkdownFences(input);
      expect(result).toBe(input);
    });

    it("trims whitespace from content without fences", () => {
      const input = `  ${GADGET_ARG_PREFIX}command
ls  `;
      const result = stripMarkdownFences(input);
      expect(result).toBe(`${GADGET_ARG_PREFIX}command
ls`);
    });
  });

  describe("partial fences", () => {
    it("handles only opening fence", () => {
      const input = `\`\`\`toml
command = "test"`;
      const result = stripMarkdownFences(input);
      expect(result).toBe('command = "test"');
    });

    it("handles only closing fence", () => {
      const input = `command = "test"
\`\`\``;
      const result = stripMarkdownFences(input);
      expect(result).toBe('command = "test"');
    });
  });
});

describe("custom arg prefix", () => {
  beforeEach(() => {
    resetGlobalInvocationCounter();
  });

  it("uses custom arg prefix when specified", () => {
    const customParser = new GadgetCallParser({
      argPrefix: "@param:",
    });

    const input = `${GADGET_START_PREFIX}TestGadget
@param:message
Hello
@param:count
42
${GADGET_END_PREFIX}`;

    const events = collectSyncEvents(customParser.feed(input));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "gadget_call",
      call: {
        gadgetName: "TestGadget",
        parameters: {
          message: "Hello",
          count: 42, // Numbers are coerced
        },
      },
    });
  });
});

describe("parse error handling", () => {
  let parser: GadgetCallParser;

  beforeEach(() => {
    resetGlobalInvocationCounter();
    parser = new GadgetCallParser();
  });

  it("captures parse error when block format has duplicate pointers", () => {
    const input = `${GADGET_START_PREFIX}TestGadget
${GADGET_ARG_PREFIX}duplicate
first value
${GADGET_ARG_PREFIX}duplicate
second value
${GADGET_END_PREFIX}`;

    const events = collectSyncEvents(parser.feed(input));

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("gadget_call");

    if (events[0]?.type === "gadget_call") {
      expect(events[0].call.parseError).toBeDefined();
      expect(events[0].call.parseError).toContain("Duplicate pointer");
      expect(events[0].call.parameters).toBeUndefined();
    }
  });

  it("captures parse error when array indices have gaps", () => {
    const input = `${GADGET_START_PREFIX}TestGadget
${GADGET_ARG_PREFIX}items/0
first
${GADGET_ARG_PREFIX}items/5
skipped indices
${GADGET_END_PREFIX}`;

    const events = collectSyncEvents(parser.feed(input));

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("gadget_call");

    if (events[0]?.type === "gadget_call") {
      expect(events[0].call.parseError).toBeDefined();
      expect(events[0].call.parseError).toContain("Array index gap");
      expect(events[0].call.parameters).toBeUndefined();
    }
  });

  it("preserves full multi-line error messages without truncation", () => {
    // Create an error that would have multiple lines
    const input = `${GADGET_START_PREFIX}TestGadget
${GADGET_ARG_PREFIX}items/0
first
${GADGET_ARG_PREFIX}items/2
gap error - expected 1, got 2
${GADGET_END_PREFIX}`;

    const events = collectSyncEvents(parser.feed(input));

    expect(events).toHaveLength(1);
    if (events[0]?.type === "gadget_call") {
      // Error should contain full context, not just first line
      expect(events[0].call.parseError).toBeDefined();
      const errorMsg = events[0].call.parseError!;
      // The error should mention the specific gap (expected 1, got 2)
      expect(errorMsg).toContain("expected 1");
      expect(errorMsg).toContain("got 2");
    }
  });

  it("includes raw parameters in event even when parsing fails", () => {
    const input = `${GADGET_START_PREFIX}TestGadget
${GADGET_ARG_PREFIX}duplicate
value
${GADGET_ARG_PREFIX}duplicate
oops
${GADGET_END_PREFIX}`;

    const events = collectSyncEvents(parser.feed(input));

    expect(events).toHaveLength(1);
    if (events[0]?.type === "gadget_call") {
      expect(events[0].call.parametersRaw).toBeDefined();
      expect(events[0].call.parametersRaw).toContain("duplicate");
    }
  });

  describe("edge cases", () => {
    it("handles very long multiline content (>10KB)", () => {
      // Generate content larger than 10KB
      const longContent = "x".repeat(15000);
      const input = `${GADGET_START_PREFIX}TestGadget
${GADGET_ARG_PREFIX}content
${longContent}
${GADGET_END_PREFIX}`;

      const events = collectSyncEvents(parser.feed(input));

      expect(events).toHaveLength(1);
      if (events[0]?.type === "gadget_call") {
        expect(events[0].call.parameters?.content).toBe(longContent);
      }
    });

    it("handles interleaved feed/reset sequences", () => {
      // Feed partial gadget
      parser.feed(`${GADGET_START_PREFIX}Gadget1\n${GADGET_ARG_PREFIX}arg1\nval`);

      // Reset mid-stream
      parser.reset();

      // Feed new complete gadget
      const events = collectSyncEvents(
        parser.feed(`${GADGET_START_PREFIX}Gadget2
${GADGET_ARG_PREFIX}arg2
value2
${GADGET_END_PREFIX}`),
      );

      expect(events).toHaveLength(1);
      if (events[0]?.type === "gadget_call") {
        // Should only see Gadget2, not Gadget1
        expect(events[0].call.gadgetName).toBe("Gadget2");
        expect(events[0].call.parameters?.arg2).toBe("value2");
      }
    });

    it("handles partial -> complete -> partial transitions", () => {
      // Partial feed
      collectSyncEvents(parser.feed(`${GADGET_START_PREFIX}First\n${GADGET_ARG_PREFIX}a\n`));

      // Complete the first gadget and start a new partial
      const events = collectSyncEvents(
        parser.feed(
          `value1\n${GADGET_END_PREFIX}\nSome text\n${GADGET_START_PREFIX}Second\n${GADGET_ARG_PREFIX}b\nval`,
        ),
      );

      // Should have the completed first gadget
      expect(events.some((e) => e.type === "gadget_call" && e.call.gadgetName === "First")).toBe(
        true,
      );

      // Finalize to complete the second gadget
      const finalEvents = collectSyncEvents(parser.finalize());

      // Should have text and incomplete marker
      expect(finalEvents.length).toBeGreaterThan(0);
    });

    it("handles content with special characters", () => {
      const specialContent = `Line with "quotes"\nLine with 'apostrophes'\nLine with <brackets>\nLine with {braces}`;
      const input = `${GADGET_START_PREFIX}TestGadget
${GADGET_ARG_PREFIX}content
${specialContent}
${GADGET_END_PREFIX}`;

      const events = collectSyncEvents(parser.feed(input));

      expect(events).toHaveLength(1);
      if (events[0]?.type === "gadget_call") {
        expect(events[0].call.parameters?.content).toBe(specialContent);
      }
    });

    it("handles empty parameter value", () => {
      const input = `${GADGET_START_PREFIX}TestGadget
${GADGET_ARG_PREFIX}emptyParam

${GADGET_END_PREFIX}`;

      const events = collectSyncEvents(parser.feed(input));

      expect(events).toHaveLength(1);
      if (events[0]?.type === "gadget_call") {
        expect(events[0].call.parameters?.emptyParam).toBe("");
      }
    });

    it("handles rapid consecutive feeds", () => {
      // Simulate character-by-character streaming
      const fullInput = `${GADGET_START_PREFIX}TestGadget
${GADGET_ARG_PREFIX}msg
hello
${GADGET_END_PREFIX}`;

      let allEvents: StreamEvent[] = [];
      for (const char of fullInput) {
        allEvents = allEvents.concat(collectSyncEvents(parser.feed(char)));
      }

      const gadgetCalls = allEvents.filter((e) => e.type === "gadget_call");
      expect(gadgetCalls).toHaveLength(1);
      if (gadgetCalls[0]?.type === "gadget_call") {
        expect(gadgetCalls[0].call.gadgetName).toBe("TestGadget");
        expect(gadgetCalls[0].call.parameters?.msg).toBe("hello");
      }
    });

    it("handles unicode content correctly", () => {
      const unicodeContent = "こんにちは 🌍 مرحبا 中文";
      const input = `${GADGET_START_PREFIX}TestGadget
${GADGET_ARG_PREFIX}message
${unicodeContent}
${GADGET_END_PREFIX}`;

      const events = collectSyncEvents(parser.feed(input));

      expect(events).toHaveLength(1);
      if (events[0]?.type === "gadget_call") {
        expect(events[0].call.parameters?.message).toBe(unicodeContent);
      }
    });

    it("clears state properly after reset", () => {
      // Feed partial content
      parser.feed(`${GADGET_START_PREFIX}Partial\n${GADGET_ARG_PREFIX}arg\nvalue`);

      // Reset
      parser.reset();

      // Feed complete new content
      const events = collectSyncEvents(parser.feed(`Just plain text`));

      // Should have no events (plain text buffered)
      expect(events).toHaveLength(0);

      // Finalize should give us only the plain text
      const finalEvents = collectSyncEvents(parser.finalize());
      expect(finalEvents).toHaveLength(1);
      expect(finalEvents[0]).toEqual({ type: "text", content: "Just plain text" });
    });
  });
});

describe("dependency parsing", () => {
  let parser: GadgetCallParser;

  beforeEach(() => {
    resetGlobalInvocationCounter();
    parser = new GadgetCallParser();
  });

  it("parses gadget with no ID and no dependencies", () => {
    const input = `${GADGET_START_PREFIX}Calculator
${GADGET_ARG_PREFIX}a
5
${GADGET_END_PREFIX}`;

    const events = collectSyncEvents(parser.feed(input));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "gadget_call",
      call: {
        gadgetName: "Calculator",
        invocationId: "gadget_1",
        dependencies: [],
      },
    });
  });

  it("parses gadget with explicit ID and no dependencies", () => {
    const input = `${GADGET_START_PREFIX}Calculator:calc_1
${GADGET_ARG_PREFIX}a
5
${GADGET_END_PREFIX}`;

    const events = collectSyncEvents(parser.feed(input));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "gadget_call",
      call: {
        gadgetName: "Calculator",
        invocationId: "calc_1",
        dependencies: [],
      },
    });
  });

  it("parses gadget with explicit ID and single dependency", () => {
    const input = `${GADGET_START_PREFIX}Summarize:sum_1:fetch_1
${GADGET_ARG_PREFIX}format
json
${GADGET_END_PREFIX}`;

    const events = collectSyncEvents(parser.feed(input));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "gadget_call",
      call: {
        gadgetName: "Summarize",
        invocationId: "sum_1",
        dependencies: ["fetch_1"],
      },
    });
  });

  it("parses gadget with explicit ID and multiple dependencies", () => {
    const input = `${GADGET_START_PREFIX}MergeData:merge_1:fetch_1,fetch_2,fetch_3
${GADGET_ARG_PREFIX}format
json
${GADGET_END_PREFIX}`;

    const events = collectSyncEvents(parser.feed(input));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "gadget_call",
      call: {
        gadgetName: "MergeData",
        invocationId: "merge_1",
        dependencies: ["fetch_1", "fetch_2", "fetch_3"],
      },
    });
  });

  it("trims whitespace around dependency IDs", () => {
    const input = `${GADGET_START_PREFIX}Process:proc_1:dep_1, dep_2 , dep_3
${GADGET_ARG_PREFIX}data
test
${GADGET_END_PREFIX}`;

    const events = collectSyncEvents(parser.feed(input));

    expect(events).toHaveLength(1);
    if (events[0]?.type === "gadget_call") {
      expect(events[0].call.dependencies).toEqual(["dep_1", "dep_2", "dep_3"]);
    }
  });

  it("handles empty dependency list (trailing colon)", () => {
    const input = `${GADGET_START_PREFIX}Process:proc_1:
${GADGET_ARG_PREFIX}data
test
${GADGET_END_PREFIX}`;

    const events = collectSyncEvents(parser.feed(input));

    expect(events).toHaveLength(1);
    if (events[0]?.type === "gadget_call") {
      expect(events[0].call.invocationId).toBe("proc_1");
      expect(events[0].call.dependencies).toEqual([]);
    }
  });

  it("handles trailing comma in dependencies", () => {
    const input = `${GADGET_START_PREFIX}Process:proc_1:dep_1,dep_2,
${GADGET_ARG_PREFIX}data
test
${GADGET_END_PREFIX}`;

    const events = collectSyncEvents(parser.feed(input));

    expect(events).toHaveLength(1);
    if (events[0]?.type === "gadget_call") {
      expect(events[0].call.dependencies).toEqual(["dep_1", "dep_2"]);
    }
  });

  it("parses multiple gadgets with dependencies in one response", () => {
    const input = `${GADGET_START_PREFIX}FetchData:fetch_1
${GADGET_ARG_PREFIX}url
https://api.example.com/users
${GADGET_END_PREFIX}

${GADGET_START_PREFIX}FetchData:fetch_2
${GADGET_ARG_PREFIX}url
https://api.example.com/orders
${GADGET_END_PREFIX}

${GADGET_START_PREFIX}MergeData:merge_1:fetch_1,fetch_2
${GADGET_ARG_PREFIX}format
json
${GADGET_END_PREFIX}`;

    const events = collectSyncEvents(parser.feed(input));
    const gadgetCalls = events.filter((e) => e.type === "gadget_call");

    expect(gadgetCalls).toHaveLength(3);

    if (gadgetCalls[0]?.type === "gadget_call") {
      expect(gadgetCalls[0].call.invocationId).toBe("fetch_1");
      expect(gadgetCalls[0].call.dependencies).toEqual([]);
    }

    if (gadgetCalls[1]?.type === "gadget_call") {
      expect(gadgetCalls[1].call.invocationId).toBe("fetch_2");
      expect(gadgetCalls[1].call.dependencies).toEqual([]);
    }

    if (gadgetCalls[2]?.type === "gadget_call") {
      expect(gadgetCalls[2].call.invocationId).toBe("merge_1");
      expect(gadgetCalls[2].call.dependencies).toEqual(["fetch_1", "fetch_2"]);
    }
  });

  it("handles incomplete gadget with dependencies in finalize", () => {
    // Feed incomplete gadget
    const events = collectSyncEvents(
      parser.feed(`${GADGET_START_PREFIX}Process:proc_1:dep_1,dep_2
${GADGET_ARG_PREFIX}data
test`),
    );

    // No gadget_call yet (gadget incomplete) — progressive partials may stream.
    expect(events.filter((e) => e.type === "gadget_call")).toHaveLength(0);

    // Finalize should complete the gadget
    const finalEvents = collectSyncEvents(parser.finalize());
    const finalCalls = finalEvents.filter((e) => e.type === "gadget_call");

    expect(finalCalls).toHaveLength(1);
    if (finalCalls[0]?.type === "gadget_call") {
      expect(finalCalls[0].call.invocationId).toBe("proc_1");
      expect(finalCalls[0].call.dependencies).toEqual(["dep_1", "dep_2"]);
    }
  });

  // LLM resilience: colons used as dependency separators instead of commas
  describe("colon-separated dependencies (LLM format resilience)", () => {
    it("treats extra colon-separated parts as additional dependencies", () => {
      const input = `${GADGET_START_PREFIX}RunCommand:create_folder:create_folder:parent_folder
${GADGET_ARG_PREFIX}cmd
mkdir
${GADGET_END_PREFIX}`;

      const events = collectSyncEvents(parser.feed(input));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "RunCommand",
          invocationId: "create_folder",
          dependencies: ["create_folder", "parent_folder"],
        },
      });
    });

    it("handles 5+ colon-separated parts as dependencies", () => {
      const input = `${GADGET_START_PREFIX}Gadget:my_id:dep1:dep2:dep3:dep4
${GADGET_ARG_PREFIX}x
1
${GADGET_END_PREFIX}`;

      const events = collectSyncEvents(parser.feed(input));

      expect(events[0]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "Gadget",
          invocationId: "my_id",
          dependencies: ["dep1", "dep2", "dep3", "dep4"],
        },
      });
    });

    it("handles mix of colons and commas in deps portion", () => {
      const input = `${GADGET_START_PREFIX}Gadget:my_id:dep1,dep2:dep3
${GADGET_ARG_PREFIX}x
1
${GADGET_END_PREFIX}`;

      const events = collectSyncEvents(parser.feed(input));

      expect(events[0]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "Gadget",
          invocationId: "my_id",
          dependencies: ["dep1", "dep2", "dep3"],
        },
      });
    });

    it("deduplicates repeated dependency IDs", () => {
      const input = `${GADGET_START_PREFIX}Gadget:my_id:dep1:dep1:dep2
${GADGET_ARG_PREFIX}x
1
${GADGET_END_PREFIX}`;

      const events = collectSyncEvents(parser.feed(input));

      expect(events[0]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "Gadget",
          invocationId: "my_id",
          dependencies: ["dep1", "dep2"],
        },
      });
    });
  });

  describe("progressive arg streaming", () => {
    type PartialEvent = Extract<StreamEvent, { type: "gadget_args_partial" }>;
    const partialsOf = (events: StreamEvent[]): PartialEvent[] =>
      events.filter((e): e is PartialEvent => e.type === "gadget_args_partial");
    const callsOf = (events: StreamEvent[]) =>
      events.filter(
        (e): e is Extract<StreamEvent, { type: "gadget_call" }> => e.type === "gadget_call",
      );
    // Backticks are literal inside a double-quoted string (no escaping needed).
    const FENCE = "```toml";

    it("emits no partials when a complete gadget arrives in a single feed", () => {
      const input = `${GADGET_START_PREFIX}FillForm
${GADGET_ARG_PREFIX}title
Hello
${GADGET_END_PREFIX}`;
      const events = collectSyncEvents(parser.feed(input));

      expect(partialsOf(events)).toEqual([]);
      expect(callsOf(events)).toHaveLength(1);
    });

    it("emits a growing partial value as a field streams across feeds", () => {
      const e1 = collectSyncEvents(
        parser.feed(`${GADGET_START_PREFIX}FillForm\n${GADGET_ARG_PREFIX}title\nHel`),
      );
      const e2 = collectSyncEvents(parser.feed("lo Wor"));
      const e3 = collectSyncEvents(parser.feed("ld"));

      expect(partialsOf(e1)).toEqual([
        {
          type: "gadget_args_partial",
          invocationId: "gadget_1",
          gadgetName: "FillForm",
          fieldPath: "title",
          value: "Hel",
          delta: "Hel",
          isFieldComplete: false,
        },
      ]);
      expect(partialsOf(e2)[0]).toMatchObject({
        fieldPath: "title",
        value: "Hello Wor",
        delta: "lo Wor",
        isFieldComplete: false,
      });
      expect(partialsOf(e3)[0]).toMatchObject({
        fieldPath: "title",
        value: "Hello World",
        delta: "ld",
        isFieldComplete: false,
      });
    });

    it("marks an earlier field complete once a following !!!ARG: arrives", () => {
      collectSyncEvents(
        parser.feed(`${GADGET_START_PREFIX}FillForm\n${GADGET_ARG_PREFIX}title\nHi`),
      );
      const e2 = collectSyncEvents(parser.feed(`\n${GADGET_ARG_PREFIX}body\nLine`));
      const partials = partialsOf(e2);

      const title = partials.find((p) => p.fieldPath === "title");
      const body = partials.find((p) => p.fieldPath === "body");
      expect(title).toMatchObject({ value: "Hi", isFieldComplete: true });
      expect(body).toMatchObject({ value: "Line", isFieldComplete: false });
    });

    it("uses a stable auto invocationId across all partials and the final gadget_call", () => {
      const e1 = collectSyncEvents(
        parser.feed(`${GADGET_START_PREFIX}FillForm\n${GADGET_ARG_PREFIX}title\nHel`),
      );
      const e2 = collectSyncEvents(parser.feed("lo"));
      const e3 = collectSyncEvents(parser.feed(`\n${GADGET_END_PREFIX}`));

      const ids = new Set<string>();
      for (const p of [...partialsOf(e1), ...partialsOf(e2), ...partialsOf(e3)])
        ids.add(p.invocationId);
      for (const c of callsOf(e3)) ids.add(c.call.invocationId);
      expect([...ids]).toEqual(["gadget_1"]);
    });

    it("does not skip auto invocationId numbers across a multi-feed gadget", () => {
      collectSyncEvents(parser.feed(`${GADGET_START_PREFIX}G1\n${GADGET_ARG_PREFIX}a\nx`));
      const e2 = collectSyncEvents(
        parser.feed(
          `\n${GADGET_END_PREFIX}\n${GADGET_START_PREFIX}G2\n${GADGET_ARG_PREFIX}b\ny\n${GADGET_END_PREFIX}`,
        ),
      );
      const calls = callsOf(e2);

      expect(calls[0].call.invocationId).toBe("gadget_1");
      expect(calls[1].call.invocationId).toBe("gadget_2");
    });

    it("reuses an explicit invocationId and dependencies across partials and the call", () => {
      const e1 = collectSyncEvents(
        parser.feed(
          `${GADGET_START_PREFIX}FillForm:my_id:dep1,dep2\n${GADGET_ARG_PREFIX}title\nHe`,
        ),
      );
      const e2 = collectSyncEvents(parser.feed(`llo\n${GADGET_END_PREFIX}`));

      expect(partialsOf(e1)[0].invocationId).toBe("my_id");
      expect(callsOf(e2)[0]).toMatchObject({
        call: { invocationId: "my_id", dependencies: ["dep1", "dep2"] },
      });
    });

    it("emits no partial until the header line is complete", () => {
      const events = collectSyncEvents(parser.feed(`${GADGET_START_PREFIX}FillForm`));
      expect(events).toEqual([]);
    });

    it("does not re-emit a partial when the field has not grown", () => {
      collectSyncEvents(
        parser.feed(`${GADGET_START_PREFIX}FillForm\n${GADGET_ARG_PREFIX}title\nHi`),
      );
      const again = collectSyncEvents(parser.feed(""));
      expect(partialsOf(again)).toEqual([]);
    });

    it("tolerates an unterminated opening code fence in partial content", () => {
      const e1 = collectSyncEvents(
        parser.feed(`${GADGET_START_PREFIX}FillForm\n${FENCE}\n${GADGET_ARG_PREFIX}title\nHi`),
      );
      expect(partialsOf(e1)[0]).toMatchObject({ fieldPath: "title", value: "Hi" });
    });

    it("reports nested pointer and array index paths verbatim as fieldPath", () => {
      collectSyncEvents(
        parser.feed(`${GADGET_START_PREFIX}G\n${GADGET_ARG_PREFIX}config/timeout\n30`),
      );
      const e2 = collectSyncEvents(parser.feed(`\n${GADGET_ARG_PREFIX}items/0\nfirst`));
      const paths = partialsOf(e2).map((p) => p.fieldPath);

      expect(paths).toContain("config/timeout");
      expect(paths).toContain("items/0");
    });

    it("strips exactly one trailing newline from a streamed value", () => {
      const e1 = collectSyncEvents(
        parser.feed(`${GADGET_START_PREFIX}G\n${GADGET_ARG_PREFIX}body\nLine1\n`),
      );
      expect(partialsOf(e1).at(-1)?.value).toBe("Line1");
    });

    it("does not leak a partial !!!ARG: marker into the tail field value", () => {
      // The final 5 chars are the start of the NEXT marker ("!!!AR"); they must be held back.
      const e1 = collectSyncEvents(
        parser.feed(`${GADGET_START_PREFIX}G\n${GADGET_ARG_PREFIX}title\nHello\n!!!AR`),
      );
      expect(partialsOf(e1).at(-1)?.value).toBe("Hello");
    });

    it("finalize flushes a trailing incomplete gadget as partials then a gadget_call", () => {
      collectSyncEvents(
        parser.feed(`${GADGET_START_PREFIX}FillForm\n${GADGET_ARG_PREFIX}title\nHe`),
      );
      const fin = collectSyncEvents(parser.finalize());

      expect(partialsOf(fin).at(-1)).toMatchObject({
        fieldPath: "title",
        value: "He",
        isFieldComplete: true,
      });
      const calls = callsOf(fin);
      expect(calls).toHaveLength(1);
      expect(calls[0].call.invocationId).toBe("gadget_1");
    });

    it("reset() clears in-progress partial state", () => {
      collectSyncEvents(
        parser.feed(`${GADGET_START_PREFIX}FillForm\n${GADGET_ARG_PREFIX}title\nHe`),
      );
      parser.reset();
      const e = collectSyncEvents(
        parser.feed(`${GADGET_START_PREFIX}Other\n${GADGET_ARG_PREFIX}name\nAl`),
      );

      expect(partialsOf(e)[0]).toMatchObject({
        gadgetName: "Other",
        fieldPath: "name",
        value: "Al",
        delta: "Al",
      });
    });

    it("flushes partials for an implicitly-terminated gadget before its gadget_call", () => {
      collectSyncEvents(parser.feed(`${GADGET_START_PREFIX}G1\n${GADGET_ARG_PREFIX}a\nx`));
      const e2 = collectSyncEvents(
        parser.feed(`\n${GADGET_START_PREFIX}G2\n${GADGET_ARG_PREFIX}b\ny\n${GADGET_END_PREFIX}`),
      );

      const firstPartialIdx = e2.findIndex((ev) => ev.type === "gadget_args_partial");
      const firstCallIdx = e2.findIndex((ev) => ev.type === "gadget_call");
      expect(firstPartialIdx).toBeGreaterThanOrEqual(0);
      expect(firstPartialIdx).toBeLessThan(firstCallIdx);
      const aPartial = partialsOf(e2).find((p) => p.fieldPath === "a");
      expect(aPartial).toMatchObject({ value: "x", isFieldComplete: true });
    });

    it("reconstructs each field value from concatenated deltas when fed char by char", () => {
      const input = `${GADGET_START_PREFIX}FillForm\n${GADGET_ARG_PREFIX}title\nHello World\n${GADGET_ARG_PREFIX}body\nLorem ipsum\n${GADGET_END_PREFIX}`;
      const all: StreamEvent[] = [];
      for (const ch of input) all.push(...collectSyncEvents(parser.feed(ch)));
      all.push(...collectSyncEvents(parser.finalize()));

      const deltaFor = (field: string) =>
        partialsOf(all)
          .filter((p) => p.fieldPath === field)
          .map((p) => p.delta)
          .join("");
      expect(deltaFor("title")).toBe("Hello World");
      expect(deltaFor("body")).toBe("Lorem ipsum");

      const call = callsOf(all)[0];
      expect(call.call.parameters).toMatchObject({ title: "Hello World", body: "Lorem ipsum" });
      // Every partial shares the final call's invocationId.
      for (const p of partialsOf(all)) expect(p.invocationId).toBe(call.call.invocationId);
    });

    it("reconstructs a value whose held-back marker bytes resurface across a chunk boundary", () => {
      // `title`'s real value is "a!!!b". At the feed-2 boundary the "!!!" looks like
      // the start of a marker, so it is held back; it must resurface in a later delta
      // so concatenated deltas still reconstruct the exact value AND it never leaks
      // into a value while tentative. This is the marker-hold-back + completion path
      // the `delta` doc warns about — pinned here.
      const e1 = collectSyncEvents(
        parser.feed(`${GADGET_START_PREFIX}FillForm\n${GADGET_ARG_PREFIX}title\na`),
      );
      const e2 = collectSyncEvents(parser.feed("!!!")); // partial marker — held back
      const e3 = collectSyncEvents(parser.feed("b")); // "!!!" resurfaces in this delta
      const e4 = collectSyncEvents(parser.feed(`\n${GADGET_END_PREFIX}`)); // completes title
      const all = [...e1, ...e2, ...e3, ...e4];

      const titleValue = "a!!!b";
      const titlePartials = partialsOf(all).filter((p) => p.fieldPath === "title");

      // Concatenated deltas reconstruct the exact final value.
      expect(titlePartials.map((p) => p.delta).join("")).toBe(titleValue);

      // The authoritative gadget_call agrees, and every partial shares its invocationId.
      const call = callsOf(all)[0];
      expect(call.call.parameters).toMatchObject({ title: titleValue });
      for (const p of partialsOf(all)) expect(p.invocationId).toBe(call.call.invocationId);

      // No held-back marker bytes ever leaked: each emitted value is a prefix of the final.
      for (const p of titlePartials) expect(titleValue.startsWith(p.value)).toBe(true);
      // The field is reported complete exactly once.
      expect(titlePartials.filter((p) => p.isFieldComplete)).toHaveLength(1);
    });

    it("reconstructs multi-line field values fed one character at a time", () => {
      // Char-by-char is the maximal chunk-boundary stress: it exercises the
      // resume-with-overlap scan and the hold-back at every single byte. Values
      // carry "!!!" noise and embedded newlines (the old test used single-line text).
      const titleVal = "a!!!b";
      const bodyVal = "line1\nline2\nline3";
      const input =
        `${GADGET_START_PREFIX}FillForm\n` +
        `${GADGET_ARG_PREFIX}title\n${titleVal}\n` +
        `${GADGET_ARG_PREFIX}body\n${bodyVal}\n` +
        `${GADGET_END_PREFIX}`;

      const all: StreamEvent[] = [];
      for (const ch of input) all.push(...collectSyncEvents(parser.feed(ch)));
      all.push(...collectSyncEvents(parser.finalize()));

      const deltaFor = (field: string) =>
        partialsOf(all)
          .filter((p) => p.fieldPath === field)
          .map((p) => p.delta)
          .join("");
      expect(deltaFor("title")).toBe(titleVal);
      expect(deltaFor("body")).toBe(bodyVal);

      const call = callsOf(all)[0];
      expect(call.call.parameters).toMatchObject({ title: titleVal, body: bodyVal });
      for (const p of partialsOf(all)) expect(p.invocationId).toBe(call.call.invocationId);
    });

    it("parses a large multi-field body fed in many chunks", () => {
      // Scale check for the incremental scanner: a big trailing field streamed over
      // hundreds of chunks must still reconstruct exactly, and an earlier field must
      // complete exactly once (not be re-emitted on every chunk).
      const big = "x".repeat(20000);
      const input =
        `${GADGET_START_PREFIX}FillForm\n` +
        `${GADGET_ARG_PREFIX}title\nHello\n` +
        `${GADGET_ARG_PREFIX}body\n${big}\n` +
        `${GADGET_END_PREFIX}`;

      const CHUNK = 50;
      const all: StreamEvent[] = [];
      for (let i = 0; i < input.length; i += CHUNK) {
        all.push(...collectSyncEvents(parser.feed(input.slice(i, i + CHUNK))));
      }
      all.push(...collectSyncEvents(parser.finalize()));

      const call = callsOf(all)[0];
      expect(call.call.parameters).toMatchObject({ title: "Hello", body: big });
      expect(partialsOf(all).at(-1)?.value).toBe(big);
      expect(
        partialsOf(all).filter((p) => p.fieldPath === "title" && p.isFieldComplete),
      ).toHaveLength(1);
    });

    it("detects an end marker split across a chunk boundary", () => {
      // The resume-with-overlap scan must re-examine the previous chunk's tail; an
      // overlap that is too small would skip a marker that began in that tail.
      const split = Math.floor(GADGET_END_PREFIX.length / 2);
      collectSyncEvents(
        parser.feed(
          `${GADGET_START_PREFIX}G\n${GADGET_ARG_PREFIX}a\nval\n${GADGET_END_PREFIX.slice(0, split)}`,
        ),
      );
      const e2 = collectSyncEvents(parser.feed(GADGET_END_PREFIX.slice(split)));

      const calls = callsOf(e2);
      expect(calls).toHaveLength(1);
      expect(calls[0].call.parameters).toMatchObject({ a: "val" });
    });

    it("detects an implicit next-start marker split across a chunk boundary", () => {
      const split = Math.floor(GADGET_START_PREFIX.length / 2);
      collectSyncEvents(
        parser.feed(
          `${GADGET_START_PREFIX}G1\n${GADGET_ARG_PREFIX}a\nx\n${GADGET_START_PREFIX.slice(0, split)}`,
        ),
      );
      const e2 = collectSyncEvents(
        parser.feed(
          `${GADGET_START_PREFIX.slice(split)}G2\n${GADGET_ARG_PREFIX}b\ny\n${GADGET_END_PREFIX}`,
        ),
      );

      const calls = callsOf(e2);
      // G1 is implicitly terminated by G2's start; both parse with correct params.
      expect(calls.map((c) => c.call.gadgetName)).toEqual(["G1", "G2"]);
      expect(calls[0].call.parameters).toMatchObject({ a: "x" });
      expect(calls[1].call.parameters).toMatchObject({ b: "y" });
    });
  });
});
