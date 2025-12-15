# llmist Block Format Specification

This document describes the block format used by llmist for gadget (tool) invocations in LLM output streams.

## Overview

The block format is a line-oriented text format designed for reliable streaming parsing. It allows LLMs to invoke gadgets by outputting structured text blocks that can be parsed incrementally as tokens arrive.

## Configurable Markers

The block format uses three configurable marker prefixes:

| Marker | Default Value | Purpose |
|--------|---------------|---------|
| Start prefix | `!!!GADGET_START:` | Begins a gadget block |
| End prefix | `!!!GADGET_END` | Terminates a gadget block (optional) |
| Arg prefix | `!!!ARG:` | Declares a parameter |

These can be customized via `GadgetCallParser` options:

```typescript
const parser = new GadgetCallParser({
  startPrefix: "<<<TOOL:",
  endPrefix: "<<<END",
  argPrefix: "@param:",
});
```

## EBNF Grammar

```ebnf
(* Top-level structure *)
gadget_block     = start_marker , header_line , newline , parameters , [ end_marker ] ;

(* Start and end markers - these are configurable *)
start_marker     = START_PREFIX ;   (* default: "!!!GADGET_START:" *)
end_marker       = END_PREFIX ;     (* default: "!!!GADGET_END" *)
arg_prefix       = ARG_PREFIX ;     (* default: "!!!ARG:" *)

(* Header line: gadget name with optional ID and dependencies *)
header_line      = gadget_name , [ ":" , invocation_id , [ ":" , dependencies ] ] ;
gadget_name      = identifier ;
invocation_id    = identifier ;
dependencies     = identifier , { "," , identifier } ;

(* Parameters section: zero or more argument definitions *)
parameters       = { parameter } ;
parameter        = arg_prefix , pointer , newline , value ;

(* JSON Pointer path (without leading /) for nested structures *)
pointer          = segment , { "/" , segment } ;
segment          = identifier | array_index ;
array_index      = digit , { digit } ;

(* Value: all text until next arg_prefix or end_marker *)
value            = { any_character } ;

(* Basic tokens *)
identifier       = letter_or_underscore , { letter_or_underscore | digit } ;
letter_or_underscore = letter | "_" ;
letter           = "A" | "B" | ... | "Z" | "a" | "b" | ... | "z" ;
digit            = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" ;
newline          = LF ;
any_character    = (* any Unicode character *) ;
```

## Header Line Formats

The header line supports three formats:

| Format | Example | Description |
|--------|---------|-------------|
| Name only | `Calculator` | Auto-generated ID (`gadget_N`), no dependencies |
| Name + ID | `Calculator:calc_1` | Explicit invocation ID, no dependencies |
| Name + ID + Deps | `Summarize:sum_1:fetch_1,fetch_2` | Explicit ID with dependencies |

Dependencies are comma-separated invocation IDs that must complete before this gadget executes.

## Parameter Pointer Syntax

Pointers use JSON Pointer-like syntax (RFC 6901) without the leading `/`:

| Pointer | Result Structure |
|---------|-----------------|
| `filename` | `{ "filename": value }` |
| `config/timeout` | `{ "config": { "timeout": value } }` |
| `items/0` | `{ "items": [value] }` |
| `items/0/name` | `{ "items": [{ "name": value }] }` |

Numeric segments create arrays; non-numeric segments create objects.

## Value Coercion

Single-line values are automatically coerced:

| Input | Coerced Type | Example |
|-------|--------------|---------|
| `"true"` / `"false"` | boolean | `true`, `false` |
| Numeric string | number | `42`, `3.14`, `-5` |
| Other | string | `"hello"` |

**Multiline values are never coerced** - they remain strings (typically code or content).

## Complete Example

```
!!!GADGET_START:WriteFile:write_1
!!!ARG:filePath
src/calculator.ts
!!!ARG:content
export function add(a: number, b: number): number {
  return a + b;
}
!!!GADGET_END
```

Parsed result:
```json
{
  "gadgetName": "WriteFile",
  "invocationId": "write_1",
  "dependencies": [],
  "parameters": {
    "filePath": "src/calculator.ts",
    "content": "export function add(a: number, b: number): number {\n  return a + b;\n}"
  }
}
```

## Parallel Execution Example

```
!!!GADGET_START:FetchData:fetch_users
!!!ARG:url
https://api.example.com/users
!!!GADGET_END
!!!GADGET_START:FetchData:fetch_orders
!!!ARG:url
https://api.example.com/orders
!!!GADGET_END
!!!GADGET_START:MergeData:merge_1:fetch_users,fetch_orders
!!!ARG:format
json
!!!GADGET_END
```

Here, `fetch_users` and `fetch_orders` can run in parallel, while `merge_1` waits for both to complete.

## Implicit Termination

The end marker (`!!!GADGET_END`) is optional. A gadget block terminates when:

1. An explicit `!!!GADGET_END` is encountered
2. A new `!!!GADGET_START:` begins (implicit termination)
3. The stream ends (finalization)

This allows streaming parsers to handle incomplete or truncated responses gracefully.

## Error Handling

The parser reports errors for:

- **Duplicate pointers**: Same path specified twice in one gadget
- **Array index gaps**: Non-sequential array indices (e.g., `items/0` then `items/5`)
- **Invalid array indices**: Negative or non-numeric indices

Parse errors are captured in the `parseError` field while `parametersRaw` preserves the original text for debugging.
