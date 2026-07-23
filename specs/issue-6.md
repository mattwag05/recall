# Spec: Security: sanitize public share page (stored XSS) + add security headers (issue #6)

## Request
## Security: sanitize the public share page (stored XSS) + add security headers

Surfaced by the weekly Strix security scan on `main` (run #43 / task 426, 2026-07-20; report artifact `strix_runs/hostexecutor_55c2`). The scan flagged 4 issues; this issue scopes the two that are genuine bugs regardless of deployment model. See **Out of scope** below for the auth findings.

### In scope

**1. Stored XSS on the public share page (CVSS 8.1) — the priority.**
`app/share/[shareId]/page.tsx` renders user-controlled `notebookContent` / `body` via `dangerouslySetInnerHTML`, and `lib/markdown-render.ts` parses markdown **without sanitizing** HTML tags, event handlers, or `<script>`. A user can store crafted notebook content (via `/api/cards/:id/note` or `/api/cards/:id/regenerate`), share the card (`/api/cards/:id/share`), and the malicious HTML executes for anyone who opens the public share link. The share page is public **by design**, so this is exploitable even though recall is single-user.

**2. No security headers (CVSS n/a, cheap hardening).**
`next.config.ts` sets no security headers. Add at least: `Content-Security-Policy` (e.g. `default-src 'self'`; `script-src 'self'`; `style-src 'self' 'unsafe-inline'`; `img-src 'self' https: data:`; `frame-ancestors 'none'`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`. Tune CSP so the app still renders (Next.js may need `'unsafe-inline'` for styles).

### Acceptance criteria
- Markdown/HTML rendered on the share page is sanitized before `dangerouslySetInnerHTML` (e.g. `rehype-sanitize` in the markdown pipeline, or DOMPurify on the output). `<script>`, `on*=` handlers, and `javascript:` URLs must not survive into the DOM.
- Sanitization lives in `lib/markdown-render.ts` (or a shared helper) so any other consumer of rendered notebook HTML is covered too — not just the share page.
- Security headers added in `next.config.ts` (via `async headers()`), applied to all routes.
- A test proves malicious notebook content (e.g. `<img src=x onerror=alert(1)>`, `<script>…</script>`) is neutralized when rendered for the share page. Existing tests still pass.

### Out of scope (do NOT implement here)
- **Findings 1 & 4 — absence of authentication/authorization on the API and open data export.** The Strix report itself notes recall "assumes single-user, localhost-only deployment." Adding auth (NextAuth/JWT, a User/ownership schema) is a product-level decision, not a bug fix, and contradicts the current design. If multi-user/networked deployment is desired, that belongs in a separate PRD-scoped effort — flagging for PM review, not for this change.

### Reference
Strix run #43 (task 426) on recall `main`; full report in the job log / `strix_runs/hostexecutor_55c2`. Tech: Next.js 16.2, Prisma 7.8, SQLite.


## Approved plan

🤖 **Proposed plan** (local model):


The revision is small: one line to add to `next.config.ts`. Iris already specified the exact code shape for `lib/markdown-render.ts` and `next.config.ts` in her plan, and Matt's revision preserves the sanitizer exactly as-is — only the build config needs one addition.

---

**Fix:** In `next.config.ts`, add `'jsdom'` to the existing `serverExternalPackages` array.

```typescript
serverExternalPackages: ["better-sqlite3", "pdf-parse", "jsdom"],
```

**Files changed (1):**

- `next.config.ts` — add `'jsdom'` to `serverExternalPackages`. No other edits.

**Files unchanged (sanitizer as-is):**

- `lib/markdown-render.ts` — `getPurify()`, `sanitizeHtml()`, lazy-init with `typeof window` guard, allowlist, wrapping both `renderMarkdown`/`renderReader` — keep as implemented in PR #7.
- `next.config.ts` — security headers (`async headers()`) — keep as implemented in PR #7.
- `package.json` — `"test"` script + `dompurify` dep — keep as implemented in PR #7.
- `scripts/check-xss-sanitization.ts` — keep as implemented in PR #7.

**Steps:**

1. Edit `next.config.ts`: change `serverExternalPackages: ["better-sqlite3", "pdf-parse"]` → `serverExternalPackages: ["better-sqlite3", "pdf-parse", "jsdom"]`.
2. Verify nothing else changes (headers, sanitizer, test script untouched).
3. Run `tsx scripts/check-xss-sanitization.ts` — must still pass (sanitizer is code, not affected by `serverExternalPackages`).

**Why not the alternative (switch to `isomorphic-dompurify`)?** That's a bigger swap — new dep, potential behavioral differences in the sanitizer, risk of regressions in the existing test. The accepted fix is the minimal one: tell Next.js not to bundle `jsdom`.

_Apply `agent:approved` to have me implement this, or refine the issue and re-apply `agent:ready`._
