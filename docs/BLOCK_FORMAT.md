# Block Format Reference

llmist uses a simple block format that works with any text model. This format uses marker prefixes to delimit gadget calls and their parameters—no native tool calling or structured outputs required.

## Basic Structure

A gadget call consists of a start marker, parameters, and an end marker:

```
!!!GADGET_START:GadgetName
!!!ARG:parameter_name
parameter_value
!!!ARG:another_param
another_value
!!!GADGET_END
```

## Markers

| Marker | Purpose |
|--------|---------|
| `!!!GADGET_START:Name` | Begins a gadget call with the gadget name |
| `!!!ARG:pointer` | Declares a parameter (value on following line(s)) |
| `!!!GADGET_END` | Ends the gadget call |

## Parameter Syntax

Parameters use `!!!ARG:` followed by a **JSON Pointer path** (without leading `/`) to specify where to place the value.

### Simple Parameters

```
!!!ARG:filename
calculator.ts
!!!ARG:language
typescript
```

Result: `{ filename: "calculator.ts", language: "typescript" }`

### Nested Objects

Use `/` to create nested structures:

```
!!!ARG:config/timeout
30
!!!ARG:config/retries
3
```

Result: `{ config: { timeout: 30, retries: 3 } }`

### Arrays

Use numeric indices (0-based):

```
!!!ARG:items/0
first
!!!ARG:items/1
second
!!!ARG:items/2
third
```

Result: `{ items: ["first", "second", "third"] }`

### Arrays of Objects

Combine array indices with nested paths:

```
!!!ARG:users/0/name
Alice
!!!ARG:users/0/age
25
!!!ARG:users/1/name
Bob
!!!ARG:users/1/age
30
```

Result: `{ users: [{ name: "Alice", age: 25 }, { name: "Bob", age: 30 }] }`

### Deeply Nested Structures

```
!!!ARG:data/settings/notifications/email/enabled
true
!!!ARG:data/settings/notifications/email/frequency
daily
```

Result:
```json
{
  "data": {
    "settings": {
      "notifications": {
        "email": {
          "enabled": true,
          "frequency": "daily"
        }
      }
    }
  }
}
```

## Automatic Type Coercion

Single-line values are automatically coerced to appropriate types:

| Value | Coerced Type | Result |
|-------|--------------|--------|
| `true` | boolean | `true` |
| `false` | boolean | `false` |
| `42` | number | `42` |
| `3.14` | number | `3.14` |
| `-17` | number | `-17` |
| `hello` | string | `"hello"` |
| (multiline) | string | preserved as-is |

**Important**: Multiline values are never coerced—they always remain strings. This is intentional for code blocks and content.

### Schema-Aware Coercion

When a Zod schema is provided, coercion respects the schema's expected types:

- `z.string()` → value stays as string (no coercion)
- `z.number()` → numeric strings coerced to numbers
- `z.boolean()` → "true"/"false" coerced to booleans

This prevents issues like numeric IDs being accidentally converted to numbers when the schema expects strings.

## Multiline Values

Multiline content is preserved exactly as written:

```
!!!ARG:code
function hello() {
  console.log("Hello, World!");
  return { key: "value" };
}
!!!ARG:filename
example.ts
```

- Internal newlines are preserved
- A single trailing newline is stripped
- Great for code, documentation, or any multi-line content

## Complete Examples

### Calculator Gadget

```
!!!GADGET_START:Calculator
!!!ARG:operation
multiply
!!!ARG:a
15
!!!ARG:b
23
!!!GADGET_END
```

### File Writing with Code

```
!!!GADGET_START:WriteFile
!!!ARG:filePath
src/utils/calculator.ts
!!!ARG:content
export class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }

  multiply(a: number, b: number): number {
    return a * b;
  }
}
!!!GADGET_END
```

### Multiple Gadgets in Sequence

```
I'll perform both calculations for you.

!!!GADGET_START:Calculator
!!!ARG:operation
add
!!!ARG:a
5
!!!ARG:b
3
!!!GADGET_END

Now let me multiply those values:

!!!GADGET_START:Calculator
!!!ARG:operation
multiply
!!!ARG:a
8
!!!ARG:b
4
!!!GADGET_END

The results are 8 and 32.
```

## Constraints & Error Handling

### No Duplicate Pointers

Each parameter path can only appear once per gadget call:

```
!!!ARG:name
Alice
!!!ARG:name
Bob
```
Error: `Duplicate pointer: name`

### Sequential Array Indices

Array indices must be sequential (no gaps):

```
!!!ARG:items/0
first
!!!ARG:items/2
third
```
Error: `Array index gap: expected 1, got 2`

### Case Sensitivity

Markers are case-sensitive and must be exact:
- `!!!GADGET_START:`, `!!!ARG:`, `!!!GADGET_END`
- `!!!gadget_start:`, `!!!Arg:`, `!!!GADGET_end`

## Customizing Markers

You can customize the marker prefixes if needed:

```typescript
await LLMist.createAgent()
  .withGadgetStartPrefix('<<<START:')
  .withGadgetEndPrefix('<<<END:')
  .withGadgetArgPrefix('@param:')
  .ask('...');
```

This would expect:
```
<<<START:Calculator
@param:a
5
@param:b
3
<<<END:
```

## See Also

- **[Gadgets Guide](./GADGETS.md)** - Creating custom gadgets
- **[CLI Reference](./CLI.md)** - Command-line usage
- **[Configuration](./CONFIGURATION.md)** - All configuration options
