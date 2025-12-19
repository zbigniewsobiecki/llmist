/**
 * Common utility functions shared across provider implementations
 */

/**
 * Safely read an environment variable
 * @param key - The environment variable key to read
 * @returns The value if found and valid, undefined otherwise
 */
export function readEnvVar(key: string): string | undefined {
  if (typeof process === "undefined" || typeof process.env === "undefined") {
    return undefined;
  }
  const value = process.env[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Check if a value is a non-empty string
 * @param value - The value to check
 * @returns true if the value is a non-empty string, false otherwise
 */
export function isNonEmpty(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Generic factory function for creating provider instances from environment variables
 * @param envVarName - Name of the environment variable containing the API key
 * @param ClientClass - Constructor for the SDK client
 * @param ProviderClass - Constructor for the provider adapter
 * @param clientOptions - Optional additional options to pass to the client constructor
 * @returns Provider instance or null if API key is not set
 */
export function createProviderFromEnv<TClient, TProvider>(
  envVarName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ClientClass: new (config: any) => TClient,
  ProviderClass: new (client: TClient) => TProvider,
  clientOptions?: Record<string, unknown>,
): TProvider | null {
  const apiKey = readEnvVar(envVarName);
  if (!isNonEmpty(apiKey)) {
    return null;
  }

  // Create client with API key and optional config
  const client = new ClientClass({ apiKey: apiKey.trim(), ...clientOptions });

  return new ProviderClass(client);
}
