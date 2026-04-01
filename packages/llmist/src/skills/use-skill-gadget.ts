/**
 * UseSkill meta-gadget — bridges the skill system into the gadget execution pipeline.
 *
 * When skills are registered with an agent, this gadget is auto-created and added
 * to the gadget registry. The LLM can invoke it like any other gadget, and the
 * skill's instructions are returned as the gadget result.
 *
 * This approach requires zero changes to the stream processor or agent loop.
 *
 * @module skills/use-skill-gadget
 */

import { z } from "zod";
import { createGadget } from "../gadgets/create-gadget.js";
import type { AbstractGadget } from "../gadgets/gadget.js";
import type { SkillRegistry } from "./registry.js";

/** Name for the auto-generated UseSkill gadget. */
export const USE_SKILL_GADGET_NAME = "UseSkill";

/**
 * Create the UseSkill meta-gadget from a skill registry.
 *
 * The gadget description includes a summary of all available skills,
 * so the LLM knows what skills exist and when to use them.
 */
export function createUseSkillGadget(registry: SkillRegistry): AbstractGadget {
  const summaries = registry.getMetadataSummaries();
  const skillNames = registry.getModelInvocable().map((s) => s.name);

  const description = [
    "Activate a skill to get specialized instructions for a task.",
    "Available skills:",
    summaries,
  ].join("\n");

  return createGadget({
    name: USE_SKILL_GADGET_NAME,
    description,
    schema: z.object({
      skill: z.enum(skillNames as [string, ...string[]]).describe("Name of the skill to activate"),
      arguments: z
        .string()
        .optional()
        .describe("Arguments for the skill (e.g., a filename, issue number, or search query)"),
    }),
    execute: async ({ skill: skillName, arguments: args }) => {
      const skill = registry.get(skillName);
      if (!skill) {
        return `Unknown skill: "${skillName}". Available skills: ${skillNames.join(", ")}`;
      }

      const activation = await skill.activate({
        arguments: args,
        cwd: process.cwd(),
      });

      return activation.resolvedInstructions;
    },
  });
}
