import { describe, expect, it } from "bun:test";
import {
  DEFAULT_PROMPTS,
  type PromptTemplateConfig,
  type PromptContext,
  resolvePromptTemplate,
  resolveRulesTemplate,
} from "./prompt-config.js";

describe("prompt-config", () => {
  const mockContext: PromptContext = {
    startPrefix: "!!!GADGET_START:",
    endPrefix: "!!!GADGET_END",
    argPrefix: "!!!ARG:",
    gadgetCount: 3,
    gadgetNames: ["Calculator", "Weather", "Search"],
  };

  describe("resolvePromptTemplate", () => {
    it("should return static string when template is a string", () => {
      const result = resolvePromptTemplate(
        "Custom instruction",
        DEFAULT_PROMPTS.mainInstruction,
        mockContext,
      );
      expect(result).toBe("Custom instruction");
    });

    it("should call function and return result when template is a function", () => {
      const template = (ctx: PromptContext) => `You have ${ctx.gadgetCount} gadgets`;
      const result = resolvePromptTemplate(template, DEFAULT_PROMPTS.mainInstruction, mockContext);
      expect(result).toBe("You have 3 gadgets");
    });

    it("should use default when template is undefined", () => {
      const result = resolvePromptTemplate(undefined, "Default value", mockContext);
      expect(result).toBe("Default value");
    });

    it("should use default function when template is undefined and default is function", () => {
      const defaultFn = (ctx: PromptContext) => `Default: ${ctx.gadgetCount}`;
      const result = resolvePromptTemplate(undefined, defaultFn, mockContext);
      expect(result).toBe("Default: 3");
    });

    it("should pass full context to template function", () => {
      const template = (ctx: PromptContext) => {
        expect(ctx.startPrefix).toBe("!!!GADGET_START:");
        expect(ctx.endPrefix).toBe("!!!GADGET_END");
        expect(ctx.gadgetCount).toBe(3);
        expect(ctx.gadgetNames).toEqual(["Calculator", "Weather", "Search"]);
        return "verified";
      };
      const result = resolvePromptTemplate(template, "default", mockContext);
      expect(result).toBe("verified");
    });

    it("should handle complex string interpolation", () => {
      const template = (ctx: PromptContext) =>
        `Gadgets: ${ctx.gadgetNames.join(", ")}, ` +
        `Markers: ${ctx.startPrefix} to ${ctx.endPrefix}`;
      const result = resolvePromptTemplate(template, "default", mockContext);
      expect(result).toBe(
        "Gadgets: Calculator, Weather, Search, Markers: !!!GADGET_START: to !!!GADGET_END",
      );
    });
  });

  describe("resolveRulesTemplate", () => {
    it("should return array of strings when rules is a string array", () => {
      const rules = ["Rule 1", "Rule 2", "Rule 3"];
      const result = resolveRulesTemplate(rules, mockContext);
      expect(result).toEqual(["Rule 1", "Rule 2", "Rule 3"]);
    });

    it("should call function and return array when rules is a function", () => {
      const rules = (ctx: PromptContext) => [
        `You have ${ctx.gadgetCount} gadgets`,
        "Always use markers",
      ];
      const result = resolveRulesTemplate(rules, mockContext);
      expect(result).toEqual(["You have 3 gadgets", "Always use markers"]);
    });

    it("should wrap single string in array when function returns string", () => {
      const rules = () => "Single rule" as any; // Testing edge case
      const result = resolveRulesTemplate(rules, mockContext);
      expect(result).toEqual(["Single rule"]);
    });

    it("should use default rules when undefined", () => {
      const result = resolveRulesTemplate(undefined, mockContext);
      expect(result).toBeArray();
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toContain("plain text with the exact markers");
    });

    it("should pass full context to rules function", () => {
      const rules = (ctx: PromptContext) => {
        expect(ctx.gadgetCount).toBe(3);
        expect(ctx.gadgetNames).toEqual(["Calculator", "Weather", "Search"]);
        return ["verified"];
      };
      const result = resolveRulesTemplate(rules, mockContext);
      expect(result).toEqual(["verified"]);
    });

    it("should handle dynamic rule generation", () => {
      const rules = (ctx: PromptContext) =>
        ctx.gadgetNames.map((name) => `You can use the ${name} gadget`);
      const result = resolveRulesTemplate(rules, mockContext);
      expect(result).toEqual([
        "You can use the Calculator gadget",
        "You can use the Weather gadget",
        "You can use the Search gadget",
      ]);
    });
  });

  describe("DEFAULT_PROMPTS", () => {
    it("should have mainInstruction as string", () => {
      expect(typeof DEFAULT_PROMPTS.mainInstruction).toBe("string");
      expect(DEFAULT_PROMPTS.mainInstruction).toContain("RESPOND ONLY");
    });

    it("should have criticalUsage as string", () => {
      expect(typeof DEFAULT_PROMPTS.criticalUsage).toBe("string");
      expect(DEFAULT_PROMPTS.criticalUsage).toContain("INVOKE gadgets");
    });

    it("should have formatDescription as function that uses argPrefix", () => {
      expect(typeof DEFAULT_PROMPTS.formatDescription).toBe("function");
      const result = DEFAULT_PROMPTS.formatDescription(mockContext);
      expect(result).toContain("!!!ARG:");
      expect(result).toContain("name markers");

      // Test with custom argPrefix
      const customContext = { ...mockContext, argPrefix: "@param:" };
      const customResult = DEFAULT_PROMPTS.formatDescription(customContext);
      expect(customResult).toContain("@param:");
      expect(customResult).not.toContain("!!!ARG:");
    });

    it("should have rules as function", () => {
      expect(typeof DEFAULT_PROMPTS.rules).toBe("function");
      const rules = DEFAULT_PROMPTS.rules(mockContext);
      expect(rules).toBeArray();
      expect(rules.length).toBe(5);
      expect(rules[0]).toContain("plain text with the exact markers");
    });

    it("should have customExamples as null", () => {
      expect(DEFAULT_PROMPTS.customExamples).toBeNull();
    });
  });

  describe("PromptTemplateConfig integration", () => {
    it("should support partial configuration", () => {
      const config: PromptTemplateConfig = {
        mainInstruction: "Custom main",
      };

      const mainResult = resolvePromptTemplate(
        config.mainInstruction,
        DEFAULT_PROMPTS.mainInstruction,
        mockContext,
      );
      expect(mainResult).toBe("Custom main");

      // Other fields should use defaults
      const rulesResult = resolveRulesTemplate(config.rules, mockContext);
      expect(rulesResult.length).toBe(5); // Default rules count
    });

    it("should support full custom configuration", () => {
      const config: PromptTemplateConfig = {
        mainInstruction: "Custom instruction",
        criticalUsage: "Custom usage",
        formatDescription: "Block format with !!!ARG: markers",
        rules: ["Custom rule 1", "Custom rule 2"],
      };

      expect(
        resolvePromptTemplate(config.mainInstruction, DEFAULT_PROMPTS.mainInstruction, mockContext),
      ).toBe("Custom instruction");
      expect(
        resolvePromptTemplate(config.criticalUsage, DEFAULT_PROMPTS.criticalUsage, mockContext),
      ).toBe("Custom usage");
      expect(
        resolvePromptTemplate(
          config.formatDescription,
          DEFAULT_PROMPTS.formatDescription,
          mockContext,
        ),
      ).toBe("Block format with !!!ARG: markers");
      expect(resolveRulesTemplate(config.rules, mockContext)).toEqual([
        "Custom rule 1",
        "Custom rule 2",
      ]);
    });

    it("should support mixed static and dynamic configuration", () => {
      const config: PromptTemplateConfig = {
        mainInstruction: "Static instruction",
        rules: (ctx) => [`You have ${ctx.gadgetCount} available gadgets`],
      };

      const mainResult = resolvePromptTemplate(
        config.mainInstruction,
        DEFAULT_PROMPTS.mainInstruction,
        mockContext,
      );
      expect(mainResult).toBe("Static instruction");

      const rulesResult = resolveRulesTemplate(config.rules, mockContext);
      expect(rulesResult).toEqual(["You have 3 available gadgets"]);
    });
  });

  describe("Edge cases", () => {
    it("should handle empty string template", () => {
      const result = resolvePromptTemplate("", "default", mockContext);
      expect(result).toBe("");
    });

    it("should handle empty array rules", () => {
      const result = resolveRulesTemplate([], mockContext);
      expect(result).toEqual([]);
    });

    it("should handle context with zero gadgets", () => {
      const emptyContext: PromptContext = {
        ...mockContext,
        gadgetCount: 0,
        gadgetNames: [],
      };

      const template = (ctx: PromptContext) => `Gadgets: ${ctx.gadgetCount}`;
      const result = resolvePromptTemplate(template, "default", emptyContext);
      expect(result).toBe("Gadgets: 0");
    });

    it("should handle multi-line strings in rules", () => {
      const rules = ["First rule\nwith newline", "Second rule"];
      const result = resolveRulesTemplate(rules, mockContext);
      expect(result).toEqual(["First rule\nwith newline", "Second rule"]);
    });
  });
});
