#!/usr/bin/env bash
# Background coding agent state machine — driven by Forgejo Actions issue labels.
# Runs on the CI host executor. Model = a local LLM served over an OpenAI-compatible API (zero API cost).
#
# States (labels). Human-applied labels are the ONLY triggers; bot sets marker labels.
#   agent:queued          (human) -> assess: CLARIFY -> agent:needs-input | PLAN -> agent:awaiting-approval
#   agent:ready           (human, after answering) -> re-assess -> PLAN -> agent:awaiting-approval
#   agent:approved        (human, after plan) -> implement -> push branch -> open PR -> agent:in-review
#   agent:error           (bot) -> pi/infra failure; recover by re-applying agent:ready
#   PR merged             -> agent:done + issue auto-closed via "Closes #N"
set -euo pipefail

: "${FORGEJO_TOKEN:?need FORGEJO_TOKEN}"
: "${LLM_KEY:?need LLM_KEY}"; : "${LLM_BASE:?need LLM_BASE}"
: "${PI_BIN:?need PI_BIN}"; : "${FORGEJO_API:?need FORGEJO_API}"
: "${GIT_SSH_HOST:?}"; : "${GIT_SSH_PORT:?}"
EVENT_NAME="${GITHUB_EVENT_NAME:?}"
EV="${GITHUB_EVENT_PATH:?}"

j() { jq -r "$1" "$EV"; }
OWNER="$(j '.repository.owner.login')"
REPO="$(j '.repository.name')"
DEFAULT_BRANCH="$(j '.repository.default_branch')"
R="$FORGEJO_API/repos/$OWNER/$REPO"

api() { curl -fsS -H "Authorization: token $FORGEJO_TOKEN" -H 'Content-Type: application/json' "$@"; }
comment() { api -X POST "$R/issues/$1/comments" -d "$(jq -n --arg b "$2" '{body:$b}')" >/dev/null; }

# Replace any agent:* label on the issue with $2, preserving other labels. $1=issue number.
set_state() {
  local issue="$1" new="$2" labels cur keep new_id final
  labels="$(api "$R/labels?limit=100")"
  cur="$(api "$R/issues/$issue/labels")"
  keep="$(echo "$cur" | jq '[.[] | select(.name|startswith("agent:")|not) | .id]')"
  new_id="$(echo "$labels" | jq --arg n "$new" 'map(select(.name==$n))[0].id // empty')"
  [ -n "$new_id" ] || { echo "::error::label '$new' does not exist in repo — create agent:* labels first"; return 1; }
  final="$(jq -c -n --argjson keep "$keep" --argjson add "$new_id" '{labels: ($keep + [$add])}')"
  api -X PUT "$R/issues/$issue/labels" -d "$final" >/dev/null
}

# Build the full issue thread (body + all comments) as plain-text context for pi.
thread() {
  local issue="$1"
  { echo "TITLE: $(j '.issue.title')"; echo; echo "BODY:"; j '.issue.body'; echo;
    api "$R/issues/$issue/comments" | jq -r '.[] | "--- comment by \(.user.login) ---\n\(.body)\n"'; }
}

# Write a stateless pi config into a throwaway HOME, then run pi -p. Mirrors a
# known-good ~/.pi/agent config, swapping in the local LLM endpoint + injected key.
run_pi() {  # $1 = prompt (workdir = cwd) ; prints pi output to stdout
  local pihome; pihome="$(mktemp -d)"
  mkdir -p "$pihome/.pi/agent"
  jq -n --arg base "$LLM_BASE" --arg key "$LLM_KEY" '{
    providers: { local: {
      baseUrl: $base, api: "openai-completions", apiKey: $key, authHeader: true,
      compat: { supportsDeveloperRole: false },
      models: [ { id: "Ornith-1.0-35B-4bit", name: "Ornith-1.0-35B-4bit",
                  reasoning: false, input: ["text"],
                  cost: {input:0,output:0,cacheRead:0,cacheWrite:0},
                  contextWindow: 131072, maxTokens: 64000 } ]
    } } }' > "$pihome/.pi/agent/models.json"
  printf '{"defaultProvider":"local","defaultModel":"Ornith-1.0-35B-4bit"}\n' > "$pihome/.pi/agent/settings.json"
  # ponytail: fixed 2x120s retry for transient local-LLM capacity errors (507 model-load /
  # 400 prefill-guard while another model is resident on the server; its TTL is 120s).
  # Upgrade path: probe $LLM_BASE/models before invoking if this proves noisy.
  local attempt
  for attempt in 1 2 3; do
    HOME="$pihome" "$PI_BIN" -p "$1" && return 0
    [ "$attempt" -lt 3 ] && echo "::warning::pi attempt $attempt failed; retrying in 120s" >&2 && sleep 120
  done
  return 1
}

# ---- PR merged: flip issue to done (issue itself auto-closes via "Closes #N") ----
if [ "$EVENT_NAME" = "pull_request" ]; then
  N="$(j '.pull_request.body' | grep -oiE 'closes #[0-9]+' | grep -oE '[0-9]+' | head -1 || true)"
  [ -n "${N:-}" ] && set_state "$N" "agent:done" || echo "no linked issue in PR body; nothing to do"
  exit 0
fi

# ---- issues:[labeled] ----
LABEL="$(j '.label.name')"
ISSUE="$(j '.issue.number')"
echo "event=$EVENT_NAME repo=$OWNER/$REPO issue=$ISSUE label=$LABEL"

case "$LABEL" in
  agent:queued|agent:ready)
    FORCE_PLAN=no; [ "$LABEL" = "agent:ready" ] && FORCE_PLAN=yes
    CTX="$(thread "$ISSUE")"
    PROMPT="You are a senior engineer triaging a coding task from an issue tracker for repo $OWNER/$REPO.
$CTX

Base your decision ONLY on the issue text above. Do NOT inspect the filesystem, and do NOT ask about repository clone/checkout paths — the repo will be checked out for you at implementation time.
Decide whether you have enough to implement this. Your reply must begin with a line that is exactly 'CLARIFY' or exactly 'PLAN', then content:
- 'CLARIFY' (only when genuinely blocked on the task itself): then a short markdown list of specific questions.
- 'PLAN' (clear enough): then a concise implementation plan (files to change, approach, ordered steps)."
    [ "$FORCE_PLAN" = yes ] && PROMPT="$PROMPT
The user has already answered prior questions in the thread above — do NOT ask for more clarification; respond with PLAN."
    OUT="$(run_pi "$PROMPT")" || { comment "$ISSUE" "🤖 pi run failed — see CI logs. Re-apply \`agent:ready\` to retry."; set_state "$ISSUE" "agent:error"; exit 1; }
    # Robust parse: the decision token is the first NON-EMPTY line (pi may emit leading blanks).
    DECISION="$(printf '%s\n' "$OUT" | grep -m1 -oE '^(CLARIFY|PLAN)' || true)"
    REST="$(printf '%s\n' "$OUT" | awk 'p{print} /^(CLARIFY|PLAN)/{p=1}')"
    [ -z "$DECISION" ] && { DECISION=PLAN; REST="$OUT"; }   # no token -> treat as plan (never loop on clarify)
    if [ "$DECISION" = "CLARIFY" ] && [ "$FORCE_PLAN" = no ]; then
      comment "$ISSUE" "🤖 **I need a bit more before I start:**

$REST

_Answer inline, then apply the \`agent:ready\` label to continue._"
      set_state "$ISSUE" "agent:needs-input"
    else
      comment "$ISSUE" "🤖 **Proposed plan** (local model):

$REST

_Apply \`agent:approved\` to have me implement this, or refine the issue and re-apply \`agent:ready\`._"
      set_state "$ISSUE" "agent:awaiting-approval"
    fi
    ;;

  agent:approved)
    CTX="$(thread "$ISSUE")"
    BRANCH="agent/issue-$ISSUE"
    # Committer is Matt (the email GitHub has verified) so the mirrored commit can show
    # Verified; authorship stays pi-agent via --author on the commit below.
    git config user.name "mattwag05"; git config user.email "wagnermatt@icloud.com"
    if [ -n "${AGENT_SIGNING_KEY:-}" ]; then
      mkdir -p "$HOME/.ssh"; chmod 700 "$HOME/.ssh"
      ( umask 077; printf '%s\n' "$AGENT_SIGNING_KEY" > "$HOME/.ssh/agent_signing" )
      git config gpg.format ssh
      git config user.signingkey "$HOME/.ssh/agent_signing"
      git config commit.gpgsign true
    fi
    git checkout -b "$BRANCH"
    # Snapshot the approved plan as the implementation contract (ships with the PR).
    SPEC="$(api "$R/issues/$ISSUE/comments" | jq -r '[.[] | select(.body|startswith("🤖 **Proposed plan**"))][-1].body // empty')"
    mkdir -p specs
    { echo "# Spec: $(j '.issue.title') (issue #$ISSUE)"; echo
      echo "## Request"; j '.issue.body'; echo
      echo "## Approved plan"; echo; echo "$SPEC"; } > "specs/issue-$ISSUE.md"
    PROMPT="Implement the approved task in this repository per the specification in specs/issue-$ISSUE.md, reproduced below — it is the contract; satisfy it exactly. Make the actual code changes directly to files in the working tree. Keep the change minimal and focused. Do not commit, and do not edit specs/.
$(cat "specs/issue-$ISSUE.md")

Full issue thread for reference:
$CTX"
    run_pi "$PROMPT" || { comment "$ISSUE" "🤖 pi run failed — see CI logs. Re-apply \`agent:ready\` to retry."; set_state "$ISSUE" "agent:error"; exit 1; }
    if [ -z "$(git status --porcelain -- ':!specs')" ]; then
      comment "$ISSUE" "🤖 I didn't produce any file changes. The task may be unclear — please add detail and re-apply \`agent:ready\`."
      set_state "$ISSUE" "agent:needs-input"; exit 0
    fi
    git add -A
    # Never commit env files or secrets (standing rule). Unstage env files, then scan the
    # staged diff for known secret values and abort if any leaked into the tree.
    git reset -q -- '.env' '*.env' '.env.*' '**/.env' 2>/dev/null || true
    if git diff --cached | grep -qF "$LLM_KEY" \
       || { [ -n "${FORGEJO_TOKEN:-}" ] && git diff --cached | grep -qF "$FORGEJO_TOKEN"; } \
       || { [ -n "${AGENT_SIGNING_KEY:-}" ] && git diff --cached | grep -qF "$AGENT_SIGNING_KEY"; }; then
      comment "$ISSUE" "🤖 Refusing to commit — a secret value appeared in the staged diff. Aborting."
      set_state "$ISSUE" "agent:error"; exit 1
    fi
    if git diff --cached --quiet -- ':!specs'; then
      comment "$ISSUE" "🤖 Only ignored/secret files changed — nothing safe to commit. Please clarify the task."
      set_state "$ISSUE" "agent:needs-input"; exit 0
    fi
    git commit --author "pi-agent <pi-agent@noreply.local>" -m "agent: $(j '.issue.title') (closes #$ISSUE)"
    export GIT_SSH_COMMAND="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8"
    git remote set-url --push origin "ssh://git@$GIT_SSH_HOST:$GIT_SSH_PORT/$OWNER/$REPO.git"
    # Branch is agent-owned and a re-label regenerates it from scratch — replace the
    # remote attempt (lease ref exists via agent.yml's fetch-depth: 0 full fetch).
    git push --force-with-lease --set-upstream origin "$BRANCH"
    # Reuse an already-open PR for this branch (re-runs); create only if absent —
    # an unconditional POST 409s under set -e when the PR already exists.
    PR_URL="$(api "$R/pulls?state=open&limit=50" \
      | jq -r --arg h "$BRANCH" '[.[] | select(.head.ref==$h)][0].html_url // empty')"
    if [ -z "$PR_URL" ]; then
      PR="$(api -X POST "$R/pulls" -d "$(jq -n \
        --arg t "agent: $(j '.issue.title')" \
        --arg h "$BRANCH" --arg b "$DEFAULT_BRANCH" \
        --arg body "Implements #$ISSUE.

Closes #$ISSUE" '{title:$t, head:$h, base:$b, body:$body}')")"
      PR_URL="$(echo "$PR" | jq -r '.html_url')"
    fi
    comment "$ISSUE" "🤖 Opened PR: $PR_URL"
    set_state "$ISSUE" "agent:in-review"
    ;;

  agent:needs-input|agent:awaiting-approval|agent:in-review|agent:done|agent:error)
    echo "marker label '$LABEL' — no action (set by bot)"; ;;
  *)
    echo "unrecognized agent label '$LABEL' — ignoring"; ;;
esac
