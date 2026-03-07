import type { CLIConfig } from "./config-types.js";
import { ConfigError } from "./config-validators.js";
import {
  createTemplateEngine,
  hasTemplateSyntax,
  resolveTemplate,
  TemplateError,
  validateEnvVars,
  validatePrompts,
} from "./templates.js";

/**
 * Resolves gadget configuration with inheritance support.
 * Handles gadgets (full replacement), gadget-add (append), and gadget-remove (filter).
 *
 * Resolution order:
 * 1. If `gadgets` is present (or deprecated `gadget`), use it as full replacement
 * 2. Otherwise, start with inherited gadgets and apply add/remove
 *
 * @param section - The section's own values (not yet merged)
 * @param inheritedGadgets - Gadgets from parent sections
 * @param sectionName - Name of section for error messages
 * @param configPath - Path to config file for error messages
 * @returns Resolved gadget array
 * @throws ConfigError if conflicting gadget options
 */
export function resolveGadgets(
  section: Record<string, unknown>,
  inheritedGadgets: string[],
  sectionName: string,
  configPath?: string,
): string[] {
  const hasGadgets = "gadgets" in section;
  const hasGadgetLegacy = "gadget" in section;
  const hasGadgetAdd = "gadget-add" in section;
  const hasGadgetRemove = "gadget-remove" in section;

  // Warn on deprecated 'gadget' usage
  if (hasGadgetLegacy && !hasGadgets) {
    console.warn(
      `[config] Warning: [${sectionName}].gadget is deprecated, use 'gadgets' (plural) instead`,
    );
  }

  // Error if both full replacement AND add/remove
  if ((hasGadgets || hasGadgetLegacy) && (hasGadgetAdd || hasGadgetRemove)) {
    throw new ConfigError(
      `[${sectionName}] Cannot use 'gadgets' with 'gadget-add'/'gadget-remove'. ` +
        `Use either full replacement (gadgets) OR modification (gadget-add/gadget-remove).`,
      configPath,
    );
  }

  // Full replacement mode (new `gadgets` takes precedence over deprecated `gadget`)
  if (hasGadgets) {
    return section.gadgets as string[];
  }
  if (hasGadgetLegacy) {
    return section.gadget as string[];
  }

  // Modification mode: start with inherited
  let result = [...inheritedGadgets];

  // Apply removes first
  if (hasGadgetRemove) {
    const toRemove = new Set(section["gadget-remove"] as string[]);
    result = result.filter((g) => !toRemove.has(g));
  }

  // Then apply adds
  if (hasGadgetAdd) {
    const toAdd = section["gadget-add"] as string[];
    result.push(...toAdd);
  }

  return result;
}

/**
 * Resolves inheritance chains for all sections in the config.
 * Each section can specify `inherits` as a string or array of strings.
 * Resolution follows these rules:
 * - For multiple parents, later parents override earlier ones (last wins)
 * - Section's own values always override inherited values
 * - Arrays are replaced, not merged (except gadgets with add/remove support)
 * - Circular inheritance is detected and throws an error
 *
 * @param config - Validated config with possible unresolved inheritance
 * @param configPath - Path to config file for error messages
 * @returns Config with all inheritance resolved
 * @throws ConfigError if circular inheritance or unknown parent section
 */
export function resolveInheritance(config: CLIConfig, configPath?: string): CLIConfig {
  const resolved: Record<string, Record<string, unknown>> = {};
  const resolving = new Set<string>(); // For cycle detection

  function resolveSection(name: string): Record<string, unknown> {
    // Return cached if already resolved
    if (name in resolved) {
      return resolved[name];
    }

    // Cycle detection
    if (resolving.has(name)) {
      throw new ConfigError(`Circular inheritance detected: ${name}`, configPath);
    }

    const section = config[name];
    if (section === undefined || typeof section !== "object") {
      throw new ConfigError(`Cannot inherit from unknown section: ${name}`, configPath);
    }

    resolving.add(name);

    // Get inheritance list (normalize to array)
    const sectionObj = section as Record<string, unknown>;
    const inheritsRaw = sectionObj.inherits;
    const inheritsList: string[] = inheritsRaw
      ? Array.isArray(inheritsRaw)
        ? inheritsRaw
        : [inheritsRaw]
      : [];

    // Resolve all parents first (recursive), merge in order (last wins)
    let merged: Record<string, unknown> = {};
    for (const parent of inheritsList) {
      const parentResolved = resolveSection(parent);
      merged = { ...merged, ...parentResolved };
    }

    // Get inherited gadgets before applying own values
    const inheritedGadgets = (merged.gadgets as string[] | undefined) ?? [];

    // Apply own values on top (excluding metadata and gadget-related keys handled specially)
    const {
      inherits: _inherits,
      gadgets: _gadgets,
      gadget: _gadget,
      "gadget-add": _gadgetAdd,
      "gadget-remove": _gadgetRemove,
      ...ownValues
    } = sectionObj;
    merged = { ...merged, ...ownValues };

    // Resolve gadgets with add/remove support
    const resolvedGadgets = resolveGadgets(sectionObj, inheritedGadgets, name, configPath);
    if (resolvedGadgets.length > 0) {
      merged.gadgets = resolvedGadgets;
    }

    // Clean up legacy/modification fields from output
    delete merged.gadget;
    delete merged["gadget-add"];
    delete merged["gadget-remove"];

    resolving.delete(name);
    resolved[name] = merged;
    return merged;
  }

  // Resolve all sections
  for (const name of Object.keys(config)) {
    resolveSection(name);
  }

  return resolved as unknown as CLIConfig;
}

/**
 * Resolves Eta templates in system prompts throughout the config.
 * Templates are resolved using the [prompts] section as named partials.
 *
 * @param config - Config with inheritance already resolved
 * @param configPath - Path to config file for error messages
 * @returns Config with all templates resolved in system prompts
 * @throws ConfigError if template resolution fails
 */
export function resolveTemplatesInConfig(config: CLIConfig, configPath?: string): CLIConfig {
  const prompts = config.prompts ?? {};

  // If no prompts and no templates used, return as-is
  const hasPrompts = Object.keys(prompts).length > 0;

  // Check if any section uses template syntax
  let hasTemplates = false;
  for (const [sectionName, section] of Object.entries(config)) {
    if (sectionName === "global" || sectionName === "prompts") continue;
    if (!section || typeof section !== "object") continue;

    const sectionObj = section as Record<string, unknown>;
    if (typeof sectionObj.system === "string" && hasTemplateSyntax(sectionObj.system)) {
      hasTemplates = true;
      break;
    }
  }

  // Also check prompts for template syntax (they may reference each other)
  for (const template of Object.values(prompts)) {
    if (hasTemplateSyntax(template)) {
      hasTemplates = true;
      break;
    }
  }

  // Quick return if nothing to do
  if (!hasPrompts && !hasTemplates) {
    return config;
  }

  // Validate all prompts compile correctly and env vars exist
  try {
    validatePrompts(prompts, configPath);
  } catch (error) {
    if (error instanceof TemplateError) {
      throw new ConfigError(error.message, configPath);
    }
    throw error;
  }

  // Validate environment variables in all prompts
  for (const [name, template] of Object.entries(prompts)) {
    try {
      validateEnvVars(template, name, configPath);
    } catch (error) {
      if (error instanceof TemplateError) {
        throw new ConfigError(error.message, configPath);
      }
      throw error;
    }
  }

  // Create template engine with all prompts registered
  const eta = createTemplateEngine(prompts, configPath);
  const result = { ...config };

  // Resolve templates in all sections with system fields
  for (const [sectionName, section] of Object.entries(config)) {
    if (sectionName === "global" || sectionName === "prompts") continue;
    if (!section || typeof section !== "object") continue;

    const sectionObj = section as Record<string, unknown>;
    if (typeof sectionObj.system === "string" && hasTemplateSyntax(sectionObj.system)) {
      // Validate env vars in the system prompt itself
      try {
        validateEnvVars(sectionObj.system, undefined, configPath);
      } catch (error) {
        if (error instanceof TemplateError) {
          throw new ConfigError(`[${sectionName}].system: ${error.message}`, configPath);
        }
        throw error;
      }

      // Resolve the template
      try {
        const resolved = resolveTemplate(eta, sectionObj.system, {}, configPath);
        result[sectionName] = {
          ...sectionObj,
          system: resolved,
        };
      } catch (error) {
        if (error instanceof TemplateError) {
          throw new ConfigError(`[${sectionName}].system: ${error.message}`, configPath);
        }
        throw error;
      }
    }
  }

  return result;
}
