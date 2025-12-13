import { beforeEach, describe, expect, it } from "bun:test";
import { GADGET_ARG_PREFIX, GADGET_END_PREFIX, GADGET_START_PREFIX } from "../core/constants.js";
import { collectSyncEvents } from "../testing/helpers.js";
import { resetGlobalInvocationCounter, GadgetCallParser } from "./parser.js";
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

      expect(events1).toEqual([]); // Nothing yielded yet

      // Complete the gadget
      const events2 = collectSyncEvents(parser.feed(`\n${GADGET_END_PREFIX}`));

      expect(events2).toHaveLength(1);
      expect(events2[0]).toMatchObject({
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
      // During feed(), no events yet since we're waiting for more data
      expect(events).toEqual([]);

      // On finalize, the incomplete gadget should be parsed
      const finalEvents = collectSyncEvents(parser.finalize());
      expect(finalEvents).toHaveLength(1);
      expect(finalEvents[0]).toMatchObject({
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
      // During feed(), only the text is yielded
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: "text", content: "Some text\n" });

      // On finalize, the incomplete gadget should be parsed
      const finalEvents = collectSyncEvents(parser.finalize());
      expect(finalEvents).toHaveLength(1);
      expect(finalEvents[0]).toMatchObject({
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

      // First two should be parsed (each ends when next starts)
      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        type: "gadget_call",
        call: { gadgetName: "First", parameters: { a: 1 } },
      });
      expect(events[1]).toMatchObject({
        type: "gadget_call",
        call: { gadgetName: "Second", parameters: { b: 2 } },
      });

      // Third gadget parsed on finalize
      const finalEvents = collectSyncEvents(parser.finalize());
      expect(finalEvents).toHaveLength(1);
      expect(finalEvents[0]).toMatchObject({
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

    // No events yet (gadget incomplete)
    expect(events).toHaveLength(0);

    // Finalize should complete the gadget
    const finalEvents = collectSyncEvents(parser.finalize());

    expect(finalEvents).toHaveLength(1);
    if (finalEvents[0]?.type === "gadget_call") {
      expect(finalEvents[0].call.invocationId).toBe("proc_1");
      expect(finalEvents[0].call.dependencies).toEqual(["dep_1", "dep_2"]);
    }
  });
});
