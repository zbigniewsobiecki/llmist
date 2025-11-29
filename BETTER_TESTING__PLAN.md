# Plan for Improving Testing Infrastructure

This document outlines a plan to enhance the existing testing infrastructure, building upon current strengths and addressing potential areas for improvement. The goal is to ensure robust, maintainable, and efficient testing across the codebase.

## Current Strengths

The current testing infrastructure demonstrates several strong aspects, as observed from `docs/TESTING.md` and `src/e2e/gadgets-multi-iteration.e2e.test.ts`:

1.  **Comprehensive LLM Mocking:** The `llmist/testing` module provides a powerful and flexible `mockLLM` API. This allows for detailed mocking of LLM responses, including model/provider matching, message content matching, dynamic responses, and sequenced gadget calls. This is crucial for fast, deterministic, and cost-free unit and integration tests.
2.  **Dedicated Gadget Testing Utilities:** Utilities like `testGadget`, `testGadgetBatch`, `createMockGadget`, and `mockGadget` enable isolated and thorough testing of individual gadgets, including schema validation, default parameter application, error simulation, and call tracking.
3.  **Well-Structured E2E Tests:** The `src/e2e` directory, particularly files like `gadgets-multi-iteration.e2e.test.ts`, showcases a good pattern for end-to-end tests. These tests cover complex, multi-turn agent behaviors, state management, human-in-the-loop interactions, error handling, and parallel gadget execution using mocks. The use of `beforeEach`/`afterEach` for setup and teardown, and descriptive test names, contributes to maintainability.
4.  **Reusable Test Helpers:** The use of `clearAllMocks`, `createMockE2EClient`, `setupExtendedE2ERegistry`, `MockHumanInputProvider`, and custom state management classes (`TestStateManager`, `ConditionalGadget`, `DataAccumulatorGadget`, `StateTrackerGadget`) in e2e tests promotes code reuse and clarity, reducing boilerplate in individual test cases.
5.  **Integration Test Control:** The `RUN_INTEGRATION` environment variable provides a clear mechanism to conditionally execute real API tests, preventing unnecessary costs and slowdowns during typical development cycles.
6.  **Event-Driven Assertions:** The `collectAllEvents` and `filterEventsByType` functions in e2e tests are valuable for asserting on the internal flow and events of the agent, providing deep visibility into its execution stages.

## Areas for Improvement and Action Plan

### 1. Granularity and Categorization of Test Suites

**Goal:** Ensure appropriate testing levels (unit, integration, e2e) for all components to improve isolation and debugging efficiency.

**Action Plan:**
*   **Unit Tests for Core Logic:** Introduce dedicated unit test directories for core modules (`src/agent`, `src/core`, `src/providers`, etc.) to test individual functions, classes, and small components in isolation. This will help pinpoint issues faster and provide more specific feedback on code changes.
*   **Gadget Unit Tests:** Explicitly create `src/gadgets/__tests__/` directories for each gadget. Leverage the existing `testGadget`, `testGadgetBatch`, and `mockGadget` utilities for comprehensive, isolated gadget testing, covering schema validation, default values, and various execution scenarios.
*   **Refine Integration Tests:** Further delineate between "mocked integration tests" (which the current e2e tests largely are) and "real integration tests" (using actual LLM APIs). Consider moving real API-dependent tests to their own `src/integration` directory. Ensure real integration tests are clearly marked and are run only when `RUN_INTEGRATION` is true, or similar mechanisms, to manage costs and execution time.
*   **Regression Tests:** For critical functionalities and bug fixes, establish a practice of adding regression tests to prevent re-introduction of past issues. These should ideally be integrated into the relevant unit or e2e test suites.

### 2. Enhanced Test Data Management

**Goal:** Improve the creation and management of test data for more thorough and realistic testing scenarios.

**Action Plan:**
*   **Expand Parameterized Testing:** Identify more areas where a function or gadget needs to be tested with a range of inputs (e.g., different numbers, string variations, edge cases like empty strings or large numbers). Utilize `testGadgetBatch` or similar patterns more extensively to reduce repetition.
*   **Structured Test Fixtures:** Review and expand the use of `src/e2e/fixtures.ts` (and similar files for other test types) to centralize common test data, complex mock objects, and reusable test scenarios. This promotes consistency and reduces magic values in tests.
*   **Data Generation:** For tests involving large payloads, diverse message histories, or complex object structures (e.g., simulating long conversations), explore using data generation libraries (e.g., Faker.js, or custom factories) to create realistic and varied test inputs efficiently.

### 3. Test Performance and Efficiency

**Goal:** Optimize test execution time and reduce boilerplate within test files.

**Action Plan:**
*   **Abstract Common Mock Setups:** The `mockLLM().forModel(...).forProvider(...)` pattern is frequently used in e2e tests. Create helper functions or a `TestClientFactory` in `src/e2e/mock-setup.ts` to abstract these common mock registrations, making tests more concise and readable.
*   **Monitor Test Execution Time:** Integrate a tool or process to monitor test suite execution time. Focus on optimizing slow tests, especially in real integration suites, by reducing redundant operations or improving mocking strategies.
*   **Leverage Parallelization:** Ensure that tests within `bun:test` suites are independent and can run in parallel without race conditions or shared state issues, maximizing the benefits of multi-core environments. Review existing tests for any implicit state sharing that might hinder parallel execution.

### 4. Comprehensive Error Handling and Edge Case Coverage

**Goal:** Systematically test how the system behaves under various error conditions and less common scenarios.

**Action Plan:**
*   **API Error Simulation:** Extend `mockLLM` capabilities or create specific mock utilities to simulate common API errors (e.g., rate limits, authentication failures, network issues, malformed responses from LLMs). This ensures the agent gracefully handles external service issues.
*   **Gadget Timeouts and Failures:** Ensure robust testing for gadget timeouts, internal gadget errors, and unexpected return formats from gadgets. The existing error handling test is a good foundation, but more specific scenarios (e.g., gadget returning `null`, empty string, or non-schema-compliant results) can be added.
*   **Agent Resilience:** Test agent behavior when facing unexpected prompts, empty responses from LLMs, or sequences of errors from multiple gadgets. This includes scenarios where an agent is expected to recover or report failure appropriately.
*   **Input Validation Edge Cases:** Beyond schema validation, explicitly test how the system handles malformed or boundary-case input to the agent or gadgets (e.g., very long strings, special characters, unexpected data types at runtime).

### 5. Test Maintainability and Readability

**Goal:** Ensure tests are easy to understand, write, and maintain over time.

**Action Plan:**
*   **Consistent Naming Conventions:** Continue to enforce clear and descriptive naming for test files, `describe` blocks, and `it` assertions. Names should convey the specific behavior being tested.
*   **Contextual Comments:** Add comments to explain complex mocking logic, multi-iteration flow, or specific test scenarios that might not be immediately obvious to someone new to the codebase or reviewing the test.
*   **Refactor Complex Test Files:** If test files become excessively long or contain highly repetitive logic, identify opportunities to refactor them into smaller, more focused files or abstract common patterns into helper functions. Consider using nested `describe` blocks to logically group related tests.

### 6. CI/CD Integration and Quality Gates

**Goal:** Embed testing more deeply into the development pipeline to maintain high code quality and accelerate feedback.

**Action Plan:**
*   **Coverage Thresholds:** Configure minimum code coverage thresholds in `codecov.yml` and enforce them in CI to prevent regressions in test coverage. Regularly review coverage reports to identify untested critical paths or modules.
*   **Automated Linting for Tests:** Ensure `biome.json` (or similar tools) covers test files to enforce coding standards and catch potential issues early, just as it does for production code.
*   **Test Matrix Expansion:** If applicable, consider expanding the CI test matrix to include different runtime environments (e.g., Node.js versions if cross-compatibility is a concern) or different major versions of LLM provider SDKs (if the project needs to support multiple).

By systematically addressing these areas, the testing infrastructure will become even more robust, reliable, and a valuable asset for future development and maintenance, ensuring high quality and confidence in changes.
