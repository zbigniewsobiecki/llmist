import { describe, expect, it } from "bun:test";
import { XmlParseError, formatParamsAsXml, parseXmlParams } from "./xml-params.js";

describe("xml-params", () => {
  describe("parseXmlParams", () => {
    describe("basic types", () => {
      it("parses string values", () => {
        const result = parseXmlParams("<name>John Doe</name>");
        expect(result).toEqual({ name: "John Doe" });
      });

      it("parses integer values", () => {
        const result = parseXmlParams("<count>42</count>");
        expect(result).toEqual({ count: 42 });
      });

      it("parses negative integers", () => {
        const result = parseXmlParams("<offset>-10</offset>");
        expect(result).toEqual({ offset: -10 });
      });

      it("parses float values", () => {
        const result = parseXmlParams("<price>19.99</price>");
        expect(result).toEqual({ price: 19.99 });
      });

      it("parses boolean true", () => {
        const result = parseXmlParams("<enabled>true</enabled>");
        expect(result).toEqual({ enabled: true });
      });

      it("parses boolean false", () => {
        const result = parseXmlParams("<enabled>false</enabled>");
        expect(result).toEqual({ enabled: false });
      });

      it("parses self-closing tags as null", () => {
        const result = parseXmlParams("<optional/>");
        expect(result).toEqual({ optional: null });
      });

      it("parses self-closing tags with space as null", () => {
        const result = parseXmlParams("<optional />");
        expect(result).toEqual({ optional: null });
      });

      it("parses empty tags as null", () => {
        const result = parseXmlParams("<empty></empty>");
        expect(result).toEqual({ empty: null });
      });
    });

    describe("multiple parameters", () => {
      it("parses multiple tags", () => {
        const result = parseXmlParams(`
          <operation>multiply</operation>
          <a>17</a>
          <b>23</b>
        `);
        expect(result).toEqual({
          operation: "multiply",
          a: 17,
          b: 23,
        });
      });

      it("handles mixed types", () => {
        const result = parseXmlParams(`
          <name>test</name>
          <count>5</count>
          <active>true</active>
          <extra/>
        `);
        expect(result).toEqual({
          name: "test",
          count: 5,
          active: true,
          extra: null,
        });
      });
    });

    describe("nested objects", () => {
      it("parses simple nested object", () => {
        const result = parseXmlParams(`
          <config>
            <timeout>30</timeout>
            <retries>3</retries>
          </config>
        `);
        expect(result).toEqual({
          config: {
            timeout: 30,
            retries: 3,
          },
        });
      });

      it("parses deeply nested objects", () => {
        const result = parseXmlParams(`
          <data>
            <metadata>
              <name>TestData</name>
              <version>1</version>
            </metadata>
          </data>
        `);
        expect(result).toEqual({
          data: {
            metadata: {
              name: "TestData",
              version: 1,
            },
          },
        });
      });

      it("parses mixed nested and flat", () => {
        const result = parseXmlParams(`
          <operation>sum</operation>
          <data>
            <metadata>
              <name>TestData</name>
            </metadata>
          </data>
        `);
        expect(result).toEqual({
          operation: "sum",
          data: {
            metadata: {
              name: "TestData",
            },
          },
        });
      });
    });

    describe("arrays", () => {
      it("parses array with repeated tags", () => {
        const result = parseXmlParams(`
          <values>
            <value>10</value>
            <value>20</value>
            <value>30</value>
          </values>
        `);
        expect(result).toEqual({
          values: [10, 20, 30],
        });
      });

      it("parses array of strings", () => {
        const result = parseXmlParams(`
          <tags>
            <tag>urgent</tag>
            <tag>test</tag>
          </tags>
        `);
        expect(result).toEqual({
          tags: ["urgent", "test"],
        });
      });

      it("parses array at top level with same tag names", () => {
        const result = parseXmlParams(`
          <item>first</item>
          <item>second</item>
          <item>third</item>
        `);
        expect(result).toEqual({
          item: ["first", "second", "third"],
        });
      });

      it("parses complex nested structure with array", () => {
        const result = parseXmlParams(`
          <data>
            <values>
              <value>10</value>
              <value>20</value>
              <value>30</value>
              <value>40</value>
            </values>
            <metadata>
              <name>TestData</name>
              <version>1</version>
            </metadata>
          </data>
          <operation>sum</operation>
        `);
        expect(result).toEqual({
          data: {
            values: [10, 20, 30, 40],
            metadata: {
              name: "TestData",
              version: 1,
            },
          },
          operation: "sum",
        });
      });
    });

    describe("CDATA", () => {
      it("parses CDATA content", () => {
        const result = parseXmlParams(`
          <code><![CDATA[function hello() {
  console.log("Hello!");
}]]></code>
        `);
        expect(result).toEqual({
          code: 'function hello() {\n  console.log("Hello!");\n}',
        });
      });

      it("preserves special characters in CDATA", () => {
        const result = parseXmlParams(`
          <text><![CDATA[<script>alert("XSS")</script>]]></text>
        `);
        expect(result).toEqual({
          text: '<script>alert("XSS")</script>',
        });
      });

      it("handles CDATA with XML-like content", () => {
        const result = parseXmlParams(`
          <template><![CDATA[<div class="test">Content</div>]]></template>
        `);
        expect(result).toEqual({
          template: '<div class="test">Content</div>',
        });
      });
    });

    describe("whitespace handling", () => {
      it("trims whitespace from values", () => {
        const result = parseXmlParams("<name>  John  </name>");
        expect(result).toEqual({ name: "John" });
      });

      it("handles newlines in values", () => {
        const result = parseXmlParams(`<text>
          line1
          line2
        </text>`);
        expect(result).toEqual({ text: "line1\n          line2" });
      });

      it("ignores whitespace between tags", () => {
        const result = parseXmlParams(`

          <a>1</a>

          <b>2</b>

        `);
        expect(result).toEqual({ a: 1, b: 2 });
      });
    });

    describe("lenient parsing", () => {
      it("handles tags with attributes (ignores them)", () => {
        const result = parseXmlParams('<name type="string">John</name>');
        expect(result).toEqual({ name: "John" });
      });

      it("handles self-closing with attributes", () => {
        const result = parseXmlParams('<optional default="none"/>');
        expect(result).toEqual({ optional: null });
      });

      it("handles tags with hyphens", () => {
        const result = parseXmlParams("<first-name>John</first-name>");
        expect(result).toEqual({ "first-name": "John" });
      });

      it("handles tags with underscores", () => {
        const result = parseXmlParams("<first_name>John</first_name>");
        expect(result).toEqual({ first_name: "John" });
      });

      it("handles comments", () => {
        const result = parseXmlParams(`
          <!-- This is a comment -->
          <name>John</name>
          <!-- Another comment -->
        `);
        expect(result).toEqual({ name: "John" });
      });
    });

    describe("edge cases", () => {
      it("throws on empty input", () => {
        expect(() => parseXmlParams("")).toThrow(XmlParseError);
        expect(() => parseXmlParams("   ")).toThrow(XmlParseError);
      });

      it("throws on non-XML input", () => {
        // TOML-like content
        expect(() => parseXmlParams('name = "test"')).toThrow(XmlParseError);
        // YAML-like content
        expect(() => parseXmlParams("name: test")).toThrow(XmlParseError);
        // JSON-like content
        expect(() => parseXmlParams('{"name": "test"}')).toThrow(XmlParseError);
      });

      it("handles single character values", () => {
        const result = parseXmlParams("<char>x</char>");
        expect(result).toEqual({ char: "x" });
      });

      it("handles numeric-like strings that aren't numbers", () => {
        const result = parseXmlParams("<code>007</code>");
        expect(result).toEqual({ code: 7 }); // Leading zeros make it a number
      });

      it("handles string that looks like boolean but isn't", () => {
        const result = parseXmlParams("<value>TRUE</value>");
        expect(result).toEqual({ value: "TRUE" }); // Case sensitive
      });
    });

    describe("error handling", () => {
      it("handles unclosed tag leniently (LLMs may forget closing tags)", () => {
        // We're lenient with unclosed tags since LLMs sometimes forget them
        const result = parseXmlParams("<name>John");
        expect(result).toEqual({ name: "John" });
      });

      it("throws on tag without name", () => {
        expect(() => parseXmlParams("<>value</>")).toThrow(XmlParseError);
      });
    });
  });

  describe("formatParamsAsXml", () => {
    it("formats simple string", () => {
      const result = formatParamsAsXml({ name: "John" });
      expect(result).toBe("<name>John</name>");
    });

    it("formats number", () => {
      const result = formatParamsAsXml({ count: 42 });
      expect(result).toBe("<count>42</count>");
    });

    it("formats boolean", () => {
      const result = formatParamsAsXml({ enabled: true });
      expect(result).toBe("<enabled>true</enabled>");
    });

    it("formats null as self-closing", () => {
      const result = formatParamsAsXml({ optional: null });
      expect(result).toBe("<optional/>");
    });

    it("formats multiple parameters", () => {
      const result = formatParamsAsXml({
        operation: "multiply",
        a: 17,
        b: 23,
      });
      expect(result).toContain("<operation>multiply</operation>");
      expect(result).toContain("<a>17</a>");
      expect(result).toContain("<b>23</b>");
    });

    it("formats nested object", () => {
      const result = formatParamsAsXml({
        config: {
          timeout: 30,
          retries: 3,
        },
      });
      expect(result).toContain("<config>");
      expect(result).toContain("<timeout>30</timeout>");
      expect(result).toContain("<retries>3</retries>");
      expect(result).toContain("</config>");
    });

    it("formats array with singular child tags", () => {
      const result = formatParamsAsXml({
        items: ["a", "b", "c"],
      });
      expect(result).toContain("<items>");
      expect(result).toContain("<item>a</item>");
      expect(result).toContain("<item>b</item>");
      expect(result).toContain("<item>c</item>");
      expect(result).toContain("</items>");
    });

    it("formats multiline string with CDATA", () => {
      const result = formatParamsAsXml({
        code: 'function test() {\n  return "hello";\n}',
      });
      expect(result).toContain("<![CDATA[");
      expect(result).toContain("]]>");
    });

    it("formats string with special characters using CDATA", () => {
      const result = formatParamsAsXml({
        html: "<div>test</div>",
      });
      expect(result).toContain("<![CDATA[");
    });

    describe("roundtrip", () => {
      it("roundtrips simple object", () => {
        const original = { name: "John", age: 30, active: true };
        const xml = formatParamsAsXml(original);
        const parsed = parseXmlParams(xml);
        expect(parsed).toEqual(original);
      });

      it("roundtrips nested object", () => {
        const original = {
          config: {
            timeout: 30,
            enabled: false,
          },
        };
        const xml = formatParamsAsXml(original);
        const parsed = parseXmlParams(xml);
        expect(parsed).toEqual(original);
      });

      it("roundtrips array", () => {
        const original = {
          values: [1, 2, 3],
        };
        const xml = formatParamsAsXml(original);
        const parsed = parseXmlParams(xml);
        expect(parsed).toEqual(original);
      });
    });
  });
});
