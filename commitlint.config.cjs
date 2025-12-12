module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "docs",
        "style",
        "refactor",
        "perf",
        "test",
        "build",
        "ci",
        "chore",
        "revert",
      ],
    ],
    "subject-case": [2, "never", ["upper-case"]],
    "header-max-length": [2, "always", 100],
    // Disable body-max-line-length to allow long commit bodies (e.g., merge commits)
    "body-max-line-length": [0],
  },
  ignores: [
    // Ignore merge commits which often have very long bodies
    (commit) => commit.includes("Merge pull request"),
    (commit) => commit.includes("Merge branch"),
    (commit) => commit.includes("chore: sync"),
  ],
};
