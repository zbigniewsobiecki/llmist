import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  createTemplateEngine,
  hasTemplateSyntax,
  resolveTemplate,
  TemplateError,
  validateEnvVars,
  validatePrompts,
} from "./templates.js";

describe("templates", () => {
  describe("hasTemplateSyntax", () => {
    it("detects variable syntax", () => {
      expect(hasTemplateSyntax("Hello <%= it.name %>")).toBe(true);
    });

    it("detects include syntax", () => {
      expect(hasTemplateSyntax('<%~ include("@base") %>')).toBe(true);
    });

    it("detects raw output syntax", () => {
      expect(hasTemplateSyntax("<%~ it.html %>")).toBe(true);
    });

    it("returns false for plain text", () => {
      expect(hasTemplateSyntax("Plain text without templates")).toBe(false);
    });

    it("returns false for similar-looking but invalid syntax", () => {
      expect(hasTemplateSyntax("Use < and > for comparisons")).toBe(false);
      expect(hasTemplateSyntax("Math: 5 < 10")).toBe(false);
    });
  });

  describe("createTemplateEngine", () => {
    it("creates an Eta instance", () => {
      const eta = createTemplateEngine({});
      expect(eta).toBeDefined();
      expect(typeof eta.renderString).toBe("function");
    });

    it("registers prompts as named templates with @ prefix", () => {
      const eta = createTemplateEngine({
        greeting: "Hello <%= it.name %>!",
      });
      const result = eta.render("@greeting", { name: "World" });
      expect(result).toBe("Hello World!");
    });

    it("registers multiple prompts", () => {
      const eta = createTemplateEngine({
        hello: "Hello",
        world: "World",
      });
      expect(eta.render("@hello", {})).toBe("Hello");
      expect(eta.render("@world", {})).toBe("World");
    });
  });

  describe("resolveTemplate", () => {
    it("resolves simple variable", () => {
      const eta = createTemplateEngine({});
      const result = resolveTemplate(eta, "Hello <%= it.name %>!", { name: "World" });
      expect(result).toBe("Hello World!");
    });

    it("resolves multiple variables", () => {
      const eta = createTemplateEngine({});
      const result = resolveTemplate(eta, "<%= it.greeting %> <%= it.name %>!", {
        greeting: "Hi",
        name: "Alice",
      });
      expect(result).toBe("Hi Alice!");
    });

    it("resolves include without params", () => {
      const eta = createTemplateEngine({
        base: "I am a base prompt.",
      });
      const result = resolveTemplate(eta, '<%~ include("@base") %> Extended.');
      expect(result).toBe("I am a base prompt. Extended.");
    });

    it("resolves include with params", () => {
      const eta = createTemplateEngine({
        greeting: "Hello <%= it.name %>!",
      });
      const result = resolveTemplate(eta, '<%~ include("@greeting", {name: "Alice"}) %>');
      expect(result).toBe("Hello Alice!");
    });

    it("resolves nested includes (2 levels)", () => {
      const eta = createTemplateEngine({
        base: "Base.",
        top: '<%~ include("@base") %> Top.',
      });
      const result = resolveTemplate(eta, '<%~ include("@top") %>');
      expect(result).toBe("Base. Top.");
    });

    it("resolves deeply nested includes (3 levels)", () => {
      const eta = createTemplateEngine({
        base: "Base.",
        middle: '<%~ include("@base") %> Middle.',
        top: '<%~ include("@middle") %> Top.',
      });
      const result = resolveTemplate(eta, '<%~ include("@top") %>');
      expect(result).toBe("Base. Middle. Top.");
    });

    it("passes parameters through nested includes", () => {
      const eta = createTemplateEngine({
        inner: "Role: <%= it.role %>",
        outer: '<%~ include("@inner", {role: it.role}) %> - Expert',
      });
      const result = resolveTemplate(eta, '<%~ include("@outer", {role: "Developer"}) %>');
      expect(result).toBe("Role: Developer - Expert");
    });

    it("preserves whitespace and newlines", () => {
      const eta = createTemplateEngine({
        multiline: "Line 1\nLine 2\nLine 3",
      });
      const result = resolveTemplate(eta, '<%~ include("@multiline") %>');
      expect(result).toBe("Line 1\nLine 2\nLine 3");
    });

    it("handles empty template", () => {
      const eta = createTemplateEngine({});
      const result = resolveTemplate(eta, "");
      expect(result).toBe("");
    });

    it("handles template with no syntax", () => {
      const eta = createTemplateEngine({});
      const result = resolveTemplate(eta, "Just plain text");
      expect(result).toBe("Just plain text");
    });

    describe("built-in date variable", () => {
      it("provides current date as it.date in ISO format", () => {
        const eta = createTemplateEngine({});
        const result = resolveTemplate(eta, "Date: <%= it.date %>");
        // Should match YYYY-MM-DD format
        expect(result).toMatch(/^Date: \d{4}-\d{2}-\d{2}$/);
      });

      it("provides correct current date", () => {
        const eta = createTemplateEngine({});
        const result = resolveTemplate(eta, "<%= it.date %>");
        const expectedDate = new Date().toISOString().split("T")[0];
        expect(result).toBe(expectedDate);
      });

      it("works alongside other context variables", () => {
        const eta = createTemplateEngine({});
        const result = resolveTemplate(eta, "Hello <%= it.name %> on <%= it.date %>", {
          name: "World",
        });
        expect(result).toMatch(/^Hello World on \d{4}-\d{2}-\d{2}$/);
      });
    });

    describe("environment variables", () => {
      const originalEnv = { ...process.env };

      beforeEach(() => {
        process.env.TEST_VAR = "test-value";
        process.env.ANOTHER_VAR = "another-value";
      });

      afterEach(() => {
        process.env = { ...originalEnv };
      });

      it("resolves environment variables", () => {
        const eta = createTemplateEngine({});
        const result = resolveTemplate(eta, "Value: <%= it.env.TEST_VAR %>");
        expect(result).toBe("Value: test-value");
      });

      it("resolves multiple environment variables", () => {
        const eta = createTemplateEngine({});
        const result = resolveTemplate(eta, "<%= it.env.TEST_VAR %> and <%= it.env.ANOTHER_VAR %>");
        expect(result).toBe("test-value and another-value");
      });

      it("returns undefined for missing env vars (no error during render)", () => {
        const eta = createTemplateEngine({});
        const result = resolveTemplate(eta, "Value: <%= it.env.NONEXISTENT_VAR %>");
        expect(result).toBe("Value: undefined");
      });
    });

    describe("error handling", () => {
      it("throws TemplateError on syntax error", () => {
        const eta = createTemplateEngine({});
        expect(() => resolveTemplate(eta, "<% if (true { %>")).toThrow(TemplateError);
      });

      it("throws TemplateError on missing include", () => {
        const eta = createTemplateEngine({});
        expect(() => resolveTemplate(eta, '<%~ include("@nonexistent") %>')).toThrow(TemplateError);
      });
    });
  });

  describe("validatePrompts", () => {
    it("validates correct prompts without throwing", () => {
      expect(() =>
        validatePrompts({
          simple: "Simple text",
          withVar: "With <%= it.var %>",
          multiline: "Line 1\nLine 2",
        }),
      ).not.toThrow();
    });

    it("validates prompts that include each other", () => {
      expect(() =>
        validatePrompts({
          base: "Base prompt.",
          derived: '<%~ include("@base") %> Extended.',
        }),
      ).not.toThrow();
    });

    it("throws on syntax error", () => {
      expect(() =>
        validatePrompts({
          bad: "<% if (true { %>",
        }),
      ).toThrow(TemplateError);
    });

    it("throws on missing include", () => {
      expect(() =>
        validatePrompts({
          bad: '<%~ include("@nonexistent") %>',
        }),
      ).toThrow(TemplateError);
    });

    it("includes prompt name in error", () => {
      try {
        validatePrompts({
          "my-bad-prompt": '<%~ include("@nonexistent") %>',
        });
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(TemplateError);
        expect((error as TemplateError).promptName).toBe("my-bad-prompt");
        expect((error as TemplateError).message).toContain("my-bad-prompt");
      }
    });

    it("validates empty prompts config", () => {
      expect(() => validatePrompts({})).not.toThrow();
    });
  });

  describe("validateEnvVars", () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      process.env.EXISTING_VAR = "exists";
    });

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it("passes for templates without env vars", () => {
      expect(() => validateEnvVars("Plain text")).not.toThrow();
    });

    it("passes for existing env vars", () => {
      expect(() => validateEnvVars("<%= it.env.EXISTING_VAR %>")).not.toThrow();
    });

    it("throws for missing env vars", () => {
      expect(() => validateEnvVars("<%= it.env.MISSING_VAR %>")).toThrow(TemplateError);
    });

    it("includes var name in error message", () => {
      try {
        validateEnvVars("<%= it.env.MY_MISSING_VAR %>");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(TemplateError);
        expect((error as TemplateError).message).toContain("MY_MISSING_VAR");
      }
    });

    it("validates all env vars in template", () => {
      process.env.VAR_A = "a";
      // VAR_B is not set
      expect(() => validateEnvVars("<%= it.env.VAR_A %> and <%= it.env.VAR_B %>")).toThrow(
        TemplateError,
      );
    });

    it("handles whitespace in env var syntax", () => {
      expect(() => validateEnvVars("<%=  it.env.MISSING_VAR  %>")).toThrow(TemplateError);
    });
  });

  describe("TemplateError", () => {
    it("includes prompt name in message when provided", () => {
      const error = new TemplateError("Some error", "my-prompt");
      expect(error.message).toBe("[prompts.my-prompt]: Some error");
      expect(error.promptName).toBe("my-prompt");
    });

    it("uses plain message when no prompt name", () => {
      const error = new TemplateError("Some error");
      expect(error.message).toBe("Some error");
      expect(error.promptName).toBeUndefined();
    });

    it("stores config path", () => {
      const error = new TemplateError("Error", "prompt", "/path/to/config.toml");
      expect(error.configPath).toBe("/path/to/config.toml");
    });

    it("has correct error name", () => {
      const error = new TemplateError("Error");
      expect(error.name).toBe("TemplateError");
    });
  });
});
