/**
 * Provider-specific constants and default values.
 *
 * This file centralizes magic numbers and hardcoded defaults to improve
 * maintainability and documentation. Each constant includes a comment
 * explaining its purpose and rationale.
 */

/**
 * Default maximum output tokens for Anthropic models.
 *
 * Rationale: Most Anthropic models (Claude 3 Opus, Sonnet, Haiku) support
 * at least 4096 output tokens. This is used as a fallback when:
 * - The user doesn't specify maxTokens explicitly
 * - The model spec doesn't define maxOutputTokens
 *
 * Note: Anthropic's API requires the max_tokens parameter, unlike OpenAI
 * which can infer it from the context window. This default ensures the API
 * call succeeds while allowing substantial output.
 *
 * Reference: https://docs.anthropic.com/en/docs/about-claude/models
 */
export const ANTHROPIC_DEFAULT_MAX_OUTPUT_TOKENS = 4096;

/**
 * Character-to-token ratio for fallback token estimation.
 *
 * Used only when tiktoken (the primary fallback) is unavailable. A value of 2
 * errs on the side of overestimating token count, which is safer for
 * compaction triggers and output limiting.
 *
 * Rationale: The previous value of 4 was based on English prose averages, but
 * agentic sessions are dominated by JSON, code, and structured data where the
 * real ratio is ~1.5-2.5 chars/token. A 4-char estimate underestimated tokens
 * by up to 250%, causing compaction and output limiting to never trigger.
 */
export const FALLBACK_CHARS_PER_TOKEN = 2;

/**
 * OpenAI message structure overhead in tokens.
 *
 * Rationale: OpenAI's chat completion format adds tokens for message
 * boundaries and structure. Each message follows the pattern:
 * <im_start>{role/name}\n{content}<im_end>\n
 *
 * This overhead accounts for:
 * - <im_start> token
 * - Role/name field tokens
 * - Newline and separator tokens
 * - <im_end> token
 *
 * The value of 4 tokens per message is based on OpenAI's official
 * tokenization examples and testing.
 *
 * Reference: https://github.com/openai/openai-cookbook/blob/main/examples/How_to_count_tokens_with_tiktoken.ipynb
 */
export const OPENAI_MESSAGE_OVERHEAD_TOKENS = 4;

/**
 * OpenAI reply priming overhead in tokens.
 *
 * Rationale: Every OpenAI assistant reply is primed with the tokens:
 * <im_start>assistant\n
 *
 * This adds 2 tokens to the total input token count before the actual
 * response generation begins. This is part of OpenAI's message formatting
 * and must be accounted for in accurate token counting.
 *
 * Reference: https://github.com/openai/openai-cookbook/blob/main/examples/How_to_count_tokens_with_tiktoken.ipynb
 */
export const OPENAI_REPLY_PRIMING_TOKENS = 2;

/**
 * OpenAI name field overhead in tokens.
 *
 * Rationale: When a message includes a "name" field (for identifying the
 * speaker in multi-party conversations), OpenAI's format adds 1 extra
 * token beyond the name's actual token count.
 *
 * This accounts for the separator between the role and name fields.
 *
 * Reference: https://github.com/openai/openai-cookbook/blob/main/examples/How_to_count_tokens_with_tiktoken.ipynb
 */
export const OPENAI_NAME_FIELD_OVERHEAD_TOKENS = 1;
