# Spec: Security: stop leaking internal error details in API responses (String(err)) (issue #8)

## Request
## Security: stop leaking internal error details in API responses (`String(err)`)

**Source:** Strix scan, recall run 516 (task 510), 2026-07-23. Reported as MEDIUM — Information Disclosure (CWE-209).

### Problem
Several API route `catch` blocks interpolate the raw error into the JSON response sent to the client via `String(err)`. This exposes internal implementation details (stack fragments, DB/Prisma messages, upstream error text) to anyone hitting the endpoint.

Known instances (non-exhaustive — grep for `String(err)` to find them all):
- `app/api/cards/[id]/share/route.ts` — `Could not share card: ${String(err)}` (500) and `Could not unshare card: ${String(err)}` (500)
- Card update route — `Could not update card: ${String(err)}` (500)
- URL import route — `Could not import URL: ${String(err)}` (500)
- Pocket import route — `Pocket import failed: ${String(err)}` (502/503)

### Acceptance criteria
- No API response body contains `String(err)` or otherwise echoes the raw caught error to the client.
- Each affected route returns a stable, generic client-facing message (e.g. `"Could not update card"`) with the appropriate status code.
- The real error is still observable server-side (`console.error`/logger) so debuggability is not lost.
- A grep for `String(err)` across `app/api/**` returns no results that flow into a response body.

### Out of scope / notes for the reviewer
- The Strix run's **HIGH** finding ("share-page data exfiltration via brute-forceable shareId") is a **false positive**: `shareId` is minted with `randomBytes(16).toString('hex')` (128-bit crypto-random via `node:crypto`) in `app/api/cards/[id]/share/route.ts`, so enumeration is infeasible. Do **not** change shareId generation.
- The `/share/[shareId]` page being unauthenticated is **by design** — that is the purpose of a public share link. No auth work here.
- Optional defense-in-depth only if trivial: rate-limiting on `/share/[shareId]`. Not required for this issue; skip if it adds meaningful complexity.


## Approved plan

🤖 **Proposed plan** (local model):



# PLAN

## Implementation Plan: Stop leaking internal error details in API responses

### Phase 1: Explore & catalog (information gathering only)

1. Find all `app/api/**/route.ts` files and identify every `String(err)` occurrence in response bodies.
2. Catalog all 9 custom error classes, their imports, and which routes use them.
3. Identify all per-item `failures.push` blocks and their current `instanceof` guards.

### Phase 2: Create the shared helper

4. Create **`lib/api-errors.ts`** with `apiError(message: string, err: unknown, status = 500)` — logs via `console.error`, returns `NextResponse.json({ error: message }, { status })`.

### Phase 3: Fix all catch blocks (bulk edit)

5. **`app/api/cards/[id]/share/route.ts`** — Replace `Could not share card: ${String(err)}` and `Could not unshare card: ${String(err)}` → `apiError('Could not share card', err, 500)` and `apiError('Could not unshare card', err, 500)`.

6. **`app/api/cards/[id]/route.ts`** — Update `internalError()` helper to use the log-then-generic pattern (or inline `apiError` at call sites).

7. **`app/api/import/pocket/route.ts`** — Fix outer catch → `apiError('Pocket import failed', err, status)`. Fix per-item `instanceof Error` → `instanceof PocketImportError`. Replace `String(err)` fallback with generic message.

8. **`app/api/import/social-bookmarks/route.ts`** — Same pattern: narrow `instanceof Error` → `instanceof SocialBookmarksImportError`.

9. **`app/api/import/bookmarks/route.ts`** — Narrow `instanceof Error` → `instanceof BookmarkImportError`.

10. **`app/api/import/image/route.ts`** — Narrow `instanceof Error` → `instanceof ImageVisionError`.

11. **`app/api/import/markdown/route.ts`** — Narrow `instanceof Error` → `instanceof MarkdownImportError`.

12. **`app/api/import/pdf/route.ts`** — Narrow `instanceof Error` → `instanceof PdfTextExtractionError`.

13. **`app/api/settings/ai/route.ts`** — Give message stem `"Could not save AI settings"`, wrap in `apiError`. Preserve `instanceof AiSettingsError` guard.

14. **`app/api/enrich/route.ts`** — Give message stem `"Enrichment failed"`, wrap in `apiError`.

15. **`app/api/chat/route.ts`** — Preserve `instanceof ChatRagError` guard, fall through to `apiError()` for other errors.

16. **`app/api/chat/attachments/extract/route.ts`** — Preserve `instanceof PdfTextExtractionError || instanceof ImageVisionError`, replace `String(err)` fallback → `apiError()`.

17. **`app/api/tts/sample/route.ts`** — Preserve `instanceof TtsError` guard, fall through to `apiError()`.

18. **All other `app/api/**/route.ts` files** with `String(err)` → apply same pattern (message stem + `apiError`).

### Phase 4: Test script & wiring

19. Create **`scripts/check-error-leak.ts`** — recursively greps `app/api/**/route.ts` for `String(err)` in response bodies; exits non-zero if any match.

20. Update **`package.json`** → `"test": "tsx scripts/check-xss-sanitization.ts && tsx scripts/check-error-leak.ts"`.

21. Run `grep -rn 'String(err)' app/api/` → expect zero.
22. Run `grep -rn 'instanceof Error' app/api/` → zero inside per-item `failures.push` blocks.
23. Run `npm test` → both scripts green.

### Constraints (noted, not acted upon)
- No changes to `shareId` generation.
- No auth changes on `/share/[shareId]`.
- No rate-limiting.
- No new dependencies.
- Status codes (500/502/503/400/404) preserved per route.
- Message stems preserved (only `: ${String(err)}` suffix removed).

_Apply `agent:approved` to have me implement this, or refine the issue and re-apply `agent:ready`._
