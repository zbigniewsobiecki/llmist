---
title: Skills (Agent Skills)
description: Extend agent capabilities with markdown-based instruction packages
---

Skills are markdown-based instruction packages that follow the [Agent Skills open standard](https://agentskills.io). Unlike gadgets (which are executable code), skills extend agent capabilities through **prompt injection and context management**. They are interoperable with Claude Code, Codex CLI, Gemini CLI, and 30+ other tools.

## Quick Start

```typescript
import { AgentBuilder, Skill, SkillRegistry, discoverSkills } from 'llmist';

// Create a skill from content
const reviewSkill = Skill.fromContent(`---
name: code-review
description: Review code for bugs and best practices
---

When reviewing code, check for:
1. Logic errors and edge cases
2. Security vulnerabilities
3. Performance issues
4. Readability and naming`, '/skills/code-review/SKILL.md');

// Register and use with an agent
const registry = SkillRegistry.from([reviewSkill]);

const agent = new AgentBuilder()
  .withModel('sonnet')
  .withSkills(registry)
  .ask('Review this function: function add(a, b) { return a + b; }');

for await (const event of agent.run()) {
  if (event.type === 'text') process.stdout.write(event.content);
}
```

## SKILL.md Format

Each skill is a directory containing a `SKILL.md` file with YAML frontmatter and a markdown body:

```
my-skill/
  SKILL.md           # Required: metadata + instructions
  scripts/           # Optional: executable helpers
  references/        # Optional: documentation loaded on demand
  assets/            # Optional: templates, resources
```

### Frontmatter Fields

```yaml
---
name: my-skill                    # Required. Lowercase, hyphens, max 64 chars.
description: What it does         # Required. Max 1024 chars. Used for auto-triggering.
argument-hint: "[filename]"       # Shown during autocomplete
allowed-tools:                    # Restrict which gadgets the agent can use
  - Bash
  - ReadFile
model: sonnet                     # Override model when skill is active
context: fork                     # "fork" runs in isolated subagent
agent: Explore                    # Subagent type for fork mode
paths:                            # Auto-activate on file pattern match
  - "src/**/*.ts"
disable-model-invocation: false   # true = only user can invoke
user-invocable: true              # false = background knowledge only
shell: bash                       # Shell for !`command` preprocessing
version: 1.0.0                    # Semantic version
---
```

### Dynamic Substitution

Skill instructions support dynamic content:

```markdown
---
name: search
description: Search for files
argument-hint: "<pattern>"
---

Search for: $ARGUMENTS
Look in directory: ${SKILL_DIR}
First arg: $0, second arg: $1

Current branch: !`git branch --show-current`
```

- `$ARGUMENTS` - Full argument string
- `$0`, `$1`, `$ARGUMENTS[N]` - Positional arguments
- `${SKILL_DIR}`, `${CLAUDE_SKILL_DIR}` - Skill directory path
- `` !`command` `` - Shell command (executed before LLM sees instructions)

## Three-Tier Progressive Disclosure

Skills manage context window budget through lazy loading:

| Tier | Content | When Loaded | Budget |
|------|---------|-------------|--------|
| 1 | Name + description | Always (all skills) | ~100 tokens each |
| 2 | Full SKILL.md body | On activation | <5K tokens |
| 3 | Scripts, references, assets | On demand | Unlimited |

```typescript
const skill = registry.get('my-skill');

// Tier 1: always available
console.log(skill.name, skill.description);

// Tier 2: lazy loaded from disk
const instructions = await skill.getInstructions();

// Tier 3: loaded individually
const resources = skill.getResources();
const doc = await skill.getResource('references/api.md');
```

## Skill Registry

```typescript
import { SkillRegistry, Skill } from 'llmist';

const registry = new SkillRegistry();
registry.register(skill);
registry.registerMany([skill1, skill2]);

// Lookup
const s = registry.get('my-skill'); // Case-insensitive
registry.has('my-skill');           // Boolean check
registry.getAll();                  // All skills
registry.getNames();                // All names

// Filtering
registry.getModelInvocable();       // Skills the LLM can auto-trigger
registry.getUserInvocable();        // Skills the user can invoke via /name
registry.findByFilePath('src/App.tsx'); // Match by path patterns

// Metadata summaries for system prompt
const summaries = registry.getMetadataSummaries(8000); // char budget

// Compose registries
registry.merge(otherRegistry);
```

## Skill Discovery

Skills are discovered from standard locations:

```typescript
import { discoverSkills, loadSkillsFromDirectory } from 'llmist';

// Standard locations (user + project)
const registry = discoverSkills({
  projectDir: process.cwd(),  // Scans .llmist/skills/
  // Also scans ~/.llmist/skills/ automatically
  additionalDirs: ['./extra-skills'],
});

// Or load from a specific directory
const skills = loadSkillsFromDirectory('/path/to/skills', {
  type: 'directory',
  path: '/path/to/skills',
});
```

Discovery order (later overrides earlier on name collision):
1. `~/.llmist/skills/` - User-level
2. `.llmist/skills/` - Project-level
3. Additional directories - Explicit

## Agent Builder Integration

```typescript
const builder = new AgentBuilder()
  .withModel('sonnet')
  .withSkills(registry)           // Register all skills from a SkillRegistry
  .withSkill('code-review', 'PR #42')  // Pre-activate a specific skill
  .withSkillsFrom('./my-skills')  // Load all skills from a directory
  .ask('Help me with this task');
```

When skills are registered, a `LoadSkill` meta-gadget is automatically added. The LLM can invoke it like any gadget to activate a skill mid-conversation.

### withSkillsFrom()

The `.withSkillsFrom(dir)` method is a convenience shortcut that scans a directory for skills and registers them with the agent — no need to create a `SkillRegistry` manually.

```typescript
const agent = new AgentBuilder()
  .withModel('sonnet')
  .withSkillsFrom('./skills')          // Load from relative path
  .withSkillsFrom('/usr/local/skills') // Chain multiple directories
  .ask('Help me review this code');
```

Skills are discovered by scanning the directory for subdirectories that contain a `SKILL.md` file. Each call to `.withSkillsFrom()` adds more directories — calls accumulate rather than replace.

```typescript
// Equivalent manual approach
import { loadSkillsFromDirectory, SkillRegistry } from 'llmist';

const registry = new SkillRegistry();
registry.registerMany(loadSkillsFromDirectory('./skills'));

const agent = new AgentBuilder()
  .withModel('sonnet')
  .withSkills(registry)
  .ask('Help me review this code');
```

## How It Works

```
┌─────────────────────────────────────────────────┐
│                 Skill Layer                      │
│  skill.activate() → injects instructions         │
│                   → registers bundled gadgets     │
└──────────────┬──────────────────────────────────┘
               │ composes with
┌──────────────▼──────────────────────────────────┐
│                Gadget Layer                       │
│  gadget.execute() → runs code, returns result    │
└─────────────────────────────────────────────────┘
```

1. Skill metadata (Tier 1) is included in the LoadSkill gadget description
2. LLM decides to invoke LoadSkill based on the task
3. Skill instructions (Tier 2) are loaded and returned as the gadget result
4. LLM follows the instructions in the next iteration

## Hooks

Skills integrate with the [hooks system](/library/guides/hooks/):

```typescript
const agent = new AgentBuilder()
  .withSkills(registry)
  .withHooks({
    observers: {
      onSkillActivated: (ctx) => {
        console.log(`Skill ${ctx.skillName} activated`);
      },
    },
    controllers: {
      beforeSkillActivation: async (ctx) => {
        if (ctx.skillName === 'dangerous-skill') {
          return { action: 'skip', reason: 'Not allowed' };
        }
        return { action: 'proceed' };
      },
    },
    interceptors: {
      interceptSkillInstructions: (instructions, ctx) => {
        return instructions + '\n\nAlways be concise.';
      },
    },
  })
  .ask('Do the thing');
```

## Testing Skills

```typescript
import { mockSkill, MockSkillBuilder, testSkillActivation } from '@llmist/testing';

// Quick mock
const skill = mockSkill({ name: 'test' }, 'Test instructions with $ARGUMENTS.');

// Fluent builder
const skill = new MockSkillBuilder()
  .withName('deploy')
  .withDescription('Deploy to production')
  .withInstructions('Deploy $ARGUMENTS now.')
  .withModel('flash')
  .build();

// Test activation
const activation = await testSkillActivation(skill, { arguments: 'v2.0' });
expect(activation.resolvedInstructions).toContain('Deploy v2.0 now.');
```

## CLI Usage

```bash
# List available skills
llmist skill list

# Show skill details
llmist skill info gmail-read

# Invoke a skill in the REPL
# Type /skill-name [args] at the prompt
/code-review src/app.ts
```

Configure skills in `~/.llmist/cli.toml`:

```toml
[skills]
sources = [
  "~/custom-skills",
  "./project-skills",
]

[skills.overrides.my-skill]
model = "flash"
enabled = true
```

## Ecosystem Compatibility

Skills using the standard SKILL.md format work across:
- **Claude Code** (`.claude/skills/`)
- **Codex CLI** (`.agents/skills/`)
- **Gemini CLI** (extensions)
- **Cursor, VS Code Copilot, JetBrains Junie**, and 30+ other tools

llmist uses `.llmist/skills/` for its standard location but can load skills from any directory.
