# Spec: Add .editorconfig for consistent editor defaults (issue #4)

## Request
Add a root .editorconfig: 2-space indentation for ts/tsx/js/json/yml, final newline, utf-8, lf line endings. Keep it minimal — no other tooling changes.

(Smoke test of the agent pipeline after the CI vars refactor.)

## Approved plan

🤖 **Proposed plan** (local model):


Create a root `.editorconfig` file with the following content:

```ini
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
insert_final_newline = true

[*.{ts,tsx,js,json,yml}]
indent_size = 2
```

**Approach:**
- Single file: `.editorconfig` at the repository root
- `root = true` so it's picked up as the project-level config
- Universal rules (indent, line ending, charset, final newline) under `[*]`
- Language-specific override section `[*.{ts,tsx,js,json,yml}]` re-clares `indent_size = 2` explicitly (matching the issue wording)
- No changes to any other files, configs, CI, or tooling — just the one file

**Steps:**
1. Write `/matthewwagner/recall/.editorconfig` with the above content
2. Done — no other files touched

_Apply `agent:approved` to have me implement this, or refine the issue and re-apply `agent:ready`._
