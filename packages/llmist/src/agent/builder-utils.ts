import { GADGET_ARG_PREFIX, GADGET_END_PREFIX, GADGET_START_PREFIX } from "../core/constants.js";

/**
 * Format a complete gadget call block.
 */
export function formatGadgetCall(
  gadgetName: string,
  invocationId: string,
  parameters: Record<string, unknown>,
  prefixes?: {
    start?: string;
    end?: string;
    arg?: string;
  },
): string {
  const startPrefix = prefixes?.start ?? GADGET_START_PREFIX;
  const endPrefix = prefixes?.end ?? GADGET_END_PREFIX;
  const argPrefix = prefixes?.arg ?? GADGET_ARG_PREFIX;

  const paramStr = formatBlockParameters(parameters, "", argPrefix);

  return `${startPrefix}${gadgetName}:${invocationId}\n${paramStr}\n${endPrefix}`;
}

/**
 * Format parameters as block format with JSON Pointer paths.
 * Used internally by AgentBuilder and SystemMessageBuilder.
 */
export function formatBlockParameters(
  params: Record<string, unknown>,
  prefix: string,
  argPrefix: string = GADGET_ARG_PREFIX,
): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(params)) {
    const fullPath = prefix ? `${prefix}/${key}` : key;

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        const itemPath = `${fullPath}/${index}`;
        if (typeof item === "object" && item !== null) {
          lines.push(formatBlockParameters(item as Record<string, unknown>, itemPath, argPrefix));
        } else {
          lines.push(`${argPrefix}${itemPath}`);
          lines.push(String(item));
        }
      });
    } else if (typeof value === "object" && value !== null) {
      lines.push(formatBlockParameters(value as Record<string, unknown>, fullPath, argPrefix));
    } else {
      lines.push(`${argPrefix}${fullPath}`);
      lines.push(String(value));
    }
  }

  return lines.join("\n");
}
