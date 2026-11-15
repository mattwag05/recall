# Agentic development workflow

This guide moved. The one coding workflow for Claude, Codex, Pi, and Hermes is the core in [mw-plugins `core/`](https://forgejo.tail6e035b.ts.net/matthewwagner/mw-plugins/src/branch/main/core):

- `core/LOOP.md`: the five-step loop (frame, ground, do, verify, close). `scripts/sync_skills.py` installs it as `~/.agents/core/LOOP.md`.
- `plugins/core/skills/`: the twelve core skills the loop names, installed into `~/.agents/skills/<name>/`.
- `core/references/beads.md`: Beads across clones, worktrees, and machines.

Each project's own instruction file and bindings name its tracker, default branch, canonical remote, and verification commands. Neither those bindings nor this pointer grant push, PR, merge, or deploy authority.

The opt-in background coding driver (`.forgejo/agent/driver.py`) feeds the reviewed copy of `LOOP.md` and the core skills recorded in the runner's skills manifest, not this file. See the shared-workflows [README](https://forgejo.tail6e035b.ts.net/matthewwagner/shared-workflows/src/branch/main/README.md).
