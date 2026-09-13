# Workflow bindings

Read the [canonical shared workflow](https://forgejo.tail6e035b.ts.net/matthewwagner/shared-workflows/src/branch/main/docs/AGENTIC-WORKFLOW.md), also available at `~/Projects/shared-workflows/docs/AGENTIC-WORKFLOW.md`.

- Default branch: `main`. Fetch and verify its ref before creating a worktree; preserve the current branch and existing worktrees.
- Canonical remote: `origin`, Forgejo `matthewwagner/recall`.
- Issue tracker: Beads. Read `docs/agents/issue-tracker.md`.
- Verification: npm test; npm run lint; npx tsc --noEmit; npm run build. Each must succeed before automated publication, even if native CI marks a check non-blocking.
- Durable documentation: README.md; docs/

Load the relevant Matt Pocock skill for the task. Apply `unslop` to authored prose and use `session-closeout` to finish. Preserve existing secret checks. Missing tools or unavailable verification are open gates, not successful checks.

Background coding remains opt-in. These bindings alone do not enable it or authorize pushes, PR changes, merges, or deployments. Follow the current user's publication authority. Historical specs under directories named for older skills retain their design evidence; they do not select the current workflow.
