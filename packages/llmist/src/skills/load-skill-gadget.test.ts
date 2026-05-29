import { describe, expect, it } from "vitest";
import { createLoadSkillGadget, LOAD_SKILL_GADGET_NAME } from "./load-skill-gadget.js";
import { SkillRegistry } from "./registry.js";
import { Skill } from "./skill.js";

function makeSkill(name: string, description: string, instructions: string): Skill {
  return Skill.fromContent(
    `---\nname: ${name}\ndescription: ${description}\n---\n${instructions}`,
    `/fake/${name}/SKILL.md`,
  );
}

describe("createLoadSkillGadget", () => {
  it("creates a gadget with LoadSkill name", () => {
    const registry = SkillRegistry.from([makeSkill("test-skill", "A test skill", "Do the thing.")]);

    const gadget = createLoadSkillGadget(registry);
    expect(gadget.name).toBe(LOAD_SKILL_GADGET_NAME);
  });

  it("includes skill summaries in description", () => {
    const registry = SkillRegistry.from([
      makeSkill("gmail-read", "Read Gmail messages", "Instructions."),
      makeSkill("deploy", "Deploy to production", "Instructions."),
    ]);

    const gadget = createLoadSkillGadget(registry);
    expect(gadget.description).toContain("gmail-read");
    expect(gadget.description).toContain("deploy");
  });

  it("description leads with the array-shape hint", () => {
    // V-AE-Q (2026-05-29): the LLM emitted `LoadSkill({skill: "ucho:time"})`
    // plus a sibling shell call in the same batch, then ignored the
    // skill-load gate's "retry" sentinel and faked a success. The new
    // always-array schema + the leading-line hint nudges the LLM to load
    // every skill it knows it'll need in one shot, before any sibling
    // tool fires, since the iteration barrier deactivates everything else.
    const registry = SkillRegistry.from([makeSkill("test", "desc", "body")]);
    const gadget = createLoadSkillGadget(registry);
    expect(gadget.description).toMatch(/\barray\b/i);
    // Whitespace between the words may include a line break depending on
    // how the description was joined.
    expect(gadget.description).toMatch(/iteration\s+barrier/i);
  });

  it("marks itself as iterationBarrier so consumers can gate sibling gadgets", () => {
    // Pairs with stickyResult: every LoadSkill output is reference material
    // the agent needs for the rest of the conversation, AND issuing a
    // LoadSkill should freeze sibling gadgets in the same batch so the next
    // LLM iteration sees only the loaded skill body and re-plans from
    // there. The flag is declarative metadata; the consuming agent loop
    // wires the actual gate (see ucho's skillLoadGate / IterationBarrierGate).
    const registry = SkillRegistry.from([makeSkill("test", "desc", "body")]);
    const gadget = createLoadSkillGadget(registry);
    expect(gadget.iterationBarrier).toBe(true);
    // Keeps the previous-session stickyResult flag too — orthogonal concerns.
    expect(gadget.stickyResult).toBe(true);
  });

  it("returns skill instructions when given a single-element array", async () => {
    const registry = SkillRegistry.from([
      makeSkill("greet", "Greet the user", "Say hello warmly and ask how they are."),
    ]);

    const gadget = createLoadSkillGadget(registry);
    const result = await gadget.execute({ skills: ["greet"] });
    expect(String(result)).toContain("Say hello warmly");
  });

  it("composes multiple skills into one result in array-order under section headers", async () => {
    const registry = SkillRegistry.from([
      makeSkill("alpha", "first", "ALPHA BODY"),
      makeSkill("beta", "second", "BETA BODY"),
      makeSkill("gamma", "third", "GAMMA BODY"),
    ]);

    const gadget = createLoadSkillGadget(registry);
    const result = String(await gadget.execute({ skills: ["alpha", "gamma", "beta"] }));

    // All three bodies present
    expect(result).toContain("ALPHA BODY");
    expect(result).toContain("BETA BODY");
    expect(result).toContain("GAMMA BODY");

    // Each under its own delimited header. We require the literal "====" so
    // the markers are unambiguous in long outputs; ordering follows the
    // input array, not the registry insertion order.
    const alphaPos = result.indexOf("==== alpha ====");
    const gammaPos = result.indexOf("==== gamma ====");
    const betaPos = result.indexOf("==== beta ====");
    expect(alphaPos).toBeGreaterThanOrEqual(0);
    expect(gammaPos).toBeGreaterThanOrEqual(0);
    expect(betaPos).toBeGreaterThanOrEqual(0);
    expect(alphaPos).toBeLessThan(gammaPos);
    expect(gammaPos).toBeLessThan(betaPos);
  });

  it("substitutes arguments into EVERY skill in the batch", async () => {
    // The optional `arguments` param applies to each skill's activation. This
    // matches the user-facing semantic: 'I want skills A and B loaded, and
    // both should resolve $ARGUMENTS to <value>'. If two skills need
    // different argument values, the LLM must issue two separate LoadSkill
    // calls (rare in practice).
    const registry = SkillRegistry.from([
      makeSkill("search", "Search for files", "Search for: $ARGUMENTS"),
      makeSkill("grep", "Grep for files", "Grep for: $ARGUMENTS"),
    ]);

    const gadget = createLoadSkillGadget(registry);
    const result = String(await gadget.execute({ skills: ["search", "grep"], arguments: "*.ts" }));
    expect(result).toContain("Search for: *.ts");
    expect(result).toContain("Grep for: *.ts");
  });

  it("reports unknown skills as error lines inline without throwing or aborting siblings", async () => {
    // Partial-success is preserved so the LLM can see which skill names it
    // got wrong AND still use the bodies of the ones that loaded. No
    // exception is thrown — the gadget result is just a composed string.
    const registry = SkillRegistry.from([makeSkill("real", "A real skill", "REAL BODY")]);

    const gadget = createLoadSkillGadget(registry);
    const result = String(await gadget.execute({ skills: ["fake", "real", "also-fake"] }));
    expect(result).toContain("REAL BODY");
    expect(result.toLowerCase()).toContain('unknown skill: "fake"');
    expect(result.toLowerCase()).toContain('unknown skill: "also-fake"');
  });

  it("excludes non-model-invocable skills from the array enum", () => {
    const hidden = Skill.fromContent(
      "---\nname: hidden\ndescription: Hidden\ndisable-model-invocation: true\n---\nBody.",
      "/fake/hidden/SKILL.md",
    );
    const visible = makeSkill("visible", "Visible skill", "Body.");

    const registry = SkillRegistry.from([hidden, visible]);
    const gadget = createLoadSkillGadget(registry);

    // Description should only mention the visible skill
    expect(gadget.description).toContain("visible");
    expect(gadget.description).not.toContain("hidden");
  });

  it("full integration: parse -> register -> gadget -> activate (multi-skill)", async () => {
    const deploy = Skill.fromContent(
      `---
name: deploy
description: Deploy to production
argument-hint: "<version>"
---

Deploy version $ARGUMENTS to production.
1. Run tests
2. Build artifacts
3. Push to registry`,
      "/fake/deploy/SKILL.md",
    );
    const rollback = Skill.fromContent(
      `---
name: rollback
description: Rollback a deploy
---

Rollback to previous version $ARGUMENTS.`,
      "/fake/rollback/SKILL.md",
    );

    const registry = SkillRegistry.from([deploy, rollback]);
    expect(registry.size).toBe(2);

    const gadget = createLoadSkillGadget(registry);
    expect(gadget.name).toBe("LoadSkill");

    const result = String(
      await gadget.execute({ skills: ["deploy", "rollback"], arguments: "v2.1.0" }),
    );
    expect(result).toContain("==== deploy ====");
    expect(result).toContain("Deploy version v2.1.0 to production");
    expect(result).toContain("Run tests");
    expect(result).toContain("==== rollback ====");
    expect(result).toContain("Rollback to previous version v2.1.0");
  });
});
