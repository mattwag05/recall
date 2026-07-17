# Recall

> A personal, **local-first AI knowledge base**. Save an article or a note; Recall
> extracts the readable text, writes a structured summary, tags it, and files it
> into a searchable library — all on a **local model** on your Mac. A
> reverse-engineered, self-hosted take on [app.recall.it](https://www.recall.it),
> wrapped as a native desktop app with [Pake](https://github.com/tw93/Pake).

Built as a compact **product OS** for local knowledge work: left-side
navigation, command search, dense library feed, right-side insight rail, quiet
graphite surfaces, and a cobalt action color.

---

## Status

**Phase 1 (MVP) — complete.** Capture (article URL + note) → local-LLM enrichment
(summary, notebook, tags) → library → card detail (Notebook + Reader) →
Markdown export. See the [Roadmap](#roadmap) for what's next and the
[CHANGELOG](./CHANGELOG.md) for what shipped.

---

## What it does (today)

- **Capture** — paste an article or supported media-page URL (readable text via
  Mozilla Readability when available, YouTube caption transcripts when exposed,
  optional local Apple Podcasts transcription when configured, otherwise media source metadata and thumbnails for
  YouTube/Vimeo/TikTok/Spotify/Apple Podcasts/SoundCloud/Bandcamp),
  import Wikipedia topics as local Reader cards, write a note, import up to 10
  PDFs with selectable text or scanned-page OCR, import one browser bookmarks
  HTML export, one Pocket CSV export, one Social Bookmarks Triage JSON export,
  or up to 10 Markdown files, or save up to
  10 local PNG/JPG/WebP images with OCR/vision in a responsive
  dialog-labeled Add modal, with explicitly named Article URL, Note title, Note
  body, Wiki topic search, PDF chooser, browser bookmarks chooser, Markdown
  chooser, Pocket CSV chooser, Social Bookmarks JSON chooser, and Image chooser fields, a default `Concise
  summary` action selector, live Wiki search/results,
  PDF/browser-bookmarks/Pocket/Social Bookmarks/Markdown/Image drag/drop and file selection with
  per-file failures,
  accessible source tabs with
  arrow/Home/End keyboard navigation, normalized duplicate URL detection,
  readable-page/media-metadata guidance, actionable missing/malformed/non-http/
  private URL errors, structured URL/Note API failure guidance, malformed
  success-response handling for IDs, statuses, and optional URL metadata, retry
  recovery, clear saved/processing/failed feedback, and failed URL cards kept
  retryable until reader text or media metadata is actually extracted.
- **Understand** — a configured local or OpenAI-compatible model (a local OpenAI-compatible server or Ollama by
  default, with Settings presets for LM Studio, OpenRouter, and custom
  endpoints) generates a 1-line summary, a structured **Notebook** (TL;DR + key
  points), and hierarchical **tags**. If Notebook generation fails but fallback summarization
  succeeds, the card is marked ready instead of polling forever; if the local
  model is too slow or returns malformed/empty structured output, Recall falls
  back to deterministic local keyword tags and an extracted-text Notebook so
  imports do not stay untagged or stuck. If both summary paths fail but Reader
  content exists, the card still becomes readable/ready with a short excerpt
  summary. Stored image/semantic tag JSON is filtered to string values
  before enrichment, indexing, card rendering, or export, and stored entity JSON
  must be object-shaped before it is used as model context.
- **Library** — index-card catalog grouped by updated date, with a collapsible
  hierarchical tag-tree sidebar with tag filtering, A-Z ordering, expandable/
  collapsible branches, local tag multi-select/clear-selection controls, mobile
  tag chips, parent filters that include child-tag cards, Updated/Created sort,
  keyboard-navigable Grid/List view radio controls, local selected-card controls
  with disabled batch Export/Delete placeholders that announce their planned
  purpose, live URL/media-page/Wikipedia/note/PDF/Image quick-create
  tiles, source thumbnails
  and read-only Shared badges when available, accessible media links that announce the target card, and exact-text
  search across title, Notebook, Reader text, summaries, quiz prompts/answers,
  manual/hierarchical tags, string-only
  semantic/image tag terms, and object-shaped entity values. Above-the-fold
  thumbnails load eagerly while the rest stay lazy. The dialog-labeled Search has
  an explicitly named query field and can
  filter by Notebook/Reader/Quiz
  surface, updated-date window, and active tag scope; its Text/AI mode selector
  is exposed as keyboard-navigable tabs, active-tag scope choices are exposed as
  keyboard-navigable radio controls, and it keeps a clearable local recent-search
  list that preserves distinct filter combinations. Primary route aliases and planned Review
  destinations are wired; the keyboard-navigable header profile menu exposes observed
  Settings and More sections with non-live Help/Feedback placeholders, and the
  global Chat route now has keyboard-navigable selectable tag/card context,
  semantic all-knowledge expansion, prompt sending, cited responses, and
  recent-thread resume plus temporary readable-file uploads for text, Markdown,
  CSV, JSON, code, extractable PDF context, and PNG/JPG/WebP image OCR/vision.
  Saved PDF capture creates local document cards from selectable text or
  scanned-page OCR, and saved image capture creates local media cards backed by
  gitignored `public/media/` files.
  The active frontend uses a product-OS shell with persistent navigation,
  command search, compact quick-capture tiles, list-first card rows, and a
  right-side insight rail for local status, related tags, review due, and recent
  cards. Card/tag API failures return structured errors and show retryable local-app
  feedback in the library banner instead of a false empty shelf state; tag tree
  load failures preserve stale card/tag state when possible and expose a
  `Retry tags` action; stale tag filters return `Tag not found` instead of empty
  results, and malformed successful card/tag payloads are also treated as
  retryable load problems, so the app shell matches the reverse-engineered Recall
  navigation.
- **Search reliability** — exact-text search failures show an actionable local-app
  or structured API error instead of stale results, and malformed search payloads
  or unsupported filter parameters stay in the modal with retry guidance; FTS
  index/database failures no longer masquerade as empty searches. The AI tab now
  runs Phase 2 semantic search over local full-card embeddings, with date/tag
  filters applied before ranking and Text-mode surface filters kept honest as
  exact-text-only controls. Card detail uses the same local embeddings to rank
  related cards on demand in the Connections and Graph tabs.
- **Card** — keyboard-navigable six-tab detail (Notebook editable, Reader live;
  Chat now answers from cited current-card/local semantic context; Quiz can
  generate local short-answer and multiple-choice active-recall questions, save
  custom short-answer questions, edit or delete generated/manual questions, run self-graded card quiz sessions,
  run timed and matching card quiz sessions, and advance local due/stage metadata for the current card; Connections/Graph show live
  semantic related-card previews, saved manual card links, generated local entity links,
  inbound backlinks, return-link actions, automatic local connection generation
  during enrichment, bounded graph traversal, local graph depth/filter/fit/fullscreen controls, and visible edge rendering with a readable legend),
  editable title,
  keyboard-navigable overflow action menu with created/updated timestamps,
  hydration-safe local Notebook/Reader text-size controls, safe clickable Notebook links, heading-based Notebook
  contents, confirmed Notebook regeneration so user edits are not overwritten by
  accident, honest title/Notebook/tag/regenerate/retry/delete mutation feedback
  backed by structured action API errors, `{ ok: true }` success confirmation,
  explicitly named tag editor input, duplicate-submit guards for tag edits,
  missing-card checks before idempotent tag unlink, route/database failure checks
  for tag removal, and processing-state recovery, malformed semantic-tag shape
  tolerance, long-title wrapping across library/search/detail surfaces, local
  card-link copy with clipboard failure feedback, read-only Private/Shared status,
  disabled Images/Share placeholders with image-gallery and local-sharing boundary
  names/tooltips, Reader/Notebook copy plus live non-destructive Reader
  reformat into local Markdown, phase-honest Chat/Quiz/Connections/Graph control panels
  backed by local cited card chat, related-card ranking, local quiz generation,
  custom short-answer questions, editable question management, self-graded card quiz sessions,
  saved PDF/image capture with local OCR/vision, manual card links, generated
  entity links, backlinks, local graph edge rendering, temporary
  readable-file/PDF/image chat uploads, and any existing local counts/links/questions, with
  disabled future-phase actions exposing specific names/tooltips instead of generic controls, clean Markdown export,
  delete. Ready cards without generated summaries, including title-only notes,
  use neutral empty-state copy instead of implying background summarization is
  still running.
- **Resilience** — missing or deleted direct card URLs show a clear library return
  state, while transient card-load failures parse structured detail API errors
  and show a retry action instead of lingering on an opening/loading message.
- **Export** — download the full library or a single tag subtree as one Markdown
  file from a responsive Settings control with local success/failure feedback;
  tag filter loading has explicit failure/retry guidance that preserves existing
  tag choices instead of dropping to an empty filter list, and card detail exports
  the current card through the same in-app feedback loop. Export routes return
  structured errors for failed downloads or stale tag filters, and the legacy
  JSON/CSV/ZIP endpoint validates requested formats before exporting. Direct
  tag-scoped downloads include the tag slug in the filename, and malformed stored
  AI JSON does not sink the full JSON/ZIP export or card Markdown tag rendering;
  exported semantic tags are string-only. Markdown includes metadata, tags,
  summary, Notebook, notes, Reader, and any existing local connections or quiz
  questions.
- **Settings** — observed Account, Appearance, Preferences, Quiz, TTS, and Help
  categories are represented with local-first controls; Appearance can set the
  local Notebook/Reader reading size through keyboard-navigable radio choices,
  Quiz can set browser-local daily review goal and review session size through
  keyboard-navigable radio choices, theme/toggle controls expose their named
  radio and switch state semantically, and Settings action buttons keep
  setting-specific accessible names while re-enrichment reports local model/API
  failures or malformed pipeline results clearly. Unsupported cloud
  subscription/email, theme switching, translation/search-language preferences,
  browser extension setup, Quiz notification preferences for spaced repetition,
  streaks, and challenges, TTS language/voice/playback,
  Help/Feedback links, and
  account deletion stay disabled with planned-purpose labels/tooltips until their
  backend phases exist. On mobile, Settings uses the shared `rr-safe-bottom`
  safe-area utility so iPhone Safari's floating toolbar does not cover the final
  controls.
- **Review** — `/spaced-repetition` mirrors the observed keyboard-navigable
  Review/Questions tabs with due-now/weekly counts, browser-local daily goal and
  review session limit, live local Start Review short-answer and multiple-choice due queue, activity
  and accuracy no-data states, memory-stage progress, and per-card question
  groups backed by local `QuizQuestion` rows.
- **Private by design** — runs locally or behind your Tailnet; no cloud model calls,
  no API costs.

## Architecture

Recall is a **fork-and-extend** of the *Social Bookmarks Triage* engine (Next.js +
Prisma/SQLite + an enrichment pipeline), with a **bespoke frontend** built for
Recall and the LLM repointed from cloud OpenRouter to a **local model**.

```
Save URL ──► Readability extract ──► Card (readerContent)
                                       │
                                       ├─► entity + semantic tags  ┐
                                       ├─► hierarchical categories  ├─ local LLM (OpenAI-compatible)
                                       ├─► 1-line summary           │
                                       └─► Notebook (markdown)      ┘
                                       │
SQLite (Prisma) ◄──────────────────────┘
   │  FTS5 full-text search
   ▼
Recall product UI (Next.js) ──►  Pake (Tauri) ──► Recall.app
```

- **Internal model names** stay `Bookmark`/`Category` (the forked engine); the UI
  presents them as **Card**/**Tag**. Recall fields were added in place
  (`title`, `provider`, `notebookContent`, `status`, hierarchical `parentId`,
  plus `Connection`/`QuizQuestion`/`ChatThread` for later phases).

## Stack

- **Next.js 16** (App Router, Turbopack) · React 19 · TypeScript · Tailwind v4
- **Prisma 7** + better-sqlite3 · **FTS5** full-text search · local embeddings
- **OpenAI SDK** pointed at a local OpenAI-compatible server
- **@mozilla/readability** + jsdom (article extraction)
- **Geist / Geist Mono** via `next/font`
- **Pake** (Rust/Tauri) for the desktop wrapper

## Run it (local)

Prereqs: a local LLM server. Default is a **local OpenAI-compatible server** at `http://localhost:8000/v1`;
fallback is **Ollama** at `http://127.0.0.1:11434/v1`.

```bash
npm install
npx prisma generate
npx prisma db push
npm run db:seed        # seed general categories
npm run dev            # http://localhost:3000
```

Browser QA can use `http://127.0.0.1:3000` when `localhost` is unavailable; the
Next dev config explicitly allows that origin so dev resources and HMR do not
trigger a framework overlay.

Save a URL from the **＋ Add** dialog, then enrichment runs automatically. Keyboard:
`/` search, `n` add; shortcuts only fire from the passive page surface, not while
focus is inside links, buttons, selects, or editable fields.

### LLM backend

Configured via `.env` (see `.env` in the repo root):

| Variable | Default | Notes |
|---|---|---|
| `LLM_PROVIDER` | `omlx` | `omlx`, `ollama`, `lmstudio`, `openrouter`, or `custom`; Settings can override this locally |
| `LLM_BASE_URL` | provider default | Generic OpenAI-compatible chat endpoint override |
| `LLM_MODEL` | provider default | Generic chat model override |
| `LLM_API_KEY` | provider/env default | Generic API key override for remote endpoints |
| `OMLX_BASE_URL` | `http://localhost:8000/v1` | Local OpenAI-compatible endpoint |
| `OMLX_API_KEY` | — | API key for the local server, if it requires one |
| `OMLX_MODEL` | `Qwen3.6-35B-A3B-4bit` | |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434/v1` | fallback |
| `OLLAMA_MODEL` | `gemma4:latest` | The deploy compose defaults to `functiongemma:270m-it-fp16`; override when a larger local chat model is installed |
| `VISION_MODEL` | provider chat model | Optional local vision-capable chat model for image OCR/vision attachments |
| `LLM_REQUEST_TIMEOUT_MS` | `30000` | Per-request chat/vision timeout, clamped to 5s-300s; slow/failing enrichment falls back locally |
| `EMBEDDING_BASE_URL` | `OLLAMA_BASE_URL` | OpenAI-compatible embedding endpoint |
| `EMBEDDING_MODEL` | `nomic-embed-text:v1.5` | Phase 2 semantic search embeddings; the deploy compose defaults to `nomic-embed-text-v2-moe:latest` |
| `EMBEDDING_API_KEY` | chat API key / `ollama` | Optional separate key for remote embedding providers |
| `TRANSCRIPTION_BASE_URL` | — | Optional local OpenAI-compatible `/audio/transcriptions` endpoint for Apple Podcasts retry/import transcription; the deploy compose defaults to `http://sherpa-onnx:9001/v1` |
| `TRANSCRIPTION_MODEL` | `whisper-1` | Model name sent to the transcription endpoint; the deploy compose defaults to `sense-voice` |
| `TRANSCRIPTION_MAX_AUDIO_MB` | `100` | Safety cap for fetched podcast audio before transcription |
| `TTS_BASE_URL` | `http://127.0.0.1:8880/v1` | Local Kokoro (OpenAI-compatible) `/audio/speech` endpoint for card audio summaries; the deploy compose defaults to `http://host.docker.internal:8880/v1` |
| `TTS_MODEL` | `kokoro` | Model name sent to the TTS endpoint |
| `TTS_VOICE` | `af_heart` | Kokoro voice for synthesized summaries |

> Both models "think". Recall disables it per-provider so JSON/structured stages
> stay clean: local server → `chat_template_kwargs.enable_thinking=false`; Ollama →
> `reasoning_effort="none"`. Run one large local LLM at a time —
> `Qwen3.6-35B` can sit right at the local server's memory ceiling.

Settings → Intelligence → Model endpoint exposes polished provider presets for
Ollama, LM Studio, a local OpenAI-compatible server, OpenRouter, and any custom OpenAI-compatible endpoint.
API keys are write-only in the browser UI; leaving the key field blank preserves
the saved/env key, while Clear removes the locally saved key. Chat and embedding
endpoints can be tested separately before running enrichment.

### Package as a desktop app (Pake)

```bash
npm i -g pake-cli
pake http://localhost:3000 --name Recall --width 1400 --height 900 --hide-title-bar
```

The Pake shell loads the local server at runtime, so keep `npm run dev`
(or `npm run build && npm start`) running. The built `Recall.app` is ~9 MB.

> **Known Pake quirk:** the final `.dmg` packaging step (`bundle_dmg.sh`) often
> fails on macOS — harmless. The signed `Recall.app` is already built under
> `…/pake-cli/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Recall.app`;
> copy it to `/Applications`. (A copy is also placed in `dist-app/`, which is gitignored.)

### Self-hosted deployment (Docker)

Recall can run as its own Docker Compose service on a home server:

```bash
docker compose -f docker-compose.deploy.yml up -d --build
```

- The app listens on host port `3011` (port `3000` inside the container). Put it
  behind your reverse proxy of choice (e.g. Caddy `reverse_proxy 127.0.0.1:3011`)
  for HTTPS.
- Persistent SQLite data and uploaded image/media files are bind-mounted
  volumes — adjust the host paths in the compose file to your storage layout.
- On start, `scripts/start-production.sh` initializes the Prisma schema only
  when `/data/recall.db` is missing or lacks the `Bookmark` table, then serves
  the standalone Next.js build on port `3000` inside the container. Initialized
  production DBs skip automatic `db push` so Prisma does not try to mutate the
  raw FTS5 tables managed by `lib/fts.ts`.
- Default model endpoints target `host.docker.internal:11434` (host-local
  Ollama); the compose defaults assume small locally-installed models
  (`functiongemma:270m-it-fp16` for chat, `nomic-embed-text-v2-moe:latest` for
  embeddings). Override `LLM_PROVIDER`, `OLLAMA_MODEL`, `OLLAMA_BASE_URL`,
  `EMBEDDING_MODEL`, `EMBEDDING_BASE_URL`, `TRANSCRIPTION_BASE_URL`, or the
  local-server variables in the deploy environment when using a different local
  model host.
- If the host runs a firewall (e.g. UFW), allow the Docker bridge network to
  reach host-local services (Ollama on `tcp/11434`, Kokoro TTS on `tcp/8880`).
  If chat/enrichment time out from the UI while host-side
  `curl 127.0.0.1:11434` works, check these rules before changing app code.
- Apple Podcasts transcription can use an existing `sherpa-onnx` service over
  the Docker network `sherpa-onnx_default`; keep that service healthy before
  retrying metadata-only podcast cards.

## API

| Endpoint | Method | Purpose |
|---|---|---|
| `/` / `/items` | GET | Library UI |
| `/item/:id` | GET | Card detail UI |
| `/chat` | GET | Global local-RAG chat with selectable tag/card context |
| `/spaced-repetition` | GET | Review dashboard with a local due-question queue and card-group quiz entry points |
| `/settings` | GET | Settings UI |
| `/api/import/url` | POST | Save an article/media URL → extract reader text, Apple Podcasts transcripts when configured, or media metadata |
| `/api/import/wiki` | GET/POST | Search and import Wikipedia topics as local Reader cards |
| `/api/import/bookmarks` | POST | Save one browser bookmarks HTML export as local URL cards |
| `/api/import/pocket` | POST | Save one Pocket CSV export as local URL cards |
| `/api/import/social-bookmarks` | POST | Save one Social Bookmarks Triage JSON export as local social cards |
| `/api/import/pdf` | POST | Save up to 10 PDFs as local document cards, using selectable text or local OCR for scanned PDFs |
| `/api/import/markdown` | POST | Save up to 10 Markdown files as local document cards |
| `/api/import/image` | POST | Save up to 10 local PNG/JPG/WebP images as media cards with OCR/vision text |
| `/api/chat` | POST | Answer from local card/tag/global context with citations |
| `/api/chat/attachments/extract` | POST | Extract bounded temporary PDF text or image OCR/vision context for chat uploads |
| `/api/settings/ai` | GET/PATCH/POST | Read/save/test local OpenAI-compatible provider, model, key, timeout, and embedding endpoint settings |
| `/api/cards/note` | POST | Create a note card |
| `/api/cards` | GET | List cards (`?query=`, `?tag=`; tag filters include descendants) |
| `/api/cards/:id` | GET/PATCH/DELETE | Card detail / edit / delete |
| `/api/cards/:id/connections` | POST/DELETE | Save or remove a manual card-to-card link |
| `/api/cards/:id/connections/generate` | POST | Generate local entity links for a card |
| `/api/cards/:id/questions` | POST | Create a custom short-answer quiz question for a card |
| `/api/cards/:id/questions/:questionId` | PATCH/DELETE | Edit or delete a quiz question for a card |
| `/api/cards/:id/questions/generate` | POST | Generate local active-recall questions for a card |
| `/api/cards/:id/questions/:questionId/review` | POST | Record a self-graded quiz answer and update local due/stage metadata |
| `/api/cards/:id/graph` | GET | Traverse local card/entity links (`?depth=1..3`) |
| `/api/cards/:id/related` | GET | Rank local semantic related cards |
| `/api/cards/:id/reader/reformat` | POST | Reformat Reader text through the local model without overwriting source text |
| `/api/cards/:id/markdown` | GET | Export one card as Markdown |
| `/api/export/markdown` | GET | Export the whole library or a tag subtree (`?category=`) |
| `/api/export` | GET | Legacy JSON/CSV/ZIP export (`?format=json|csv|zip`) |
| `/api/tags` | GET | Hierarchical tag tree with unique subtree counts |
| `/api/enrich` | POST | Run the AI pipeline over pending cards |

## Roadmap

Maps the full feature surface reverse-engineered from app.recall.it (see
`docs/` and the [CHANGELOG](./CHANGELOG.md)).

### Phase 1 — Foundation · Capture · Read ✅
Fork engine → local LLM · article + note capture with Wiki/PDF/import entry-point
placeholders · summary/notebook/tags · library + tag tree + text search · card
detail (Notebook + Reader) · Markdown export · planned Chat/Review route
placeholders · observed Settings categories as local-first placeholders · Reading
Room UI · Pake wrap.

### Phase 2 — Intelligence
- Embeddings (local `nomic-embed-text:v1.5`) → **semantic search** mode ✅ + **related cards** ✅
- **Connections**: manual `[[card title]]` links ✅ + generated local entity links ✅ + backlinks/return links ✅ + automatic local generation ✅
- **Graph** tab: related/entity/backlink constellation ✅ + backend depth traversal ✅ + local filter/fit/fullscreen controls ✅ + visible edge rendering/legend ✅
- **Chat**: per-card cited RAG ✅ + global cited RAG ✅ + writable tag/card context ✅ + recent-thread resume ✅ + temporary text/code/PDF/image uploads ✅
- Reader reformat implementation ✅
- Local active-recall question generation ✅ + generated multiple-choice questions ✅ + custom short-answer questions ✅ + generated/manual question edit/delete ✅ + self-graded card quiz runner ✅ + timed card quiz sessions ✅ + matching card quiz sessions ✅ + global due-question review queue ✅ + browser-local review preferences ✅
- Wikipedia topic capture ✅ + Browser Bookmarks import ✅ + Pocket CSV import ✅ + Social Bookmarks Triage JSON import ✅ + Markdown file import ✅ + PDF capture ingestion for selectable text ✅ + scanned-PDF local OCR ✅ + saved image/media capture ✅ + media-page URL metadata capture ✅ + YouTube caption transcript capture when exposed ✅
- Product-OS frontend redesign ✅: persistent nav, command search, list-first library, compact capture tiles, and insight rail

### Phase 3 — Learning (spaced repetition)
- `/spaced-repetition`: SM-2-style scheduling ✅ + **review streaks & 30-day
  activity history** ✅ (per-event `ReviewLog`). Remaining: FSRS-grade
  scheduling, reminders/notifications (need a delivery backend)

### Phase 4 — Capture breadth · Polish
- Sources: broader **Podcast/non-caption media transcription** ✅ — direct audio
  files + generic podcast/RSS feeds now transcribe via the local endpoint (not
  just Apple Podcasts). Remaining: TikTok/X/Reddit/Google Docs (audio streams not
  reliably resolvable)
- Imports: source sync/export polish beyond file-backed local imports
- **TTS** card audio summaries (local Kokoro) ✅ — Notebook "Listen" button +
  Settings voice picker with Sample ✅ + 9-language voice/lang_code selection ✅
- Explicit local share/unshare ✅ — read-only `/share/:shareId` page with a
  revocable unguessable link
- A11y: single `<main>` landmark + public-share-link metadata ✅ + keyboard
  `:focus-visible` ring, modal focus-trap/return, and async-status announcements ✅
- Processing-state robustness: capped/escapable stuck-card polling, no poll leak,
  double-submit guards, modal-aware shortcuts ✅
- Translation/search language, browser extension

## Project conventions

- **`README.md`, `CHANGELOG.md`, `CLAUDE.md`, and `.remember/remember.md` are
  kept current on every substantive change.** Update all four before each
  push/deploy — the changelog records what shipped; the roadmap above records
  what's next; `CLAUDE.md` captures durable agent learnings, gotchas, and
  workflow changes; `.remember/remember.md` preserves the short handoff.
- **Quality gate:** `npm run lint` should be quiet, and `npm run build` must pass.
- Issue tracking via [beads](https://github.com/beads-dev/beads) (`bd ready`).

## Credits

Reverse-engineered from [Recall](https://www.recall.it) for personal use. Engine
forked from Social Bookmarks Triage. Desktop wrapper by [Pake](https://github.com/tw93/Pake).
Current UI direction is informed by reader-workflow structure, private-memory
tools, and polished command-first product apps.
