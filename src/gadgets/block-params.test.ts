import { describe, expect, it } from "bun:test";

import { parseBlockParams } from "./block-params.js";

describe("parseBlockParams", () => {
  describe("simple flat parameters", () => {
    it("parses single parameter", () => {
      const content = `!!!ARG:name
John`;
      const result = parseBlockParams(content);
      expect(result).toEqual({ name: "John" });
    });

    it("parses multiple parameters", () => {
      const content = `!!!ARG:filename
calculator.ts
!!!ARG:language
typescript`;
      const result = parseBlockParams(content);
      expect(result).toEqual({
        filename: "calculator.ts",
        language: "typescript",
      });
    });

    it("handles empty value", () => {
      const content = `!!!ARG:empty
!!!ARG:name
test`;
      const result = parseBlockParams(content);
      expect(result).toEqual({ empty: "", name: "test" });
    });

    it("handles value with only newline as empty", () => {
      const content = `!!!ARG:empty

!!!ARG:name
test`;
      const result = parseBlockParams(content);
      expect(result).toEqual({ empty: "", name: "test" });
    });
  });

  describe("multiline values", () => {
    it("preserves multiline content exactly", () => {
      const content = `!!!ARG:code
class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }
}`;
      const result = parseBlockParams(content);
      expect(result).toEqual({
        code: `class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }
}`,
      });
    });

    it("preserves special characters in code", () => {
      const content = `!!!ARG:code
const x = \`Hello \${name}\`;
const y = "quotes" + 'mixed';
const z = { nested: { obj: true } };`;
      const result = parseBlockParams(content);
      expect(result.code).toContain("`Hello ${name}`");
      expect(result.code).toContain('"quotes"');
      expect(result.code).toContain("'mixed'");
    });

    it("strips single trailing newline", () => {
      const content = `!!!ARG:text
hello
`;
      const result = parseBlockParams(content);
      expect(result).toEqual({ text: "hello" });
    });

    it("preserves internal newlines", () => {
      const content = `!!!ARG:text
line1

line3
`;
      const result = parseBlockParams(content);
      expect(result).toEqual({ text: "line1\n\nline3" });
    });
  });

  describe("JSON Pointer nested paths", () => {
    it("creates nested object for path with /", () => {
      const content = `!!!ARG:config/timeout
30`;
      const result = parseBlockParams(content);
      expect(result).toEqual({ config: { timeout: 30 } }); // Number coerced
    });

    it("creates deeply nested object", () => {
      const content = `!!!ARG:data/metadata/name
TestData
!!!ARG:data/metadata/version
1`;
      const result = parseBlockParams(content);
      expect(result).toEqual({
        data: {
          metadata: {
            name: "TestData",
            version: 1, // Number coerced
          },
        },
      });
    });

    it("handles array indices", () => {
      const content = `!!!ARG:items/0
first
!!!ARG:items/1
second`;
      const result = parseBlockParams(content);
      expect(result).toEqual({ items: ["first", "second"] });
    });

    it("handles nested arrays", () => {
      const content = `!!!ARG:data/values/0
10
!!!ARG:data/values/1
20
!!!ARG:data/values/2
30`;
      const result = parseBlockParams(content);
      expect(result).toEqual({
        data: {
          values: [10, 20, 30], // Numbers coerced
        },
      });
    });

    it("handles mixed object and array paths", () => {
      const content = `!!!ARG:users/0/name
Alice
!!!ARG:users/0/age
25
!!!ARG:users/1/name
Bob`;
      const result = parseBlockParams(content);
      expect(result).toEqual({
        users: [{ name: "Alice", age: 25 }, { name: "Bob" }], // age coerced to number
      });
    });
  });

  describe("error handling", () => {
    it("throws on duplicate pointer", () => {
      const content = `!!!ARG:name
first
!!!ARG:name
second`;
      expect(() => parseBlockParams(content)).toThrow("Duplicate pointer: name");
    });

    it("throws on array index gap", () => {
      const content = `!!!ARG:items/0
first
!!!ARG:items/2
third`;
      expect(() => parseBlockParams(content)).toThrow("Array index gap");
    });

    it("treats negative index as object key (not array)", () => {
      // Negative indices aren't valid array indices, so they create object properties
      const content = `!!!ARG:items/-1
invalid`;
      const result = parseBlockParams(content);
      // "-1" is not a valid array index, so "items" becomes an object
      expect(result).toEqual({ items: { "-1": "invalid" } });
    });
  });

  describe("custom prefix", () => {
    it("uses custom arg prefix", () => {
      const content = `***ARG:name
John
***ARG:age
30`;
      const result = parseBlockParams(content, { argPrefix: "***ARG:" });
      expect(result).toEqual({ name: "John", age: 30 }); // age coerced to number
    });
  });

  describe("edge cases", () => {
    it("handles empty content", () => {
      const result = parseBlockParams("");
      expect(result).toEqual({});
    });

    it("handles content with no args", () => {
      const result = parseBlockParams("some random text\nno args here");
      expect(result).toEqual({});
    });

    it("handles whitespace before first arg", () => {
      const content = `

!!!ARG:name
John`;
      const result = parseBlockParams(content);
      expect(result).toEqual({ name: "John" });
    });

    it("preserves trailing whitespace in values (except final newline)", () => {
      const content = `!!!ARG:text
hello   `;
      const result = parseBlockParams(content);
      expect(result).toEqual({ text: "hello   " });
    });
  });
});
