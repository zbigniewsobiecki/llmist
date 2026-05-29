/**
 * LoadSkill meta-gadget — bridges the skill system into the gadget execution pipeline.
 *
 * When skills are registered with an agent, this gadget is auto-created and added
 * to the gadget registry. The LLM invokes it with an array of skill names; each
 * skill's resolved instructions are composed into a single multi-section result.
 *
 * This approach requires zero changes to the stream processor or agent loop.
 *
 * @module skills/load-skill-gadget
 */

import { z } from "zod";
import { createGadget } from "../gadgets/create-gadget.js";
import type { AbstractGadget } from "../gadgets/gadget.js";
import type { SkillRegistry } from "./registry.js";

/** Name for the auto-generated LoadSkill gadget. */
export const LOAD_SKILL_GADGET_NAME = "LoadSkill";

/**
 * Compose multiple resolved-instruction bodies into a single delimited string.
 *
 * Section format:
 *
 *   ==== <skill-name> ====
 *   <body>
 *
 *   ==== <next-skill> ====
 *   <body>
 *
 * Keeps the markers literal (no markdown) so they're unambiguous when the
 * agent grep-searches its own context, and so the LLM doesn't get confused
 * by adjacent skill bodies containing markdown headers of their own.
 */
function composeSkillSections(sections: Array<{ name: string; body: string }>): string {
  return sections.map(({ name, body }) => `==== ${name} ====\n${body}`).join("\n\n");
}

/**
 * Create the LoadSkill meta-gadget from a skill registry.
 *
 * The gadget's tool description includes a summary of all available skills, so
 * the LLM knows what skills exist and when to load them. Setting
 * `iterationBarrier: true` and `stickyResult: true` are the two declarative
 * flags every LoadSkill should carry:
 *
 *   - `iterationBarrier`: tells the consuming agent loop to skip every sibling
 *     tool call in the same iteration's batch. The next LLM iteration sees
 *     only the loaded skill bodies and re-plans from there.
 *   - `stickyResult`: tells the compaction layer to preserve the result past
 *     truncation, so the agent doesn't re-load the same skill ten turns later.
 */
export function createLoadSkillGadget(registry: SkillRegistry): AbstractGadget {
  const summaries = registry.getMetadataSummaries();
  const skillNames = registry.getModelInvocable().map((s) => s.name);

  const description = [
    "Load one or more skill bodies into context. Pass `skills` as a JSON",
    "array of skill-name strings — NOT a string of a JSON-encoded array.",
    'Right: `{"skills": ["alpha"]}` or `{"skills": ["alpha", "beta"]}`.',
    'Wrong: `{"skills": "[\\"alpha\\"]"}` (the value is a string, not an array).',
    "**This gadget is an iteration barrier — no other gadgets in the same",
    "tool batch will execute, so load every skill you know you'll need in",
    "one shot.** The loaded bodies are sticky and survive context compaction.",
    "",
    "Available skills:",
    summaries,
  ].join("\n");

  // Concrete usage examples rendered alongside the schema in
  // `getInstruction()`. Reference real skill names from the registry so the
  // LLM sees a literal `{skills: ["<actual name>"]}` shape and doesn't
  // hallucinate a stringified form. Always include the single-skill case;
  // include the multi-skill case only when the registry has 2+ invocable
  // skills (so the second example doesn't repeat the first verbatim).
  const examples: Array<{
    params: { skills: string[]; arguments?: string };
    comment: string;
  }> = [];
  if (skillNames.length >= 1) {
    examples.push({
      params: { skills: [skillNames[0]] },
      comment: "Single-skill call — `skills` is still an array of length 1.",
    });
  }
  if (skillNames.length >= 2) {
    examples.push({
      params: { skills: [skillNames[0], skillNames[1]] },
      comment: "Multi-skill call — load several skills in one shot to avoid round-trips.",
    });
  }

  return createGadget({
    name: LOAD_SKILL_GADGET_NAME,
    description,
    schema: z.object({
      skills: z
        .array(z.enum(skillNames as [string, ...string[]]))
        .min(1)
        .describe(
          "One or more skill names to load in this single call. Prefer loading " +
            "everything you know you'll need at once — this gadget is an iteration " +
            "barrier, so sibling tool calls in the same batch will not execute.",
        ),
      arguments: z
        .string()
        .optional()
        .describe(
          "Optional argument string substituted into each skill's $ARGUMENTS " +
            "placeholders. Applies to every skill in the batch. To pass " +
            "different arguments to different skills, issue separate LoadSkill calls.",
        ),
    }),
    stickyResult: true,
    iterationBarrier: true,
    examples,
    execute: async ({ skills: skillNamesArg, arguments: args }) => {
      const sections: Array<{ name: string; body: string }> = [];
      for (const skillName of skillNamesArg) {
        const skill = registry.get(skillName);
        if (!skill) {
          sections.push({
            name: skillName,
            body: `Unknown skill: "${skillName}". Available skills: ${skillNames.join(", ")}`,
          });
          continue;
        }
        const activation = await skill.activate({
          arguments: args,
          cwd: process.cwd(),
        });
        sections.push({ name: skillName, body: activation.resolvedInstructions });
      }
      return composeSkillSections(sections);
    },
  });
}
