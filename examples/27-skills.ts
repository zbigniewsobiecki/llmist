/**
 * Example 27: Agent Skills
 *
 * Demonstrates the Agent Skills open standard (agentskills.io) integration.
 * Skills are markdown-based instruction packages that extend agent capabilities
 * through prompt injection, not code execution.
 *
 * Run: npx tsx examples/27-skills.ts
 */

import { AgentBuilder, createUseSkillGadget, discoverSkills, Skill, SkillRegistry } from "llmist";

// ─── 1. Creating skills programmatically ─────────────────────────────────────

console.log("=== Creating Skills from Content ===\n");

const codeReviewSkill = Skill.fromContent(
  `---
name: code-review
description: Review code for bugs, performance issues, and best practices
argument-hint: "[file-or-diff]"
---

When reviewing code, follow these steps:
1. Check for bugs and logic errors
2. Evaluate performance implications
3. Verify error handling
4. Assess readability and naming
5. Check for security vulnerabilities

Format your review as:
- **Bugs**: List any bugs found
- **Performance**: Note performance concerns
- **Style**: Suggest style improvements
- **Security**: Flag security issues

Review this code: $ARGUMENTS`,
  "/examples/code-review/SKILL.md",
);

console.log(`Created skill: ${codeReviewSkill.name}`);
console.log(`Description: ${codeReviewSkill.description}`);
console.log(`User invocable: ${codeReviewSkill.isUserInvocable}`);
console.log(`Model invocable: ${codeReviewSkill.isModelInvocable}`);

// ─── 2. Skill Registry ───────────────────────────────────────────────────────

console.log("\n=== Skill Registry ===\n");

const registry = new SkillRegistry();
registry.register(codeReviewSkill);

const explainSkill = Skill.fromContent(
  `---
name: explain-code
description: Explain code with analogies and ASCII diagrams
---

When explaining code:
1. Start with a real-world analogy
2. Draw an ASCII diagram of the architecture
3. Walk through the code step by step
4. Highlight the key design decisions`,
  "/examples/explain-code/SKILL.md",
);
registry.register(explainSkill);

console.log(`Registry has ${registry.size} skills`);
console.log(`Skill names: ${registry.getNames().join(", ")}`);
console.log(`\nMetadata summaries:\n${registry.getMetadataSummaries()}`);

// ─── 3. Skill Activation ─────────────────────────────────────────────────────

console.log("\n=== Skill Activation ===\n");

const activation = await codeReviewSkill.activate({
  arguments: "function add(a, b) { return a + b; }",
});

console.log(`Activated: ${activation.skillName}`);
console.log(`Instructions preview: ${activation.resolvedInstructions.slice(0, 200)}...`);

// ─── 4. UseSkill Meta-Gadget ─────────────────────────────────────────────────

console.log("\n=== UseSkill Meta-Gadget ===\n");

const useSkillGadget = createUseSkillGadget(registry);
console.log(`Gadget name: ${useSkillGadget.name}`);
console.log(`Description includes skills: ${useSkillGadget.description.includes("code-review")}`);

// Execute the gadget (simulating what the LLM would do)
const result = await useSkillGadget.execute({
  skill: "code-review",
  arguments: "const x = eval(userInput);",
});
console.log(`\nGadget result preview: ${String(result).slice(0, 200)}...`);

// ─── 5. Agent Builder Integration ────────────────────────────────────────────

console.log("\n=== Agent Builder Integration ===\n");

// Skills can be added to the builder
const skillBuilder = new AgentBuilder()
  .withModel("sonnet")
  .withSkills(registry)
  .withSkill("code-review", "review my PR"); // Pre-activate a skill

console.log("Builder configured with skills and pre-activation");
console.log(`Builder model: ${skillBuilder ? "set" : "unset"}`);

// ─── 6. Standard Discovery ──────────────────────────────────────────────────

console.log("\n=== Standard Skill Discovery ===\n");

// Discover skills from standard locations:
// - ~/.llmist/skills/  (user-level)
// - .llmist/skills/    (project-level)
const discovered = discoverSkills({
  projectDir: process.cwd(),
});

console.log(`Discovered ${discovered.size} skills from standard locations`);

if (discovered.size > 0) {
  console.log(`Found: ${discovered.getNames().join(", ")}`);
}

console.log("\nDone! Skills provide domain expertise through prompt injection,");
console.log("not code execution. They compose naturally with gadgets and agents.");
