Upgrade js-toml to 1.2.2 in the CLI and library, preserving the tested configuration
loading, validation, inheritance and prompt-template behavior. The parser now rejects
decimal integers exceeding 1000 digits, invalid UTC offsets and duplicate super-table
headers previously accepted by 1.1.2. Isolated regression tests bound malformed
multiline parsing and verify valid line continuation without risking a hung test runner.
