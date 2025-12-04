/**
 * Trailing Messages Examples
 *
 * This file demonstrates the withTrailingMessage() feature that allows you to
 * inject ephemeral messages at the end of each LLM request. These messages are
 * NOT persisted to conversation history.
 *
 * Use cases:
 * - Reminders: Instructions that need to be reinforced every turn
 * - Status injection: Current state that changes independently
 * - Format enforcement: "Always respond in JSON format"
 *
 * Run: bun examples/15-trailing-messages.ts
 */

import { LLMist, HookPresets, Gadget, z } from '../src/index.js';

// Example gadgets for demonstration
class SearchFiles extends Gadget({
  description: 'Search for files matching a pattern',
  schema: z.object({
    pattern: z.string().describe('Search pattern'),
  }),
}) {
  execute(params: this['params']): string {
    return `Found 3 files matching "${params.pattern}": file1.ts, file2.ts, file3.ts`;
  }
}

class ProcessTask extends Gadget({
  description: 'Process a task and return status',
  schema: z.object({
    taskId: z.string().describe('Task ID to process'),
  }),
}) {
  execute(params: this['params']): string {
    return `Task ${params.taskId} processed successfully`;
  }
}

// ============================================================================
// Example 1: Static Trailing Message
// ============================================================================

async function example1_StaticTrailingMessage() {
  console.log('\n=== Example 1: Static Trailing Message ===\n');
  console.log('A constant reminder appended to every LLM request\n');

  // Track what messages are sent
  let messageCount = 0;

  await LLMist.createAgent()
    .withModel('haiku')
    .withMaxIterations(3)
    .withGadgets(SearchFiles)
    .withTrailingMessage('IMPORTANT: Be concise. Use only one gadget call per response.')
    .withHooks({
      controllers: {
        beforeLLMCall: async (ctx) => {
          messageCount++;
          const lastMessage = ctx.options.messages[ctx.options.messages.length - 1];
          if (lastMessage.role === 'user' && lastMessage.content.includes('IMPORTANT:')) {
            console.log(`   💡 [Request ${messageCount}] Trailing message injected`);
            console.log(`      "${lastMessage.content.slice(0, 60)}..."`);
          }
          return { action: 'proceed' };
        },
      },
    })
    .askAndCollect('Find all TypeScript files');

  console.log(`\n   Total requests with trailing message: ${messageCount}`);
}

// ============================================================================
// Example 2: Dynamic Trailing Message Based on Iteration
// ============================================================================

async function example2_DynamicIterationMessage() {
  console.log('\n=== Example 2: Dynamic Message Based on Iteration ===\n');
  console.log('Message changes based on how far through the iterations\n');

  await LLMist.createAgent()
    .withModel('haiku')
    .withMaxIterations(5)
    .withGadgets(SearchFiles)
    .withTrailingMessage((ctx) => {
      const progress = ctx.iteration / ctx.maxIterations;
      if (progress < 0.4) {
        return `[Iteration ${ctx.iteration}/${ctx.maxIterations}] You have time - explore the problem space.`;
      } else if (progress < 0.8) {
        return `[Iteration ${ctx.iteration}/${ctx.maxIterations}] Midway - focus on completing the main task.`;
      } else {
        return `[Iteration ${ctx.iteration}/${ctx.maxIterations}] URGENT: Wrap up now! Almost out of iterations.`;
      }
    })
    .withHooks({
      controllers: {
        beforeLLMCall: async (ctx) => {
          const lastMessage = ctx.options.messages[ctx.options.messages.length - 1];
          if (lastMessage.role === 'user' && lastMessage.content.includes('[Iteration')) {
            console.log(`   💡 ${lastMessage.content}`);
          }
          return { action: 'proceed' };
        },
      },
    })
    .askAndCollect('Search for files in multiple steps');
}

// ============================================================================
// Example 3: External Status Injection
// ============================================================================

async function example3_ExternalStatusInjection() {
  console.log('\n=== Example 3: External Status Injection ===\n');
  console.log('Inject external state that changes independently\n');

  // Simulated external state that changes during execution
  let taskStatus = 'pending';
  let systemLoad = 'normal';

  // Simulate external changes
  const statusUpdater = setInterval(() => {
    const statuses = ['pending', 'in_progress', 'blocked', 'completed'];
    const loads = ['low', 'normal', 'high', 'critical'];
    taskStatus = statuses[Math.floor(Math.random() * statuses.length)];
    systemLoad = loads[Math.floor(Math.random() * loads.length)];
  }, 500);

  try {
    await LLMist.createAgent()
      .withModel('haiku')
      .withMaxIterations(4)
      .withGadgets(ProcessTask)
      .withTrailingMessage(() => {
        return `[CURRENT STATUS] Task: ${taskStatus} | System Load: ${systemLoad}. ` +
               `Adjust your approach based on current conditions.`;
      })
      .withHooks({
        controllers: {
          beforeLLMCall: async (ctx) => {
            const lastMessage = ctx.options.messages[ctx.options.messages.length - 1];
            if (lastMessage.role === 'user' && lastMessage.content.includes('[CURRENT STATUS]')) {
              console.log(`   📊 Status injected: task=${taskStatus}, load=${systemLoad}`);
            }
            return { action: 'proceed' };
          },
        },
      })
      .askAndCollect('Process task-001 and check its status');
  } finally {
    clearInterval(statusUpdater);
  }
}

// ============================================================================
// Example 4: Format Enforcement
// ============================================================================

async function example4_FormatEnforcement() {
  console.log('\n=== Example 4: Format Enforcement ===\n');
  console.log('Enforce specific output format on every turn\n');

  await LLMist.createAgent()
    .withModel('haiku')
    .withMaxIterations(2)
    .withGadgets(SearchFiles)
    .withTrailingMessage(
      'OUTPUT REQUIREMENT: When you provide final answers (not gadget calls), ' +
      'format them as bullet points. Each point should be on its own line starting with "• ".'
    )
    .withHooks(HookPresets.logging())
    .askAndCollect('List the benefits of TypeScript');
}

// ============================================================================
// Example 5: Combining with Hooks
// ============================================================================

async function example5_CombiningWithHooks() {
  console.log('\n=== Example 5: Combining with Hooks ===\n');
  console.log('Trailing messages work alongside other hooks\n');

  await LLMist.createAgent()
    .withModel('haiku')
    .withMaxIterations(3)
    .withGadgets(SearchFiles)
    // Trailing message composes with existing hooks
    .withTrailingMessage((ctx) =>
      `[Turn ${ctx.iteration + 1}] Remember: be efficient and call gadgets in parallel when possible.`
    )
    // Other hooks work normally
    .withHooks(
      HookPresets.merge(
        HookPresets.timing(),
        HookPresets.tokenTracking(),
        {
          observers: {
            onLLMCallComplete: async (ctx) => {
              console.log(`   ✅ Completed iteration ${ctx.iteration}`);
            },
          },
        }
      )
    )
    .askAndCollect('Search for configuration files');
}

// ============================================================================
// Example 6: Ephemeral Nature Demonstration
// ============================================================================

async function example6_EphemeralNature() {
  console.log('\n=== Example 6: Ephemeral Nature ===\n');
  console.log('Trailing messages are NOT persisted to conversation history\n');

  const conversationHistory: string[] = [];

  await LLMist.createAgent()
    .withModel('haiku')
    .withMaxIterations(3)
    .withGadgets(SearchFiles)
    .withTrailingMessage('[EPHEMERAL] This message should NOT appear in history.')
    .withHooks({
      observers: {
        onLLMCallComplete: async (ctx) => {
          // Check what's in the final message (should not include trailing)
          const hasEphemeral = ctx.finalMessage.includes('[EPHEMERAL]');
          console.log(`   📝 Response includes [EPHEMERAL]: ${hasEphemeral ? 'YES (bug!)' : 'NO (correct!)'}`);
          conversationHistory.push(ctx.finalMessage);
        },
      },
    })
    .askAndCollect('Search for files');

  console.log('\n   Conversation history entries:', conversationHistory.length);
  const anyContainsEphemeral = conversationHistory.some((msg) =>
    msg.includes('[EPHEMERAL]')
  );
  console.log(`   Any history contains [EPHEMERAL]: ${anyContainsEphemeral ? 'YES (bug!)' : 'NO (correct!)'}`);
}

// ============================================================================
// Run all examples
// ============================================================================

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║          Trailing Messages Examples                        ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  try {
    await example1_StaticTrailingMessage();
    await example2_DynamicIterationMessage();
    await example3_ExternalStatusInjection();
    await example4_FormatEnforcement();
    await example5_CombiningWithHooks();
    await example6_EphemeralNature();

    console.log('\n✅ All examples completed successfully!\n');
  } catch (error) {
    console.error('\n❌ Error running examples:', error);
    process.exit(1);
  }
}

main();
