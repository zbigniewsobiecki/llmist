---
name: analyze-llmist-cli-session
description: Analyze llmist CLI session logs to debug failures, understand agent behavior, and diagnose issues. Use this skill whenever the user mentions session logs, asks about a recent llmist run, wants to know why an agent session failed or behaved unexpectedly, references a session by name (like "witty-raven"), asks about errors in llmist, or wants to understand what happened in a past CLI invocation. Also trigger when the user says things like "what went wrong", "check the logs", "last session", "most recent run", or "debug the agent".
---

# Analyzing llmist CLI Session Logs

You're investigating an llmist CLI session to help the user understand what happened — typically why something failed or behaved unexpectedly.

## Finding the right session

Sessions live at `~/.llmist/logs/`. Each session is a directory with a memorable name like `witty-raven` or `quiet-heart-2`.

To find the most recent session:
```bash
ls -lt ~/.llmist/logs/ | head -10
```

Some session directories are empty (user quit before any LLM calls happened). Skip those — look for directories containing files:
```bash
ls ~/.llmist/logs/<session-name>/
```

If the user names a specific session, go directly to `~/.llmist/logs/<session-name>/`.

## Session anatomy

Each session directory contains three types of files that give complementary views of what happened:

### 1. `NNNN.request` — What the LLM saw

Human-readable dump of the messages sent to the LLM at each iteration. Format:

```
=== SYSTEM ===
<system prompt content>

=== USER ===
<user message or gadget results>

=== ASSISTANT ===
<previous assistant response>
```

Numbered sequentially: `0001.request`, `0002.request`, etc. Each file represents one LLM API call. The request payloads grow over the session because they accumulate the conversation history — so later files contain all previous exchanges plus new gadget results.

### 2. `NNNN.response` — What the LLM decided

Raw LLM output in llmist's gadget block format:

```
!!!GADGET_START:GadgetName:invocation_id
!!!ARG:parameterName
parameter value (can be multiline)
!!!ARG:anotherParam
another value
!!!GADGET_END
```

Multiple gadget calls can appear in a single response. Text output to the user appears via `TellUser` gadget. The response files are typically much smaller than requests.

### 3. `session.log.jsonl` — The structured execution trace

Despite the `.jsonl` extension, this is actually **TSV-formatted** (tab-separated). Each line:

```
TIMESTAMP\tLEVEL\t[logger:path]\tMessage\t{JSON metadata}
```

- **Timestamp**: `2026-03-24 11:05:05:866` (millisecond precision)
- **Levels**: `SILLY`, `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL`
- **Logger path**: Hierarchical like `[llmist:cli:agent:stream-processor:executor]`
- **Message**: Human-readable description
- **JSON metadata**: Structured data (model, parameters, timing, results, errors)

## Analysis workflow

### Step 1: Quick overview

Start with the session.log.jsonl to get the big picture. Focus on INFO-level entries first:

```bash
grep '\tINFO\t' ~/.llmist/logs/<session>/session.log.jsonl
```

This reveals:
- **Model used**: Look for `Starting agent loop` → `{"model":"...","maxIterations":...}`
- **Number of iterations**: Count `Starting iteration` entries
- **Gadgets called**: Look for `Gadget executed successfully` → `{"gadgetName":"...","executionTimeMs":...}`
- **Errors**: Look for `Gadget execution failed` or similar

### Step 2: Find errors and warnings

```bash
grep -E '\t(ERROR|WARN|FATAL)\t' ~/.llmist/logs/<session>/session.log.jsonl
```

If no explicit errors, check for signs of trouble:
- Session ending abruptly (fewer iterations than maxIterations but no final output)
- Repeated gadget failures
- Very long execution times
- Context overflow or compaction events

### Step 3: Deep-dive into specific iterations

Once you've identified a problematic iteration (say iteration 3), examine:

1. **What the LLM was asked** — Read `0004.request` (iteration N maps to request file N+1 because iteration 0 produces 0001.request). Focus on the last `=== USER ===` section which contains the most recent gadget results or user input.

2. **What the LLM responded** — Read `0004.response` to see which gadgets it tried to call and with what parameters.

3. **What happened during execution** — Filter the session log for that iteration:
   ```bash
   grep 'iteration.*3\|iteration":3' ~/.llmist/logs/<session>/session.log.jsonl
   ```

### Step 4: Trace gadget execution chains

For failures related to specific gadgets, trace the full lifecycle:

```bash
grep '<gadget_name>' ~/.llmist/logs/<session>/session.log.jsonl
```

This shows: gadget invocation → parameter parsing → execution start → result or error.

The JSON metadata in gadget log entries contains the actual parameters passed and results returned, which is invaluable for understanding data flow issues.

## Common failure patterns

**Context overflow / 400 errors**: The request payload grew too large. Check if compaction was triggered (`grep -i compact`) and whether it helped. Look at request file sizes — if they grow monotonically and hit a wall, this is likely the cause.

**Gadget execution errors**: A tool the LLM called threw an exception. The error details are in the session log's JSON metadata. Check what parameters were passed — often the LLM hallucinated a file path or passed malformed arguments.

**Infinite loops**: The agent hit maxIterations without completing. Look at the last few iterations to see if the LLM was repeating the same actions or getting stuck in a retry loop.

**Model refusals**: The LLM refused to do something or gave an unexpected non-tool response. Check the response files for iterations where no gadget blocks appear.

**Rate limiting / API errors**: Look for HTTP error codes or retry messages in the session log. These often appear at WARN or ERROR level.

**Subagent failures**: If the logger path includes deep nesting like `[llmist:cli:agent:stream-processor:executor]`, the agent may have spawned subagents. Check for nested agent loops and their individual success/failure.

## Presenting findings

When reporting to the user:
1. Lead with what went wrong (the error or unexpected behavior)
2. Show the causal chain (what led to the failure)
3. Quote relevant log lines or response snippets as evidence
4. Suggest what could be done differently (if applicable)

Keep it concrete — reference specific iteration numbers, gadget names, and timestamps so the user can cross-reference.
