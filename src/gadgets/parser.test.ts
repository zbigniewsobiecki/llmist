import { beforeEach, describe, expect, it } from "bun:test";
import { GADGET_END_PREFIX, GADGET_START_PREFIX } from "../core/constants.js";
import { collectSyncEvents } from "../testing/helpers.js";
import { resetGlobalInvocationCounter, StreamParser } from "./parser.js";
import type { StreamEvent } from "./types.js";

describe("StreamParser", () => {
  let parser: StreamParser;

  beforeEach(() => {
    resetGlobalInvocationCounter();
    parser = new StreamParser();
  });

  describe("basic parsing", () => {
    it("parses plain text without gadgets", () => {
      const events = collectSyncEvents(parser.feed("Hello, world!"));
      expect(events).toEqual([]);

      const finalEvents = collectSyncEvents(parser.finalize());
      expect(finalEvents).toEqual([{ type: "text", content: "Hello, world!" }]);
    });

    it("parses a single gadget call with new simplified format", () => {
      const input = `${GADGET_START_PREFIX}TestGadget\n{"message": "Hello", "count": 42}
${GADGET_END_PREFIX}`;

      const events = collectSyncEvents(parser.feed(input));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "TestGadget",
          invocationId: "gadget_1", // Auto-generated ID
          parameters: {
            message: "Hello",
            count: 42,
          },
        },
      });
    });

    it("parses a single gadget call with old format for backward compatibility", () => {
      const input = `${GADGET_START_PREFIX}TestGadget:123\n{"message": "Hello", "count": 42}
${GADGET_END_PREFIX}TestGadget:123`;

      const events = collectSyncEvents(parser.feed(input));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "TestGadget",
          invocationId: "123",
          parameters: {
            message: "Hello",
            count: 42,
          },
        },
      });
    });

    it("parses text before gadget with new format", () => {
      const input = `Some text before
${GADGET_START_PREFIX}TestGadget\n{"value": "test"}
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
      const input = `Some text before${GADGET_START_PREFIX}TestGadget\n{"value": "test"}\n${GADGET_END_PREFIX}`;

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

    it("parses text before gadget with old format", () => {
      const input = `Some text before
${GADGET_START_PREFIX}TestGadget:456\n{"value": "test"}
${GADGET_END_PREFIX}TestGadget:456`;

      const events = collectSyncEvents(parser.feed(input));

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({ type: "text", content: "Some text before\n" });
      expect(events[1]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "TestGadget",
          invocationId: "456",
        },
      });
    });

    it("parses text after gadget in finalize with new format", () => {
      const input = `${GADGET_START_PREFIX}TestGadget\n{"data": "value"}
${GADGET_END_PREFIX}
Text after gadget`;

      const events = collectSyncEvents(parser.feed(input));
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("gadget_call");

      const finalEvents = collectSyncEvents(parser.finalize());
      expect(finalEvents).toEqual([{ type: "text", content: "\nText after gadget" }]);
    });
  });

  describe("multiple gadgets", () => {
    it("parses multiple consecutive gadgets with new simplified format", () => {
      const input = `${GADGET_START_PREFIX}Adder\n{"a": 5, "b": 3}
${GADGET_END_PREFIX}
${GADGET_START_PREFIX}Multiplier\n{"x": 2, "y": 4}
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

    it("parses multiple consecutive gadgets with old format", () => {
      const input = `${GADGET_START_PREFIX}Adder:1\n{"a": 5, "b": 3}
${GADGET_END_PREFIX}Adder:1
${GADGET_START_PREFIX}Multiplier:2\n{"x": 2, "y": 4}
${GADGET_END_PREFIX}Multiplier:2`;

      const events = collectSyncEvents(parser.feed(input));

      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "Adder",
          invocationId: "1",
          parameters: { a: 5, b: 3 },
        },
      });
      expect(events[1]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "Multiplier",
          invocationId: "2",
          parameters: { x: 2, y: 4 },
        },
      });
    });

    it("parses gadgets with text between them", () => {
      const input = `Start
${GADGET_START_PREFIX}First:111\n{"param": "one"}
${GADGET_END_PREFIX}First:111
Middle text
${GADGET_START_PREFIX}Second:222\n{"param": "two"}
${GADGET_END_PREFIX}Second:222
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
{"index":1,"status":"done"}
${GADGET_END_PREFIX}${GADGET_START_PREFIX}SetTodoStatus
{"index":2,"status":"in_progress"}
${GADGET_END_PREFIX}${GADGET_START_PREFIX}ReadSection
{"path":"todays-news.hacker-attack"}
${GADGET_END_PREFIX}`;

      const events = collectSyncEvents(parser.feed(input));

      expect(events).toHaveLength(4);
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
      expect(events[3]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "ReadSection",
          invocationId: "gadget_3",
          parameters: { path: "todays-news.hacker-attack" },
        },
      });
    });
  });

  describe("incomplete data handling", () => {
    it("waits for complete gadget before yielding", () => {
      // Feed incomplete gadget (missing end marker)
      const events1 = collectSyncEvents(
        parser.feed(`${GADGET_START_PREFIX}TestGadget:999\n{"message": "incomplete"}`),
      );

      expect(events1).toEqual([]); // Nothing yielded yet

      // Complete the gadget
      const events2 = collectSyncEvents(
        parser.feed(`
${GADGET_END_PREFIX}TestGadget:999`),
      );

      expect(events2).toHaveLength(1);
      expect(events2[0]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "TestGadget",
          invocationId: "999",
          parameters: { message: "incomplete" },
        },
      });
    });

    it("waits for newline after gadget name with new format", () => {
      const events1 = collectSyncEvents(parser.feed(`${GADGET_START_PREFIX}TestGadget`));
      expect(events1).toEqual([]);

      const events2 = collectSyncEvents(
        parser.feed(`
{"param": "value"}
${GADGET_END_PREFIX}`),
      );
      expect(events2).toHaveLength(1);
    });

    it("handles streaming text chunk by chunk", () => {
      const chunks = [
        "Hello ",
        "world! ",
        `${GADGET_START_PREFIX}Test\n`,
        '{"data": 123}\n',
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
    it("handles invalid YAML gracefully", () => {
      const input = `${GADGET_START_PREFIX}TestGadget:invalid
bad: [yaml: {content
${GADGET_END_PREFIX}TestGadget:invalid`;

      const events = collectSyncEvents(parser.feed(input));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "TestGadget",
          invocationId: "invalid",
          parseError: expect.any(String),
          parameters: undefined,
        },
      });
    });

    it("handles invalid metadata format", () => {
      // For new format, this should work since no colon is required
      const input = `${GADGET_START_PREFIX}InvalidFormat
data: test
${GADGET_END_PREFIX}`;

      const events = collectSyncEvents(parser.feed(input));

      // Should parse successfully with new format
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "InvalidFormat",
        },
      });
    });

    it("handles empty JSON parameters", () => {
      const input = `${GADGET_START_PREFIX}EmptyGadget:empty
{}
${GADGET_END_PREFIX}EmptyGadget:empty`;

      const events = collectSyncEvents(parser.feed(input));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "EmptyGadget",
          invocationId: "empty",
          parameters: {},
        },
      });

      // Just verify it parsed without error
      if (events[0]?.type === "gadget_call") {
        expect(events[0].call.parseError).toBeUndefined();
      }
    });
  });

  describe("state management", () => {
    it("resets state correctly", () => {
      const input1 = `${GADGET_START_PREFIX}First:1\n{"data": "one"}
${GADGET_END_PREFIX}First:1`;

      const events1 = collectSyncEvents(parser.feed(input1));
      expect(events1).toHaveLength(1);

      parser.reset();

      const input2 = `${GADGET_START_PREFIX}Second:2\n{"data": "two"}
${GADGET_END_PREFIX}Second:2`;

      const events2 = collectSyncEvents(parser.feed(input2));
      expect(events2).toHaveLength(1);
      expect(events2[0]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "Second",
          invocationId: "2",
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
      const customParser = new StreamParser({
        startPrefix: "<<<START:",
        endPrefix: "<<<END:",
      });

      const input = `<<<START:CustomGadget:custom
{"param": "value"}
<<<END:CustomGadget:custom`;

      const events = collectSyncEvents(customParser.feed(input));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "CustomGadget",
          invocationId: "custom",
          parameters: { param: "value" },
        },
      });
    });

    it("does not parse default prefixes when using custom ones", () => {
      const customParser = new StreamParser({
        startPrefix: "<<<START:",
        endPrefix: "<<<END:",
      });

      const input = `${GADGET_START_PREFIX}TestGadget:123\n{"data": "test"}
${GADGET_END_PREFIX}TestGadget:123`;

      const events = collectSyncEvents(customParser.feed(input));
      expect(events).toEqual([]);

      const finalEvents = collectSyncEvents(customParser.finalize());
      expect(finalEvents[0]).toMatchObject({
        type: "text",
        content: expect.stringContaining(GADGET_START_PREFIX),
      });
    });

    it("parses gadget with custom end prefix without colon", () => {
      const customParser = new StreamParser({
        startPrefix: "<<<START:",
        endPrefix: "<<<END",
      });

      const input = `<<<START:TestGadget\n{"data": "test"}\n<<<END`;

      const events = collectSyncEvents(customParser.feed(input));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "TestGadget",
          invocationId: "gadget_1",
          parameters: {
            data: "test",
          },
        },
      });
    });

    it("parses new default format without colon in end marker", () => {
      const input = `${GADGET_START_PREFIX}TestGadget\n{"message": "Hello"}\n${GADGET_END_PREFIX}`;

      const events = collectSyncEvents(parser.feed(input));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "TestGadget",
          invocationId: "gadget_1",
          parameters: {
            message: "Hello",
          },
        },
      });
    });

    it("generates globally unique IDs across multiple parser instances", () => {
      // First parser gets gadget_1
      const parser1 = new StreamParser();
      const input = `${GADGET_START_PREFIX}TestGadget\n{"x": 1}\n${GADGET_END_PREFIX}`;
      const events1 = collectSyncEvents(parser1.feed(input));

      // Second parser gets gadget_2 (not gadget_1 again!)
      const parser2 = new StreamParser();
      const events2 = collectSyncEvents(parser2.feed(input));

      // Third parser gets gadget_3
      const parser3 = new StreamParser();
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
});

describe("preprocessYaml", () => {
  // Import directly for unit testing
  let preprocessYaml: (yaml: string) => string;

  beforeEach(async () => {
    const module = await import("./parser.js");
    preprocessYaml = module.preprocessYaml;
  });

  describe("colon handling", () => {
    it("quotes values containing colon followed by space", () => {
      const input = "question: What is this: a test?";
      const result = preprocessYaml(input);
      expect(result).toBe('question: "What is this: a test?"');
    });

    it("quotes values with trailing colon", () => {
      const input = "question: Choose one:";
      const result = preprocessYaml(input);
      expect(result).toBe('question: "Choose one:"');
    });

    it("handles multiple colons in value", () => {
      const input = "message: Error: Connection failed: timeout";
      const result = preprocessYaml(input);
      expect(result).toBe('message: "Error: Connection failed: timeout"');
    });

    it("does not quote simple values without colons", () => {
      const input = "name: John Smith";
      const result = preprocessYaml(input);
      expect(result).toBe("name: John Smith");
    });

    it("does not quote URLs (no space after protocol colon)", () => {
      const input = "url: https://example.com";
      const result = preprocessYaml(input);
      expect(result).toBe("url: https://example.com");
    });
  });

  describe("preserves special values", () => {
    it("preserves already double-quoted values", () => {
      const input = 'message: "Already: quoted"';
      const result = preprocessYaml(input);
      expect(result).toBe('message: "Already: quoted"');
    });

    it("preserves already single-quoted values", () => {
      const input = "message: 'Already: quoted'";
      const result = preprocessYaml(input);
      expect(result).toBe("message: 'Already: quoted'");
    });

    it("preserves pipe block indicator", () => {
      const input = "content: |";
      const result = preprocessYaml(input);
      expect(result).toBe("content: |");
    });

    it("preserves folded block indicator", () => {
      const input = "content: >";
      const result = preprocessYaml(input);
      expect(result).toBe("content: >");
    });

    it("preserves boolean true", () => {
      const input = "enabled: true";
      const result = preprocessYaml(input);
      expect(result).toBe("enabled: true");
    });

    it("preserves boolean false", () => {
      const input = "enabled: false";
      const result = preprocessYaml(input);
      expect(result).toBe("enabled: false");
    });

    it("preserves integers", () => {
      const input = "count: 42";
      const result = preprocessYaml(input);
      expect(result).toBe("count: 42");
    });

    it("preserves negative numbers", () => {
      const input = "offset: -10";
      const result = preprocessYaml(input);
      expect(result).toBe("offset: -10");
    });

    it("preserves floats", () => {
      const input = "ratio: 3.14";
      const result = preprocessYaml(input);
      expect(result).toBe("ratio: 3.14");
    });
  });

  describe("key variations", () => {
    it("handles keys with hyphens", () => {
      const input = "my-key: value with: colon";
      const result = preprocessYaml(input);
      expect(result).toBe('my-key: "value with: colon"');
    });

    it("handles keys with underscores", () => {
      const input = "my_key: value with: colon";
      const result = preprocessYaml(input);
      expect(result).toBe('my_key: "value with: colon"');
    });

    it("handles indented keys", () => {
      const input = "  nested: value with: colon";
      const result = preprocessYaml(input);
      expect(result).toBe('  nested: "value with: colon"');
    });
  });

  describe("multiline YAML", () => {
    it("processes each line independently", () => {
      const input = `name: John
question: What is this: a test?
count: 42`;
      const result = preprocessYaml(input);
      expect(result).toBe(`name: John
question: "What is this: a test?"
count: 42`);
    });

    it("preserves lines that are not key-value pairs", () => {
      const input = `content: |
  This is a multiline
  block of text`;
      const result = preprocessYaml(input);
      expect(result).toBe(`content: |
  This is a multiline
  block of text`);
    });
  });

  describe("escaping", () => {
    it("escapes double quotes in values", () => {
      const input = 'question: Say "hello": world';
      const result = preprocessYaml(input);
      expect(result).toBe('question: "Say \\"hello\\": world"');
    });

    it("escapes backslashes in values", () => {
      const input = "path: C:\\Users: test";
      const result = preprocessYaml(input);
      expect(result).toBe('path: "C:\\\\Users: test"');
    });
  });
});
