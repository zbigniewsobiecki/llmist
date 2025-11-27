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

  describe("robust gadget termination", () => {
    it("parses gadget when stream ends without end marker", () => {
      const yamlParser = new StreamParser({ parameterFormat: "yaml" });
      const events = collectSyncEvents(
        yamlParser.feed(`${GADGET_START_PREFIX}Test\nkey: value\n`),
      );
      // During feed(), no events yet since we're waiting for more data
      expect(events).toEqual([]);

      // On finalize, the incomplete gadget should be parsed
      const finalEvents = collectSyncEvents(yamlParser.finalize());
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
      const yamlParser = new StreamParser({ parameterFormat: "yaml" });
      const events = collectSyncEvents(
        yamlParser.feed(
          `${GADGET_START_PREFIX}First\na: 1\n${GADGET_START_PREFIX}Second\nb: 2\n${GADGET_END_PREFIX}`,
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
      const yamlParser = new StreamParser({ parameterFormat: "yaml" });
      const events = collectSyncEvents(
        yamlParser.feed(`Some text\n${GADGET_START_PREFIX}Test\nkey: value`),
      );
      // During feed(), only the text is yielded
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: "text", content: "Some text\n" });

      // On finalize, the incomplete gadget should be parsed
      const finalEvents = collectSyncEvents(yamlParser.finalize());
      expect(finalEvents).toHaveLength(1);
      expect(finalEvents[0]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "Test",
          parameters: { key: "value" },
        },
      });
    });

    it("handles gadget with malformed end marker (e.g., just !!!) at stream end", () => {
      // This tests the case where LLM outputs !!! instead of !!!GADGET_END
      const yamlParser = new StreamParser({ parameterFormat: "yaml" });
      const events = collectSyncEvents(
        yamlParser.feed(`${GADGET_START_PREFIX}AskUser\nquestion: Which file?\n!!!\n`),
      );

      // During feed(), no events since !!! is not a valid end marker
      expect(events).toEqual([]);

      // On finalize, should parse the gadget (the !!! becomes part of params and may cause parse error)
      const finalEvents = collectSyncEvents(yamlParser.finalize());
      expect(finalEvents).toHaveLength(1);
      expect(finalEvents[0]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "AskUser",
        },
      });
    });

    it("handles three consecutive gadgets without any end markers", () => {
      const yamlParser = new StreamParser({ parameterFormat: "yaml" });
      const events = collectSyncEvents(
        yamlParser.feed(
          `${GADGET_START_PREFIX}First\na: 1\n${GADGET_START_PREFIX}Second\nb: 2\n${GADGET_START_PREFIX}Third\nc: 3\n`,
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
      const finalEvents = collectSyncEvents(yamlParser.finalize());
      expect(finalEvents).toHaveLength(1);
      expect(finalEvents[0]).toMatchObject({
        type: "gadget_call",
        call: { gadgetName: "Third", parameters: { c: 3 } },
      });
    });
  });
});

describe("TOML parameter format", () => {
  beforeEach(() => {
    resetGlobalInvocationCounter();
  });

  describe("basic TOML parsing", () => {
    it("parses simple TOML parameters", () => {
      const parser = new StreamParser({ parameterFormat: "toml" });
      const input = `${GADGET_START_PREFIX}TestGadget
from = "English"
to = "Polish"
${GADGET_END_PREFIX}`;

      const events = collectSyncEvents(parser.feed(input));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "TestGadget",
          invocationId: "gadget_1",
          parameters: {
            from: "English",
            to: "Polish",
          },
        },
      });
    });

    it("parses TOML with triple-quoted multiline strings", () => {
      const parser = new StreamParser({ parameterFormat: "toml" });
      const input = `${GADGET_START_PREFIX}WriteFile
filePath = "README.md"
content = """
# Project Title

This is markdown content with:
- List items
- Special characters: # : -
"""
${GADGET_END_PREFIX}`;

      const events = collectSyncEvents(parser.feed(input));

      expect(events).toHaveLength(1);
      const event = events[0];
      expect(event?.type).toBe("gadget_call");

      if (event?.type === "gadget_call") {
        expect(event.call.gadgetName).toBe("WriteFile");
        expect(event.call.parameters?.filePath).toBe("README.md");

        // Verify the content preserves markdown formatting
        const content = event.call.parameters?.content as string;
        expect(content).toContain("# Project Title");
        expect(content).toContain("- List items");
        expect(content).toContain("- Special characters: # : -");
      }
    });

    it("parses TOML with numbers and booleans", () => {
      const parser = new StreamParser({ parameterFormat: "toml" });
      const input = `${GADGET_START_PREFIX}Config
count = 42
ratio = 3.14
enabled = true
disabled = false
${GADGET_END_PREFIX}`;

      const events = collectSyncEvents(parser.feed(input));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "Config",
          parameters: {
            count: 42,
            ratio: 3.14,
            enabled: true,
            disabled: false,
          },
        },
      });
    });

    it("parses TOML arrays", () => {
      const parser = new StreamParser({ parameterFormat: "toml" });
      const input = `${GADGET_START_PREFIX}ArrayTest
tags = ["typescript", "toml", "parsing"]
numbers = [1, 2, 3]
${GADGET_END_PREFIX}`;

      const events = collectSyncEvents(parser.feed(input));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "ArrayTest",
          parameters: {
            tags: ["typescript", "toml", "parsing"],
            numbers: [1, 2, 3],
          },
        },
      });
    });

    it("handles invalid TOML gracefully", () => {
      const parser = new StreamParser({ parameterFormat: "toml" });
      const input = `${GADGET_START_PREFIX}BadToml
invalid toml [content
${GADGET_END_PREFIX}`;

      const events = collectSyncEvents(parser.feed(input));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "BadToml",
          parseError: expect.any(String),
          parameters: undefined,
        },
      });
    });
  });

  describe("TOML vs YAML markdown handling", () => {
    it("TOML handles markdown content that breaks YAML", () => {
      // This is the exact pattern that breaks YAML parsing
      const markdownContent = `# Typing Debt Reduction Plan

Phase 1 — Baseline hardening
- Enable targeted lint rules:
  - no-explicit-any
## Phase 2`;

      const parser = new StreamParser({ parameterFormat: "toml" });
      const input = `${GADGET_START_PREFIX}WriteFile
filePath = "PLAN.md"
content = """
${markdownContent}
"""
${GADGET_END_PREFIX}`;

      const events = collectSyncEvents(parser.feed(input));

      expect(events).toHaveLength(1);
      const event = events[0];
      expect(event?.type).toBe("gadget_call");

      if (event?.type === "gadget_call") {
        expect(event.call.gadgetName).toBe("WriteFile");
        expect(event.call.parameters?.filePath).toBe("PLAN.md");

        // Verify content was preserved correctly
        const content = event.call.parameters?.content as string;
        expect(content).toContain("# Typing Debt Reduction Plan");
        expect(content).toContain("- Enable targeted lint rules:");
        expect(content).toContain("## Phase 2");
      }
    });
  });

  describe("auto format with TOML", () => {
    it("auto mode parses TOML when JSON fails", () => {
      const parser = new StreamParser({ parameterFormat: "auto" });
      const input = `${GADGET_START_PREFIX}AutoTest
name = "test"
value = 123
${GADGET_END_PREFIX}`;

      const events = collectSyncEvents(parser.feed(input));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "AutoTest",
          parameters: {
            name: "test",
            value: 123,
          },
        },
      });
    });

    it("auto mode prefers JSON over TOML", () => {
      const parser = new StreamParser({ parameterFormat: "auto" });
      const input = `${GADGET_START_PREFIX}AutoTest
{"name": "json", "value": 456}
${GADGET_END_PREFIX}`;

      const events = collectSyncEvents(parser.feed(input));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "gadget_call",
        call: {
          gadgetName: "AutoTest",
          parameters: {
            name: "json",
            value: 456,
          },
        },
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

  describe("multiline continuation handling", () => {
    it("converts value with trailing colon followed by indented list items to pipe multiline", () => {
      const input = `question: I suggest these as priority:
  - packages/sdk/src/index.ts
  - packages/sdk/src/niuClient.ts
  - packages/sdk/src/trpc.ts`;
      const result = preprocessYaml(input);
      expect(result).toBe(`question: |
  I suggest these as priority:
  - packages/sdk/src/index.ts
  - packages/sdk/src/niuClient.ts
  - packages/sdk/src/trpc.ts`);
    });

    it("converts continuation lines with nested colons", () => {
      const input = `message: Choose an option:
  - Option A: fast processing
  - Option B: thorough analysis`;
      const result = preprocessYaml(input);
      expect(result).toBe(`message: |
  Choose an option:
  - Option A: fast processing
  - Option B: thorough analysis`);
    });

    it("handles continuation with regular text (not just list items)", () => {
      const input = `content: Start of text
  continuation line one
  continuation line two`;
      const result = preprocessYaml(input);
      expect(result).toBe(`content: |
  Start of text
  continuation line one
  continuation line two`);
    });

    it("stops continuation at less-indented line", () => {
      const input = `question: Pick one:
  - Option A
  - Option B
otherKey: value`;
      const result = preprocessYaml(input);
      expect(result).toBe(`question: |
  Pick one:
  - Option A
  - Option B
otherKey: value`);
    });

    it("handles multiple keys with continuation", () => {
      const input = `first: Some options:
  - A
  - B
second: More choices:
  - X
  - Y`;
      const result = preprocessYaml(input);
      expect(result).toBe(`first: |
  Some options:
  - A
  - B
second: |
  More choices:
  - X
  - Y`);
    });

    it("does not convert when no continuation lines follow", () => {
      const input = "question: Choose one:";
      const result = preprocessYaml(input);
      // Falls back to quoting since no continuation
      expect(result).toBe('question: "Choose one:"');
    });

    it("handles empty lines in continuation", () => {
      const input = `message: List:
  - Item 1

  - Item 2`;
      const result = preprocessYaml(input);
      expect(result).toBe(`message: |
  List:
  - Item 1

  - Item 2`);
    });

    it("normalizes varying indentation in continuation", () => {
      const input = `question: Options:
    - Deeply indented
  - Less indented`;
      const result = preprocessYaml(input);
      // Both lines should be normalized to 2-space indent
      expect(result).toBe(`question: |
  Options:
  - Deeply indented
  - Less indented`);
    });

    it("produces valid YAML that parses correctly (integration test)", async () => {
      const yaml = await import("js-yaml");

      // This is the exact pattern that caused the "bad indentation of a mapping entry" error
      const input = `question: I can read the core SDK files. Which files should I start with? I suggest these as priority:
  - packages/sdk/src/index.ts
  - packages/sdk/src/niuClient.ts
  - packages/sdk/src/trpc.ts
  You can also specify other files.`;

      const preprocessed = preprocessYaml(input);
      const parsed = yaml.load(preprocessed) as Record<string, unknown>;

      expect(parsed).toBeDefined();
      expect(parsed.question).toContain("I can read the core SDK");
      expect(parsed.question).toContain("packages/sdk/src/index.ts");
      expect(parsed.question).toContain("packages/sdk/src/niuClient.ts");
      expect(parsed.question).toContain("You can also specify other files");
    });

    it("does NOT transform valid nested YAML structures", async () => {
      const yaml = await import("js-yaml");

      // Valid YAML with nested objects - should NOT be transformed
      const input = `config:
  timeout: 30
  retries: 3
name: test`;

      const preprocessed = preprocessYaml(input);
      // Should be unchanged
      expect(preprocessed).toBe(input);

      // Should parse correctly as nested object
      const parsed = yaml.load(preprocessed) as Record<string, unknown>;
      expect(parsed.config).toEqual({ timeout: 30, retries: 3 });
      expect(parsed.name).toBe("test");
    });

    it("does NOT transform valid YAML arrays", async () => {
      const yaml = await import("js-yaml");

      // Valid YAML array - should NOT be transformed
      const input = `items:
  - first
  - second
  - third`;

      const preprocessed = preprocessYaml(input);
      // Should be unchanged
      expect(preprocessed).toBe(input);

      // Should parse correctly as array
      const parsed = yaml.load(preprocessed) as Record<string, unknown>;
      expect(parsed.items).toEqual(["first", "second", "third"]);
    });
  });

  describe("pipe block indentation normalization", () => {
    it("normalizes inconsistent indentation in pipe blocks", async () => {
      const yaml = await import("js-yaml");

      // LLM output with inconsistent indentation in pipe block
      const input = `question: |
    I found 25 files. Which file would you like me to inspect first
  opportunities?
    Options: types.ts, useAgentMutations.ts`;

      const preprocessed = preprocessYaml(input);

      // Should parse without error
      const parsed = yaml.load(preprocessed) as Record<string, unknown>;
      expect(parsed.question).toContain("I found 25 files");
      expect(parsed.question).toContain("opportunities?");
      expect(parsed.question).toContain("Options:");
    });

    it("preserves correctly formatted pipe blocks", async () => {
      const yaml = await import("js-yaml");

      const input = `content: |
  line one
  line two
  line three`;

      const preprocessed = preprocessYaml(input);

      const parsed = yaml.load(preprocessed) as Record<string, unknown>;
      expect(parsed.content).toBe("line one\nline two\nline three\n");
    });

    it("handles nested pipe blocks correctly", async () => {
      const yaml = await import("js-yaml");

      const input = `outer:
  inner: |
    nested content
    more content
  other: value`;

      const preprocessed = preprocessYaml(input);

      const parsed = yaml.load(preprocessed) as Record<string, unknown>;
      expect((parsed.outer as Record<string, unknown>).inner).toContain("nested content");
      expect((parsed.outer as Record<string, unknown>).other).toBe("value");
    });

    it("handles empty lines within pipe blocks", async () => {
      const yaml = await import("js-yaml");

      const input = `message: |
  first paragraph

  second paragraph`;

      const preprocessed = preprocessYaml(input);

      const parsed = yaml.load(preprocessed) as Record<string, unknown>;
      expect(parsed.message).toContain("first paragraph");
      expect(parsed.message).toContain("second paragraph");
    });
  });
});
