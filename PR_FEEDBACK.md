# PR Review: feat(gadgets): add TOML as default parameter format (#87)

## Overall Impression
This is a very well-thought-out and critical improvement. The problem of YAML's incompatibility with markdown content, especially for multi-line string parameters, is a significant pain point for LLM-generated gadget invocations. Switching to TOML's triple-quoted strings is an excellent solution that directly addresses this. The detailed problem statement, clear solution, and comprehensive test plan are highly commendable.

## Key Positive Points

1.  **Clear Problem Statement:** The PR clearly articulates the issue with YAML parsing markdown, including a concrete example from logs. This demonstrates a deep understanding of the problem space.
2.  **Effective Solution:** The adoption of TOML with its triple-quoted string syntax is an elegant and robust solution for handling complex multi-line content, making gadget invocations much more reliable.
3.  **Thoughtful Fallback Mechanism:** The `JSON → TOML → YAML` auto-detection logic is a great addition, ensuring backward compatibility and flexibility.
4.  **Comprehensive Testing:** Explicitly mentioning running existing parser tests, adding TOML-specific cases, and verifying markdown handling, along with the "All 897 tests pass" note, instills confidence in the changes.
5.  **Clean Code Structure:** The changes appear to be well-integrated into the existing `src/gadgets/parser.ts` and related files.

## Suggestions for Improvement

1.  **Documentation Update (Critical)**
    *   **User-facing Documentation:** The `README.md` or `docs/` directory **must** be updated to reflect that TOML is now the default parameter format. New examples for gadget invocation in prompts should use TOML. Without this, users will continue to struggle with YAML or be confused by the change.
    *   **Gadget Author Guidelines:** Any guidelines for writing new gadgets or their parameter descriptions should be updated to recommend or mandate TOML for examples, especially for parameters expecting multi-line content.
    *   **Prompt Engineering Guides:** If there are guides for crafting prompts for LLMs, they should be updated to instruct the LLM to output TOML for gadget parameters by default, using the triple-quote syntax for content.

2.  **Backward Compatibility Clarification (Minor)**
    *   While the `JSON → TOML → YAML` fallback is mentioned, it would be good to explicitly state in the PR description (or a follow-up) what the expected behavior is for *existing* prompts or LLM agents that might still generate YAML. The current explanation implies graceful handling, but an explicit statement would be reassuring. For example, "Existing YAML invocations will continue to work thanks to the fallback, but new prompts should be crafted to output TOML for optimal reliability."

3.  **Error Messaging for Parsing Failures (Consideration)**
    *   When an invocation fails to parse (e.g., malformed TOML, or even malformed YAML in the fallback), are the error messages sufficiently clear to guide the user (or the LLM) on how to correct the input? This might be out of scope for *this* PR, but it's a good future consideration.

4.  **Dependency Review (`js-toml`) (Informational)**
    *   Adding `js-toml` is necessary for the feature. It would be good to briefly note its size/security/maintenance status if not already part of standard review processes, just for completeness. (Assuming this is already handled by `bun` and standard project practices).

## Files to Review

*   `src/gadgets/parser.ts`: Main parsing logic, ensure TOML parsing is robust.
*   `src/core/prompt-config.ts`: How the default format is determined and exposed to prompts.
*   `src/cli/constants.ts`: Any constants related to parameter formats.
*   `src/gadgets/parser.test.ts`: Review the new TOML test cases for edge cases (empty strings, complex markdown, various data types).
*   `package.json`, `bun.lock`: Verify `js-toml` dependency.

## Conclusion

This PR represents a significant step forward in making gadget invocations more reliable and user-friendly, especially when dealing with markdown content. The solution is sound, and the implementation appears robust. Addressing the documentation updates is the most critical next step to ensure a smooth transition for users and developers.

Well done!
