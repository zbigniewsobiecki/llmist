/**
 * Internal key for Agent instantiation.
 * This Symbol is used to ensure only AgentBuilder can create Agent instances.
 *
 * @internal
 */
export const AGENT_INTERNAL_KEY = Symbol("AGENT_INTERNAL_KEY");

/**
 * Type guard to check if the key is the correct internal key
 * @internal
 */
export function isValidAgentKey(key: unknown): key is typeof AGENT_INTERNAL_KEY {
  return key === AGENT_INTERNAL_KEY;
}
