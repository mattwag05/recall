# Agentic development workflow

Use this process for coding with Claude, Codex, Pi, or Hermes. Read the project's canonical instructions and bindings first. They identify its tracker, default branch, canonical remote, verification commands, and documentation. This guide does not grant deployment, push, or PR authority.

## Start and understand

Inspect the branch, worktree, index, and existing changes. Preserve concurrent work. Where Beads exists, run `bd ready`, claim the issue with `bd update <id> --claim`, and track discovered work there. Otherwise use the project's declared tracker. Do not create a second tracker.

Load only the skill needed for the task. Use Matt Pocock's `grill-with-docs` when requirements need clarification, `to-spec` for substantial features, `to-tickets` for work that needs decomposition, and `diagnosing-bugs` for regressions. Small, clear changes do not need a separate specification or a planning ceremony.

Reproduce bugs through the affected behavior with safe fixtures or authorized data. Confirm the failure has the suspected cause before changing code. Search callers and shared code for the root cause. Do not use patient data or production mutations merely to reproduce a bug.

## Isolate and implement

Use the authorized worktree if one already exists. For feature work, create a task branch and worktree from an explicit, verified default-branch ref. Discover the branch instead of assuming `main`. Never reset or force-remove another session's work.

Search for existing helpers, types, and patterns before adding new ones. Use `tdd` for behavior changes with meaningful test seams. Prove that the relevant test fails before the fix and passes afterward. Avoid tests that merely repeat implementation details. Record unrelated discoveries as issues and continue the approved task.

## Verify

Review the actual diff for defects, redundant code, and unnecessary complexity. Use `code-review` for consequential changes. Run the project's relevant build, test, lint, and behavior checks. A successful command and its artifacts establish evidence; an agent's summary does not.

Apply `unslop` to authored documentation, comments, and final prose. Preserve exact commands and quoted evidence. Respect installed hooks. Never manufacture a completion flag, bypass a failed hook, or assume a Claude-only command exists in another tool.

Keep verification proportional to the change. A documentation correction needs accurate links and facts, not an unrelated full build. A user-facing behavior change needs evidence from the affected interface as well as suitable automated tests. Report unavailable checks explicitly.

## Reconcile and close

Run `session-closeout`. Update the records that own the changed behavior, including existing PRDs where applicable. Delete a temporary spec only after its decisions, deferred work, and acceptance evidence have a durable home. Do not create a PRD solely to satisfy this workflow.

Close issues after acceptance. Record unfinished work and its blocker in the declared tracker. Stage reviewed paths or hunks, preserve unrelated changes, run secret checks, and create coherent local commits under the active Git authority. Do not fabricate authorship or co-author trailers.

Discover the canonical push remote and inspect the entire outgoing range. Follow existing approval for Git pushes and PR actions. Dolt synchronization follows its separate policy. Never push a mirror directly or automatically merge a PR. Remove a worktree only after its work is preserved and its tree is clean, without `--force`.

Hand off the result, executed checks, remaining gates, commit and publication state, and next action. Update memories only when authorized, through each memory system's supported mechanism.

## Project bindings and optional automation

The project's canonical instruction file points here and to its own bindings. Bindings name the tracker and commands, default branch, canonical remote, verification commands, and documentation locations. Matt Pocock's `docs/agents/issue-tracker.md` records Beads as a custom tracker where used. Existing domain documents remain authoritative.

Triage roles are `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`, mapped to existing labels where appropriate. These labels classify work. They do not authorize publication. The separate `agent:*` labels belong to the opt-in background coding workflow.

Background coding uses the same process with deterministic approval and verification gates. It loads the recorded skills into its isolated Pi environment, defaults to local Qwen3.6, and offers Qwen3.8 only by explicit selection. Failed or missing gates produce no publication. Adopting this guide does not enable background jobs.
