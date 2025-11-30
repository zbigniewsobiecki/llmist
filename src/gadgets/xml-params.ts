/**
 * XML-like parameter format parser for LLM output.
 *
 * This format is designed to be LLM-friendly:
 * - Clear tag boundaries eliminate nesting ambiguity
 * - No escaping rules (CDATA handles special content)
 * - No indentation sensitivity
 * - Familiar to LLMs from HTML/XML training data
 *
 * Format specification:
 * - Basic: <name>value</name>
 * - Boolean: <enabled>true</enabled> or <enabled>false</enabled>
 * - Number: <count>42</count> (auto-detected)
 * - Null/empty: <optional/> or <optional></optional>
 * - Arrays: Repeated child tags with same name
 *   <items><item>a</item><item>b</item></items> → { items: ["a", "b"] }
 * - Objects: Nested tags
 *   <config><timeout>30</timeout></config> → { config: { timeout: 30 } }
 * - Multiline: <code><![CDATA[content here]]></code>
 */

/**
 * Error thrown when XML parsing fails.
 */
export class XmlParseError extends Error {
  constructor(
    message: string,
    public readonly position?: number,
  ) {
    super(message);
    this.name = "XmlParseError";
  }
}

interface XmlNode {
  tag: string;
  children: XmlNode[];
  text: string | null;
  isSelfClosing: boolean;
}

/**
 * Tokenizer for lenient XML parsing.
 */
class XmlTokenizer {
  private pos = 0;

  constructor(private readonly input: string) {}

  get position(): number {
    return this.pos;
  }

  get remaining(): string {
    return this.input.slice(this.pos);
  }

  get done(): boolean {
    return this.pos >= this.input.length;
  }

  peek(n = 1): string {
    return this.input.slice(this.pos, this.pos + n);
  }

  advance(n = 1): string {
    const result = this.input.slice(this.pos, this.pos + n);
    this.pos += n;
    return result;
  }

  skipWhitespace(): void {
    while (!this.done && /\s/.test(this.input[this.pos])) {
      this.pos++;
    }
  }

  /**
   * Read until we hit the target string.
   */
  readUntil(target: string): string {
    const startPos = this.pos;
    const idx = this.input.indexOf(target, this.pos);
    if (idx === -1) {
      // Read to end
      this.pos = this.input.length;
      return this.input.slice(startPos);
    }
    this.pos = idx;
    return this.input.slice(startPos, idx);
  }

  /**
   * Try to match and consume the target string.
   */
  match(target: string): boolean {
    if (this.peek(target.length) === target) {
      this.advance(target.length);
      return true;
    }
    return false;
  }

  /**
   * Read a tag name (letters, digits, hyphens, underscores).
   */
  readTagName(): string {
    const start = this.pos;
    while (!this.done && /[\w-]/.test(this.input[this.pos])) {
      this.pos++;
    }
    return this.input.slice(start, this.pos);
  }
}

/**
 * Parse XML content into a tree of nodes.
 */
function parseXmlNodes(tokenizer: XmlTokenizer): XmlNode[] {
  const nodes: XmlNode[] = [];

  while (!tokenizer.done) {
    tokenizer.skipWhitespace();
    if (tokenizer.done) break;

    // Check for opening tag
    if (tokenizer.peek() === "<") {
      // Check for closing tag (belongs to parent)
      if (tokenizer.peek(2) === "</") {
        break;
      }

      // Check for CDATA
      if (tokenizer.peek(9) === "<![CDATA[") {
        tokenizer.advance(9);
        const content = tokenizer.readUntil("]]>");
        tokenizer.match("]]>");
        // CDATA is treated as text content, will be merged later
        nodes.push({
          tag: "__CDATA__",
          children: [],
          text: content,
          isSelfClosing: false,
        });
        continue;
      }

      // Check for comment
      if (tokenizer.peek(4) === "<!--") {
        tokenizer.advance(4);
        tokenizer.readUntil("-->");
        tokenizer.match("-->");
        continue;
      }

      // Parse opening tag
      tokenizer.advance(1); // consume <
      tokenizer.skipWhitespace();
      const tagName = tokenizer.readTagName();
      if (!tagName) {
        throw new XmlParseError(`Expected tag name at position ${tokenizer.position}`);
      }

      tokenizer.skipWhitespace();

      // Check for self-closing
      if (tokenizer.match("/>")) {
        nodes.push({
          tag: tagName,
          children: [],
          text: null,
          isSelfClosing: true,
        });
        continue;
      }

      // Skip attributes (we don't use them but LLMs might add them)
      while (!tokenizer.done && tokenizer.peek() !== ">" && tokenizer.peek() !== "/") {
        // Skip attribute name
        tokenizer.readTagName();
        tokenizer.skipWhitespace();
        if (tokenizer.match("=")) {
          tokenizer.skipWhitespace();
          // Skip attribute value (quoted or unquoted)
          if (tokenizer.peek() === '"' || tokenizer.peek() === "'") {
            const quote = tokenizer.advance();
            tokenizer.readUntil(quote);
            tokenizer.advance();
          } else {
            // Unquoted value - read until whitespace or >
            while (!tokenizer.done && !/[\s>\/]/.test(tokenizer.peek())) {
              tokenizer.advance();
            }
          }
        }
        tokenizer.skipWhitespace();
      }

      // Check for self-closing again (after attributes)
      if (tokenizer.match("/>")) {
        nodes.push({
          tag: tagName,
          children: [],
          text: null,
          isSelfClosing: true,
        });
        continue;
      }

      // Consume >
      if (!tokenizer.match(">")) {
        throw new XmlParseError(`Expected > at position ${tokenizer.position}`);
      }

      // Read content (either text or child nodes)
      let textContent = "";
      const children: XmlNode[] = [];

      while (!tokenizer.done) {
        // Check for closing tag
        if (tokenizer.peek(2) === "</") {
          break;
        }

        // Check for child tag or CDATA
        if (tokenizer.peek() === "<") {
          // Could be child tag, CDATA, or comment
          if (tokenizer.peek(9) === "<![CDATA[") {
            tokenizer.advance(9);
            textContent += tokenizer.readUntil("]]>");
            tokenizer.match("]]>");
            continue;
          }
          if (tokenizer.peek(4) === "<!--") {
            tokenizer.advance(4);
            tokenizer.readUntil("-->");
            tokenizer.match("-->");
            continue;
          }

          // It's a child tag
          const childNodes = parseXmlNodes(tokenizer);
          children.push(...childNodes);
        } else {
          // Text content
          const text = tokenizer.readUntil("<");
          textContent += text;
        }
      }

      // Consume closing tag
      if (tokenizer.match("</")) {
        tokenizer.skipWhitespace();
        const closingTag = tokenizer.readTagName();
        if (closingTag !== tagName) {
          // Lenient: accept mismatched tags (LLMs sometimes make mistakes)
          // Just log it but continue
        }
        tokenizer.skipWhitespace();
        tokenizer.match(">");
      }

      // Trim text content
      const trimmedText = textContent.trim();

      nodes.push({
        tag: tagName,
        children,
        text: children.length === 0 ? (trimmedText || null) : null,
        isSelfClosing: false,
      });
    } else {
      // Text outside tags - skip it
      tokenizer.readUntil("<");
    }
  }

  return nodes;
}

/**
 * Infer the JavaScript type from a string value.
 */
function inferType(value: string | null): unknown {
  if (value === null || value === "") {
    return null;
  }

  const trimmed = value.trim();

  // Boolean
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;

  // Number (integer or float)
  if (/^-?\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }
  if (/^-?\d+\.\d+$/.test(trimmed)) {
    return parseFloat(trimmed);
  }

  // String (keep original, not trimmed, for multiline content)
  return value;
}

/**
 * Convert XML nodes to a JavaScript object.
 */
function nodesToObject(nodes: XmlNode[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // Group nodes by tag name to detect arrays
  const byTag = new Map<string, XmlNode[]>();
  for (const node of nodes) {
    if (node.tag === "__CDATA__") continue; // Skip standalone CDATA

    const existing = byTag.get(node.tag) ?? [];
    existing.push(node);
    byTag.set(node.tag, existing);
  }

  for (const [tag, tagNodes] of byTag) {
    if (tagNodes.length > 1) {
      // Multiple nodes with same tag = array
      result[tag] = tagNodes.map((n) => nodeToValue(n));
    } else {
      // Single node
      result[tag] = nodeToValue(tagNodes[0]);
    }
  }

  return result;
}

/**
 * Convert a single XML node to a JavaScript value.
 */
function nodeToValue(node: XmlNode): unknown {
  // Self-closing or empty = null
  if (node.isSelfClosing || (node.text === null && node.children.length === 0)) {
    return null;
  }

  // Has text content = leaf value
  if (node.text !== null) {
    return inferType(node.text);
  }

  // Has children = object or array
  if (node.children.length > 0) {
    // Check if all children have the same tag AND there's more than one (array pattern)
    const childTags = new Set(node.children.map((c) => c.tag));
    if (childTags.size === 1 && node.children.length > 1) {
      // Multiple children with same tag = array
      // E.g., <values><value>1</value><value>2</value></values> → [1, 2]
      return node.children.map((c) => nodeToValue(c));
    }

    // Mixed children = object
    return nodesToObject(node.children);
  }

  return null;
}

/**
 * Parse XML-like parameter format from LLM output.
 *
 * @param xml - The XML string to parse
 * @returns Parsed parameters as a JavaScript object
 * @throws XmlParseError if parsing fails or no XML tags found
 */
export function parseXmlParams(xml: string): Record<string, unknown> {
  const trimmed = xml.trim();
  if (!trimmed) {
    throw new XmlParseError("Empty input");
  }

  // Quick check: XML content must start with < (after trimming)
  // This prevents non-XML content (like TOML/YAML) from being parsed as empty
  if (!trimmed.startsWith("<")) {
    throw new XmlParseError("Not XML: content must start with a tag");
  }

  const tokenizer = new XmlTokenizer(trimmed);
  const nodes = parseXmlNodes(tokenizer);

  if (nodes.length === 0) {
    throw new XmlParseError("No XML tags found");
  }

  return nodesToObject(nodes);
}

/**
 * Find a safe CDATA delimiter that doesn't appear in the content.
 */
function findSafeCdataDelimiter(content: string): string | null {
  if (!content.includes("]]>")) {
    return null; // Standard CDATA is fine
  }
  // Content contains ]]>, can't use CDATA safely
  // Return null to signal we should escape instead
  return null;
}

/**
 * Escape XML special characters in text content.
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Get the singular form of a plural tag name for array children.
 * Simple heuristic: remove trailing 's' if present.
 */
function getSingularTag(pluralTag: string): string {
  if (pluralTag.endsWith("ies")) {
    return pluralTag.slice(0, -3) + "y"; // e.g., "entries" → "entry"
  }
  if (pluralTag.endsWith("es") && !pluralTag.endsWith("ses")) {
    return pluralTag.slice(0, -2); // e.g., "boxes" → "box"
  }
  if (pluralTag.endsWith("s") && pluralTag.length > 1) {
    return pluralTag.slice(0, -1); // e.g., "items" → "item"
  }
  return "item"; // fallback
}

/**
 * Format a JavaScript value as XML.
 */
function formatXmlValue(tag: string, value: unknown, indent = ""): string {
  if (value === null || value === undefined) {
    return `${indent}<${tag}/>`;
  }

  if (typeof value === "boolean" || typeof value === "number") {
    return `${indent}<${tag}>${value}</${tag}>`;
  }

  if (typeof value === "string") {
    if (value.includes("\n") || value.includes("<") || value.includes("&")) {
      // Use CDATA for complex content
      const cdataSafe = findSafeCdataDelimiter(value);
      if (cdataSafe === null && !value.includes("]]>")) {
        return `${indent}<${tag}><![CDATA[${value}]]></${tag}>`;
      }
      // Fallback to escaping if CDATA not safe
      return `${indent}<${tag}>${escapeXml(value)}</${tag}>`;
    }
    return `${indent}<${tag}>${value}</${tag}>`;
  }

  if (Array.isArray(value)) {
    const childTag = getSingularTag(tag);
    const children = value.map((item) => formatXmlValue(childTag, item, indent + "  ")).join("\n");
    return `${indent}<${tag}>\n${children}\n${indent}</${tag}>`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return `${indent}<${tag}/>`;
    }
    const children = entries.map(([k, v]) => formatXmlValue(k, v, indent + "  ")).join("\n");
    return `${indent}<${tag}>\n${children}\n${indent}</${tag}>`;
  }

  return `${indent}<${tag}>${String(value)}</${tag}>`;
}

/**
 * Format parameters as XML tags.
 *
 * @param params - The parameters to format
 * @returns XML string representation
 */
export function formatParamsAsXml(params: Record<string, unknown>): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(params)) {
    lines.push(formatXmlValue(key, value));
  }

  return lines.join("\n");
}
