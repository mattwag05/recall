# Workflow bindings

Follow the core loop at `~/.agents/core/LOOP.md` (source: [mw-plugins `core/`](https://forgejo.tail6e035b.ts.net/matthewwagner/mw-plugins/src/branch/main/core)), installed by `scripts/sync_skills.py`.

- Default branch: `main`. Fetch and verify its ref before creating a worktree; preserve the current branch and existing worktrees.
- Canonical remote: `origin`, Forgejo `matthewwagner/recall`.
- Issue tracker: Beads. Read `docs/agents/issue-tracker.md`.
- Verification: npm test; npm run lint; npx tsc --noEmit; npm run build. Each must succeed before automated publication, even if native CI marks a check non-blocking.
- Durable documentation: README.md; docs/

Read the core skill the task needs (`~/.agents/skills/<name>/SKILL.md`). Apply `unslop` to authored prose and use `closeout` to finish. Preserve existing secret checks. Missing tools or unavailable verification are open gates, not successful checks.

Background coding remains opt-in. These bindings alone do not enable it or authorize pushes, PR changes, merges, or deployments. Follow the current user's publication authority. Historical specs under directories named for older skills retain their design evidence; they do not select the current workflow.
