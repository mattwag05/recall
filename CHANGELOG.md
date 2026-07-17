# Changelog

All notable changes to Recall are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project uses phase-based milestones (see the [roadmap](./README.md#roadmap)).

## [Unreleased]

### Phase 2 refinements

#### Added
- **Production local-AI deploy fix** — production compose defaults now match
  small locally-installed Ollama models
  (`functiongemma:270m-it-fp16` for chat and
  `nomic-embed-text-v2-moe:latest` for embeddings), and docs now capture the
  required UFW bridge rules for Recall's Docker network to reach host-local
  Ollama/Kokoro services.
- **Bounded local-AI fallbacks** — local chat/vision requests now have a bounded
  request timeout, semantic tagging falls back to deterministic local keyword
  tags when the model returns empty/malformed structured output, and Notebook
  generation falls back to extracted-text Markdown so imports do not remain
  untagged or notebook-empty when the installed local model is weak or slow.
- **AI endpoint configuration UI** — Settings → Intelligence now has a polished
  OpenAI-compatible endpoint panel with presets for Ollama, LM Studio, a local OpenAI-compatible server,
  OpenRouter, and custom providers, write-only API key fields, separate chat and
  embedding endpoint/model controls, timeout configuration, save/clear actions,
  and chat/embedding test buttons backed by `/api/settings/ai`.
- **Broader media transcription** — URL capture now routes **direct audio files**
  (`.mp3`/`.m4a`/`.aac`/`.wav`/`.ogg`/`.opus`/`.flac`) and **generic podcast/RSS
  feeds** (`.rss`/`.xml`/`/feed`/`/rss`) through the local transcription path, not
  just Apple Podcasts: direct files transcribe as-is, feeds take their first
  enclosure. Without a configured `TRANSCRIPTION_BASE_URL` they save as retryable
  `media` cards (transcribe on Retry once an endpoint is reachable). SoundCloud,
  Bandcamp, Spotify, and TikTok stay metadata-only (their audio streams aren't
  reliably resolvable).
- **TTS language selection** — Settings → Text to Speech now has a live Language
  picker (English US/UK, Spanish, French, Italian, Portuguese, Hindi, Japanese,
  Chinese) that filters the voice list and sets the Kokoro `lang_code` (the
  voice id's first letter) on synthesis, so non-English voices pronounce
  correctly. The voice picker scopes to the selected language; both persist
  browser-local.
- **Explicit card sharing (local, reversible)** — the card overflow menu now has
  a live "Share card" action (`POST /api/cards/:id/share`) that sets `shared` and
  mints an unguessable `shareId` (32-hex `randomBytes`, not the card id) and copies
  the link, plus "Make private" (`DELETE`) to revoke. `/share/:shareId` is a
  read-only public page that resolves only while `shared` is true, so revoking
  404s the link. The Shared/Private badge reflects live state.
- **TTS voice selection** — Settings → Text to Speech now has a live voice
  picker (curated Kokoro voices, persisted browser-local under
  `recall:tts-voice:v1`) and a working Sample button (`POST /api/tts/sample`);
  the Notebook "Listen" button uses the chosen voice. The voice id is validated
  against an allowlist server-side. Language/custom-voice controls stay placeholders.
- **Card audio summaries (local TTS)** — the Notebook tab now has a "Listen"
  button that synthesizes a spoken summary (title + summary/notebook/body, with
  markdown stripped) through the local Kokoro `/audio/speech` endpoint
  (`TTS_BASE_URL`, default `http://127.0.0.1:8880/v1`) via
  `POST /api/cards/:id/speech`, and plays/stops it in-page with structured
  404/503 failures surfaced as toasts. TTS voice/language settings remain placeholders.
- **Review streaks & activity history** — every answered review now writes a
  `ReviewLog` event, and `/spaced-repetition` shows a current/longest day streak,
  reviews-today, all-time review total, and a 30-day daily activity strip. Day
  boundaries use server-local time; logging is best-effort so a logging failure
  never fails a completed review. Reminders/notifications remain disabled until a
  delivery backend exists.
- **Matching card quiz sessions** — Card detail Quiz now starts a matching mode
  when a card has at least two questions, lets the user pair prompts with
  expected answers, records all pair results through the existing local review
  endpoint, and reports one aggregate score/toast.
- **Timed card quiz sessions** — Card detail Quiz now offers a 60-second-per-question
  timed mode that shows the countdown in-session, reuses the existing local
  review endpoint, and marks unanswered expired questions as practice-again.
- **Multiple-choice quiz questions** — local quiz generation can now create MCQ
  questions with stored answer options, card quiz sessions render choices, and
  the global review queue can review due MCQs alongside short-answer questions.
- **Apple Podcasts local transcription hook** — media URL capture/retry can now
  resolve Apple Podcasts episode audio through Apple/RSS metadata and send it to
  an optional local OpenAI-compatible Whisper endpoint
  (`TRANSCRIPTION_BASE_URL`) before falling back to metadata-only media cards.
- **Production transcription backend wiring** — production Recall now joins the
  existing `sherpa-onnx_default` Docker network and defaults Apple Podcasts
  transcription to the local `sherpa-onnx` SenseVoice endpoint.
- **Local semantic search** — Search AI mode now runs real full-card embedding
  search through the OpenAI-compatible local embedding endpoint
  (`nomic-embed-text:v1.5` by default), with lazy vector backfill for existing cards
  and structured failures when the embedding provider is unavailable.
- **Related cards** — Card detail now exposes a live
  `/api/cards/:id/related` semantic-neighbor endpoint and uses it in the
  Connections and Graph tabs, with retryable local embedding-provider errors.
- **Manual card links** — Connections now supports persistent manual card links
  through `POST`/`DELETE /api/cards/:id/connections`, including save-link
  actions from related cards and Notebook `[[card title]]` links on save.
- **Generated entity links** — Connections can now generate persistent local
  entity links from extracted entities, semantic tags, and hierarchical tags via
  `POST /api/cards/:id/connections/generate`.
- **Local graph controls** — the card Graph tab now has live local depth,
  node-family/entity-type filters, fit layout, and fullscreen viewing for
  related cards, saved links, generated entity links, and card context tags.
- **Graph edge rendering** — the card Graph tab now draws visible directional
  edges for manual links, backlinks, multi-hop links, generated entity links,
  semantic related cards, and card context nodes, with a readable legend and
  filtered visible-edge summary.
- **Backlinks and return links** — Card detail now loads inbound `Connection`
  rows, shows backlinks grouped by type, lets users save a return link from
  related cards that already point here, and includes inbound card nodes in Graph.
- **Automatic local connection generation** — `/api/enrich` now runs an
  idempotent `connection_generation` stage after enrichment so new cards get
  generated local entity links without requiring a manual button click.
- **Connection graph traversal** — card detail now has
  `GET /api/cards/:id/graph?depth=1..3` for bounded backend graph traversal over
  outbound and inbound card links plus generated entity nodes.
- **Card chat RAG** — card detail Chat now sends live prompts through
  `POST /api/chat`, defaults to the current card as cited context, can expand
  with semantic library context, and stores chat threads/messages locally.
- **Global chat RAG** — `/chat` now has live prompt sending, selectable tag/card
  context, semantic all-knowledge expansion, and recent-thread resume through the
  shared cited local RAG route.
- **Temporary chat uploads** — Card Chat and global Chat now accept bounded
  readable-file uploads (`.txt`, Markdown, CSV, JSON, logs, and code) plus
  extractable PDFs and PNG/JPG/WebP images as temporary unsaved context for the
  next local RAG answer.
- **PDF and image chat extraction** — `/api/chat/attachments/extract` now
  extracts bounded text from uploaded PDFs and local-model OCR/vision text from
  uploaded raster images for temporary chat context, with structured failures
  for oversized, invalid, password-protected, scanned/no-text PDFs, unsupported
  images, or unavailable local vision models.
- **YouTube caption transcript capture** — media URL capture now tries exposed
  YouTube caption tracks before falling back to metadata-only cards, saves the
  transcript as Reader text, indexes it for search/enrichment, records caption
  provenance in `rawJson`, and keeps media cards retryable when captions are not
  exposed yet.
- **Card quiz generation** — Card detail Quiz can now call
  `POST /api/cards/:id/questions/generate` to create local short-answer
  active-recall questions from the card Notebook/Reader, dedupe existing
  prompts, and make generated questions due in the Review dashboard.
- **Custom questions and card quiz runner** — Card detail Quiz can now save
  manual short-answer prompts through `POST /api/cards/:id/questions`, run a
  self-graded quiz session for the current card, and record answers through
  `POST /api/cards/:id/questions/:questionId/review` so seen/correct counts,
  due dates, and memory stages update locally.
- **Editable quiz questions** — generated and manual short-answer questions can
  now be edited or deleted through `PATCH`/`DELETE`
  `/api/cards/:id/questions/:questionId`, with FTS reindexing and duplicate
  prompt checks.
- **Global due review queue** — `/spaced-repetition` Start review now launches
  a local short-answer queue over due `QuizQuestion` rows, reveals expected
  answers, records self-graded results through the existing review API, and
  refreshes local due/stage counts as answers are submitted.
- **Local review preferences** — Settings now stores browser-local daily review
  goal and review session size preferences, and `/spaced-repetition` uses the
  session-size preference to cap each Start review run while keeping the full due
  queue visible.
- **Media-page URL capture** — `POST /api/import/url` now classifies common
  media providers (YouTube, Vimeo, TikTok, Spotify, Apple Podcasts, SoundCloud,
  and Bandcamp), saves them as `sourceType="media"` cards, keeps thumbnails and
  audio/video media items, and falls back to source metadata when transcript or
  readable page text is unavailable.
- **Wikipedia topic capture** — the library quick-create tile and Add modal Wiki
  tab now search Wikipedia topics through `GET /api/import/wiki`, import selected
  pages through `POST /api/import/wiki`, store parsed page text as local
  `sourceType="wiki"` cards, index them in FTS, and start local enrichment.
- **Markdown file import** — the Add modal Import tab now imports up to 10 local
  `.md`/`.markdown` files through `POST /api/import/markdown`, creates deduped
  local `document` cards keyed by file hash, stores original Markdown as Reader
  text, indexes it in FTS, reports per-file failures, and starts local
  enrichment for newly imported files.
- **Browser Bookmarks import** — the Add modal Import tab now imports one
  Chrome/Firefox/Edge bookmarks HTML export through `POST /api/import/bookmarks`,
  creates deduped local URL cards, blocks private/internal bookmark URLs, stores
  folder path metadata, indexes bookmark titles/URLs/folders in FTS, reports
  per-bookmark failures, and starts local enrichment for imported links.
- **Pocket CSV import** — the Add modal Import tab now imports one Pocket CSV
  export through `POST /api/import/pocket`, creates deduped local URL cards,
  blocks private/internal saved links, stores Pocket tag/status/time metadata,
  indexes Pocket titles/URLs/tags in FTS, reports per-link failures, and starts
  local enrichment for imported links.
- **Social Bookmarks Triage JSON import** — after read-only inspection of the
  current SBT checkout, the Add modal Import tab now imports one SBT JSON export
  or bookmarklet file through `POST /api/import/social-bookmarks`, creates
  deduped local social cards, blocks private/internal links, preserves platform,
  author, save-action, actionability, semantic tags, categories, and media
  references, indexes imported text/tags/categories in FTS, and starts local
  enrichment without calling or mutating a live SBT service.
- **Self-hosted Docker deployment** — Recall now includes a source-built
  `docker-compose.deploy.yml`, `Dockerfile`, and `.dockerignore` for running as
  its own service on host port `3011`, with persistent SQLite data and media
  volumes.
- **Production front-door** — the production instance is served behind a Caddy
  reverse proxy to the Recall container on `127.0.0.1:3011`.
- **Saved PDF capture** — the Add modal PDF tab now imports up to 10 PDFs
  through `POST /api/import/pdf`, creates local `document` cards keyed by PDF
  hash, indexes selectable text or OCR text, reports per-file failures/dedupes,
  and starts local enrichment for newly imported cards.
- **Scanned PDF OCR** — textless PDF imports now render the first pages through
  `pdf-parse` screenshots and use the local vision model for OCR before creating
  document cards, recording OCR metadata in `rawJson`.
- **Saved image capture** — the library quick-create area and Add modal Image tab
  now import up to 10 PNG/JPG/WebP files through `POST /api/import/image`, save
  image bytes under local gitignored `public/media/`, and create image cards
  with thumbnails plus OCR/vision text when the local model is available.
- **Reader reformat** — Card detail Reader now has a live non-destructive
  reformat action backed by `POST /api/cards/:id/reader/reformat`, returning
  local-model Markdown as an alternate view while preserving the original
  extracted Reader text.

#### Changed
- **Mobile safe-area padding** — pages can use the shared `rr-safe-bottom`
  utility to clear iPhone Safari's floating toolbar; Settings now uses it for
  the final controls.
- **Summary fallback for captured media** — if the local model fails to create a
  Notebook or 1-line summary for a card that already has captured Reader text,
  enrichment now saves a short excerpt summary instead of leaving the library
  card blank.
- **Product-OS frontend redesign** — the active library UI now replaces the
  Reading Room shell with a command-first product surface inspired by serious
  reader workflows, private-memory tools, and polished productivity apps:
  persistent left navigation, sticky command search, list-first card rows,
  compact capture tiles, and a right-side insight rail for local status,
  related ideas, review due, and recent cards.
- **Production startup safety** — the production Docker image now starts through
  `scripts/start-production.sh`, which initializes Prisma only for a missing or
  uninitialized SQLite DB and skips `db push` for existing production databases
  so Prisma does not block startup on raw FTS5 internal-table warnings.
- **Embedding freshness** — enrichment now includes an embedding stage, and
  title/notebook/tag/retry/regenerate mutations invalidate stored vectors so
  semantic ranking refreshes after local edits.
- **Semantic Search controls** — date and tag filters stay live for semantic
  search, while Notebook/Reader/Quiz surface filters are kept as Text-mode-only
  controls because the stored vector represents the full card.
- **Chat intelligence surfaces** — Card Chat and global Chat now answer from
  local cited context plus temporary readable-file/PDF/image uploads, while
  Connections, Graph, and Quiz render live related-card data, saved manual links,
  generated entity links, visible edge lines, local graph controls backed by
  bounded graph traversal, generated active-recall questions, custom
  short-answer questions, editable question management, self-graded card quiz
  sessions, and the global due-question review queue.
- **Reader intelligence surface** — the Reader reformat control now reports
  local-model failures as structured UI errors and uses Original/Reformatted tabs
  instead of replacing source text.
- **Capture boundary** — URL capture now covers article and media-page links;
  Wikipedia, PDF, and Image quick-create plus the Add modal Wiki/PDF/Image panels
  are live, and the Add modal Import tab now has live Browser Bookmarks, Pocket
  CSV, and local Markdown file import; full transcript capture remains a
  planned-purpose placeholder, while scanned/image-only PDFs now enter the local
  OCR path and report local-vision availability honestly.

#### Changed
- **Broader a11y + processing-state pass** — (1) a global keyboard `:focus-visible`
  cobalt ring (buttons, links, selects, inputs, tabs, menu items) so keyboard users
  see focus app-wide; (2) the Add and Search modals now trap Tab/Shift+Tab and
  return focus to their trigger on close (shared `lib/use-dialog-focus.ts`);
  (3) library `/` and `n` shortcuts are suppressed while a modal/menu is open;
  (4) card processing polls are capped (~2 min) — a stuck `organizing`/`summarizing`
  card stops polling and shows a "taking longer than expected — check again /
  retry" escape; (5) the library poll interval always clears on unmount (no leak);
  (6) share/unshare/delete menu actions and related/graph retry buttons disable
  while in flight (no double-submit); (7) the Toaster is `role="status"` and the
  Listen / Sample buttons announce synth/playing via `aria-live`.
- **A11y + share-link polish** — every page now renders inside a single `<main>`
  landmark (added in the root layout; the library's duplicate `<main>` became a
  `<div>`), giving screen readers a consistent skip target. Public `/share/:id`
  links now set their `<title>` to the shared card's title (with `robots: noindex`)
  instead of the generic app name.

#### Fixed
- **UI haze on inner pages** — the fixed `body::before` paper-texture layer
  (a near-opaque white gradient) sat at `z-index: 0`, so any page whose content
  wrapper wasn't `main`/`.rr-z` (card detail, spaced repetition, settings, share)
  rendered under a translucent haze. The layer now sits at `z-index: -1`, behind
  all content uniformly.

### Phase 1 refinements

#### Changed
- **Browser QA dev origin** — Next dev now allows `127.0.0.1` as a development
  origin, so Browser fallback from `localhost` to `127.0.0.1` does not leave the
  app stuck behind a blocked HMR/dev-resource overlay.
- **Tag relevance fixed** — the semantic tagger now receives the article's
  `title` + `body`, not just the short excerpt, so tags reflect the subject
  (e.g. `spaced-repetition`, `forgetting-curve`, `leitner-system`) instead of
  host-site boilerplate (`wikipedia`, `encyclopedia`). Prompt also tightened to
  8–15 subject tags and to never tag the platform.
- **Summary derived from the Notebook TL;DR** — one fewer LLM call and a preview
  that's always consistent with the notebook (`lib/notebook.ts` `extractTldr`,
  reordered pipeline stage). Plain-summary fallback retained when no TL;DR.
- **Library recency alignment** — card groups and row timestamps now use
  `updatedAt`, matching the API's updated-date ordering and the app's Updated
  sort behavior.
- **Search modal state** — each open now starts in Text mode and defaults back to
  the active tag scope, so prior AI/all-library choices do not leak into the next
  search.
- **Ready empty-card copy** — ready cards without summaries, including
  title-only notes, now show neutral empty-summary copy instead of "Awaiting
  summary..." processing language.
- **Card grid accessibility** — thumbnail and source-type media links now have
  explicit "Open {card title}" accessible names instead of exposing empty or
  generic duplicate card links.
- **Modal tab accessibility** — Add source tabs and Search Text/AI mode tabs now
  expose proper tablist/tab/tabpanel semantics plus arrow/Home/End keyboard
  navigation instead of relying on decorative button state alone.
- **Live input names** — the Add modal's URL/note fields and Search modal query
  field now expose explicit accessible names instead of relying on placeholder
  copy for the live Phase 1 capture/search paths.
- **Live edit field names** — the Add modal note textarea is named as Note body
  and the card-detail tag editor input is named as Tag name, matching the live
  Phase 1 form actions verified during interaction QA.
- **Card detail tab accessibility** — Notebook/Reader/Chat/Quiz/Connections/Graph
  now expose the same tablist/tab/tabpanel semantics and arrow/Home/End keyboard
  navigation while keeping later-phase panels visibly selectable but non-live.
- **Review route tab accessibility** — `/spaced-repetition` now uses real
  Review/Questions tab semantics with arrow/Home/End keyboard navigation instead
  of anchor links that left both placeholder panels visible at once.
- **Chat context tab accessibility** — `/chat` now exposes its Tags/Cards context
  picker as a keyboard-navigable tablist with one visible placeholder panel at a
  time, while keeping chat sending, uploads, and history disabled for Phase 2.
- **Settings control semantics** — `/settings` theme choices now expose radio
  selection state and local preference toggles expose named switch state instead
  of relying on visual styling or pressed-button semantics.
- **Settings reading-size semantics** — the live Notebook/Reader reading-size
  preference now exposes Compact/Regular/Large/Wide as a real radio group with
  arrow/Home/End keyboard movement instead of a generic range slider, and it
  hydrates the saved browser-local value after mount to avoid reload mismatches.
- **Card reading-size hydration** — card detail now loads the shared
  Notebook/Reader text-size preference after mount, matching Settings and
  avoiding reload hydration mismatches when a non-default size is saved.
- **Settings review control semantics** — live Quiz daily-goal and review
  session-size preferences now use keyboard-navigable radio groups, while
  reminder/timed-mode placeholders keep setting-specific disabled names.
- **Settings action names** — generic Settings buttons such as Manage, Update,
  Run now, Configure, Sample, Add voice, and Delete now expose setting-specific
  accessible names while preserving the local/disabled Phase 1 surface.
- **Settings placeholder purpose** — disabled Settings subscription/email,
  theme, translation/search-language, browser extension, quiz reminder, TTS,
  Help/Feedback, and account-deletion controls now expose planned-purpose
  labels/tooltips instead of reading like live generic controls.
- **Library view mode semantics** — the Grid/List browsing control now exposes a
  real radio group with arrow/Home/End keyboard movement instead of pressed-button
  state.
- **Card action menu semantics** — card detail overflow actions now expose a real
  menu/menuitem structure with first-item focus, Escape close, and
  arrow/Home/End keyboard movement.
- **Search tag-scope semantics** — when Search is opened from an active tag, the
  current-tag versus all-cards scope selector now exposes radio state with
  arrow/Home/End keyboard movement.
- **Recent search filter identity** — recent exact-text searches now keep
  separate entries for the same query when Search in or Date filters differ,
  matching the filter details shown in the history list.
- **Profile menu keyboard semantics** — the library header Profile menu now
  focuses its live Settings action on open, returns focus on Escape, and supports
  arrow/Home/End movement while keeping later-phase Help/Feedback entries disabled.
- **Library quick-create phase boundary** — the library quick-create row now
  keeps source tiles phase-honest: URL and Note shipped as the Phase 1 live
  shortcuts, PDF is now live for Phase 2 document capture, and Wiki remains a
  disabled placeholder until its ingestion backend exists.
- **Library quick-create placeholder names** — the disabled Wikipedia
  quick-create tile announces planned topic capture with a source-specific
  tooltip instead of a generic later-phase message.
- **Library placeholder action names** — tag-management and selected-card
  placeholders now announce planned top-level tag creation, bulk tag deletion,
  batch Markdown export, and batch card deletion instead of generic disabled
  Add/Delete/Export labels.
- **Placeholder action names** — disabled later-phase actions across Add modal
  Wiki/Import panels, Card detail, `/chat`, and `/spaced-repetition` now
  expose specific planned-purpose labels and tooltips instead of generic controls
  like Send, Upload, Settings, Import, or Start.
- **Card placeholder tab names** — Card detail Chat, Quiz, Connections, and
  Graph tabs now expose phase-specific planned labels/tooltips instead of the
  generic "coming later" affordance.
- **Card overflow placeholder names** — disabled Images and Share menu items now
  distinguish planned image galleries, planned public share links, and read-only
  shared state in the local Phase 1 build.
- **Semantic search placeholder names** — Search AI mode now labels its disabled
  semantic query, surface filters, date filter, active-tag scope choices, and
  recent-history clear action with specific planned/local history purpose instead
  of generic inert controls.

#### Added
- **Manual tag editing** — add/remove tags on a card (creating new ones inline);
  `POST`/`DELETE /api/cards/:id/tags`, chip editor in card detail, and honest
  API/network failure toasts for tag mutations.
- **Regenerate notebook** — `POST /api/cards/:id/regenerate` rebuilds the notebook
  + TL;DR for one card; existing notebooks require confirmed replacement in the
  UI and `replace: true` at the API layer so user edits are not overwritten by
  accidental calls.
- **Retry extraction** — `POST /api/cards/:id/retry` re-extracts a failed URL card
  and re-enriches just that card (notebook + summary + semantic tags +
  hierarchical category filters).
- **Failed URL safety** — settings re-enrichment no longer turns failed URL cards
  with no reader text into `ready` cards based only on the URL/title; they stay
  failed and retryable until extraction succeeds.
- **Fallback summary status** — when Notebook generation fails but fallback
  1-line summarization succeeds, the enrichment pipeline now marks the card
  `ready` and counts it as processed instead of leaving the library polling on
  `organizing`/`summarizing`; if both summary paths fail after extraction, the
  card is still marked `ready` with an error count so Reader content stays usable.
- **UX polish** — toast notifications (copy/save/tag/regenerate), `Escape` closes
  modals, `aria-label`s on icon-only controls, and card overflow menus now show
  Created/Updated metadata before item actions.
- **Card placeholder tabs** — Chat, Quiz, Connections, and Graph tabs are now
  selectable informational panels instead of inert disabled labels, matching the
  Phase 1 placeholder surface.
- **Card tab control polish** — card Chat, Quiz, Connections, and Graph panels now
  expose the observed context, suggestion, upload, quiz, connection, graph, and
  depth controls as disabled/local placeholders, while showing existing quiz
  questions with answers/review metadata and outbound connection groups when
  present.
- **Mobile tag filtering** — small-screen library now exposes the hierarchical
  tags as a horizontal chip strip, keeping tag filters available when the desktop
  sidebar is hidden.
- **Desktop tag sidebar toggle** — the Reading Room header can now show or hide
  the desktop tag tree locally, matching the observed collapsible tag navigation
  without changing active filters or enabling tag-management APIs.
- **Library thumbnails** — card rows now show saved source thumbnails when
  available, while keeping the compact text-first mobile layout; the first
  visible thumbnail loads eagerly to avoid LCP warnings.
- **Library browsing controls** — the library now defaults to the observed Grid
  view, can switch to List, exposes Updated/Created sort, and shows local
  selected-card controls with disabled batch Export/Delete placeholders until
  selected-card APIs exist.
- **Library load recovery** — `/items` now catches card API failures, keeps stale
  cards visible when possible, and shows a retryable local-app banner instead of
  treating failed loads as an empty library; `/api/cards` and `/api/tags` return
  structured JSON errors for list/tag load failures, and the library banner now
  surfaces the `/api/cards` error message when available. Stale tag filters now
  return `Tag not found` instead of a false empty card list, and malformed
  successful card/tag payloads are treated as load failures instead of false
  empty states.
- **Tag filter load recovery** — tag tree load failures now keep stale cards and
  any existing tag tree visible while showing a retryable `Retry tags` banner
  instead of silently replacing the tag surface with an empty state.
- **Search coverage** — the FTS index now includes card titles, Notebook content,
  summaries, quiz prompts/answers, and manual/hierarchical category tags in
  addition to reader text, string-only semantic/image tag terms, and object-shaped
  entity values; older FTS tables rebuild automatically on first use. Wrong-shaped
  semantic-tag or image-tag JSON is filtered out before semantic tagging,
  categorization, and FTS indexing, and wrong-shaped entity JSON is ignored before
  enrichment prompt construction or FTS indexing.
- **Scoped search** — opening search while a tag filter is active now searches
  within that tag by default, with an inline switch back to the whole library.
- **Search filters** — the Search modal now exposes observed Search in, Date, and
  Tags filters; `/api/cards` accepts `surfaces=notebook,reader,quiz` and
  `date=today|week|month` alongside descendant-aware tag filtering.
- **Recent searches** — exact-text searches are saved locally, grouped by date,
  replayable with their Search in/Date/Tags filters, and clearable from the
  Search modal; tag-scoped entries only appear when their tag context is active.
- **Search failure state** — exact-text search now clears stale results and shows
  an actionable local-app or structured `/api/cards` error when search fails,
  rejects malformed successful payloads and unsupported date/surface filters, and
  reports FTS index/database failures instead of treating them as no matches,
  while keeping semantic search as a Phase 2 placeholder instead of pretending
  embeddings exist.
- **Hierarchical tag filtering** — parent tags now include cards filed under
  descendant tags, exports use the same subtree filter, and sidebar/mobile counts
  aggregate unique cards across each tag subtree.
- **Tag sidebar filtering** — the desktop tag tree now has an inline filter that
  preserves parent context for matching descendants and can be cleared without
  losing the active card filter.
- **Tag tree disclosure** — the desktop tag sidebar now supports per-branch
  expand/collapse plus Expand all/Collapse controls while preserving expanded
  matching branches during tag search.
- **Tag multi-select surface** — the desktop tag sidebar now shows the observed
  tag-selection checkboxes, selected-count panel, Clear selection action, and
  disabled Add/Delete placeholders until a confirmation-backed tag API exists.
- **Card reading controls** — card detail now exposes the observed text-size
  control as a local Notebook/Reader preference, and the overflow menu includes
  disabled Images and Share placeholders while keeping copy-link local-only.
- **Capture feedback** — duplicate URLs no longer re-trigger enrichment, and save
  toasts now distinguish existing cards, ready notes, failed extraction, and
  in-progress local-model work.
- **Capture error guidance** — URL capture now gives actionable inline messages
  for missing, malformed, non-http, private/internal, and local API/network
  failures; note creation and URL import database failures return structured JSON
  errors, malformed successful payloads with missing IDs, unknown statuses, or
  invalid optional URL metadata stay in the Add modal with retry guidance, and
  saved pages that do not yield readable text tell the user to retry extraction
  from card detail.
- **Capture entry-point polish** — the library quick-create row now exposes the
  observed URL, Note, Wiki, and PDF entry points; planned capture tabs are
  selectable so their unavailable state is explicit instead of hidden, without
  announcing those clickable placeholders as disabled controls.
- **Planned capture panels** — the Add modal's Wiki, PDF, and Import tabs now
  show the observed topic search, 10-PDF dropzone, browser/Pocket/Markdown import
  choices, and plan-gate messaging as disabled controls until those capture
  backends exist.
- **Default capture action** — the Add modal now shows the observed default
  action selector with Phase 1 `Concise summary` selected, while detailed
  summaries, quiz generation, and connection finding remain disabled until their
  later phases.
- **URL import hardening** — URL cards now dedupe by normalized source URL plus
  legacy IDs, use full-URL hashes for new `postId`s to avoid cross-domain path
  collisions, and reject more private/internal host ranges.
- **Markdown export polish** — exported titles/source metadata are escaped,
  tags are deduped into portable slugged hashtags, summaries render as safe
  Markdown blockquotes, and existing local connections plus quiz questions are
  included when present.
- **Notebook link rendering** — card detail now renders safe `http`, `https`,
  `mailto`, root-relative, and hash Markdown links in Notebook content while
  leaving unsafe link targets as text.
- **Notebook contents** — card detail now derives a compact Contents block from
  Notebook headings and renders matching heading anchors for in-card navigation.
- **Reader reformat affordance** — Reader now shows the observed reformat action
  as a disabled planned control beside copy, keeping Phase 1 honest while making
  the later Reader polish path visible.
- **Card copy feedback** — the card overflow menu can copy the local `/item/:id`
  URL, and card link/Notebook/Reader copy actions now show clipboard failure
  feedback instead of swallowing failed writes.
- **Share-state clarity** — card list/search/detail surfaces now show read-only
  Shared or Private/local state from existing card data while keeping public
  Share/Unshare controls disabled until a reversible sharing backend exists.
- **Card load recovery** — direct card URLs now distinguish deleted/missing cards
  from transient API/load failures, offering a library return for gone cards and
  a retry action for recoverable local-app errors; `GET /api/cards/:id` now
  returns structured JSON errors and the detail page surfaces them before
  falling back to generic local-app guidance. Wrong-shaped stored semantic-tag
  JSON now becomes an empty tag list instead of breaking card rendering.
- **Card edit save feedback** — title and Notebook edits now show API/network
  failures instead of unconditionally announcing a successful save, and
  PATCH/DELETE card failures distinguish missing cards from internal route or
  database errors; malformed successful action responses no longer toast saved
  or navigate away.
- **Card action failure feedback** — tag add/remove, Notebook regeneration, and
  URL extraction retry now return structured JSON errors for route/database/model
  failures; the card detail UI requires `{ ok: true }` before success feedback,
  tag add/remove controls are locked while a tag mutation is in flight so
  Enter-plus-blur cannot double-submit, tag removal confirms the card exists
  and only treats Prisma missing-link errors as idempotent, regenerate restores
  the prior card status on model failure, and retry marks failed enrichment as
  retryable instead of leaving the card summarizing.
- **Delete confirmation feedback** — card delete now stays on the current card
  and reports API/network errors unless the delete request actually succeeds.
- **Agent instruction hygiene** — `CLAUDE.md` is now part of the mandatory docs
  update loop alongside `README.md` and `CHANGELOG.md`, so durable learnings and
  gotchas stay available to future agents.
- **Tag-scoped Markdown export** — Settings can now export the whole library or
  a selected hierarchical tag subtree, and `/api/export/markdown?category=...`
  uses the same descendant-aware filter as the JSON/CSV/ZIP exports.
- **Markdown export feedback** — Settings and card-detail Markdown export now run
  as in-app actions with busy, success, and local API/network failure messages;
  library and card Markdown routes return structured JSON errors when generation
  fails, and tag-scoped exports return `Tag not found` instead of downloading a
  valid-looking empty file for stale tag slugs; direct tag-scoped downloads now
  include the tag slug in the filename. Wrong-shaped stored semantic-tag JSON no
  longer breaks Markdown tag rendering.
- **Legacy export route hardening** — `/api/export` now rejects unsupported
  formats with JSON guidance, returns format-specific structured errors for
  JSON/CSV/ZIP generation failures, rejects stale tag filters, and streams ZIP
  data from the actual buffer bytes. The route is explicitly pinned to the Node
  runtime because it uses the local SQLite/ZIP export stack, and malformed stored
  AI JSON fields now fall back to empty exported values instead of failing the
  entire JSON/ZIP export; exported semantic tags are filtered to strings only.
- **Settings tag-filter load feedback** — Settings now shows a retryable message
  when export tag filters fail to load or return malformed payloads, while
  preserving all-card Markdown export and any existing tag choices instead of
  silently dropping the export filter list to empty.
- **Library route alias** — `/items` now renders the Reading Room library in
  addition to `/`, matching the primary library route observed in the
  reverse-engineered Recall surface.
- **Primary route placeholders** — the library header now links to `/chat` and
  `/spaced-repetition`; those routes render Reading Room placeholders backed by
  local tag/card context and quiz-question counts while full Chat/Review stays
  in the Phase 2/3 roadmap.
- **Chat context preview** — `/chat` now renders hierarchical tag context paths
  with unique subtree counts, recent cards, context/upload/history affordances,
  and the observed auto-mode indicator without enabling real chat yet.
- **Review dashboard preview** — `/spaced-repetition` now shows observed
  Review/Questions tabs, due-now/weekly workload, disabled Start Review/Start
  Quiz controls, activity/accuracy no-data states, memory-stage progress, and
  per-card question groups from existing `QuizQuestion` rows.
- **Profile menu preview** — the library header now exposes an observed-style
  profile menu with a live Settings entry and disabled More/Help placeholders
  for Docs, FAQ, Discord, email support, bug reports, feature requests, and social
  links until real destinations exist.
- **Navigation and shortcut polish** — library backlinks now use the canonical
  `/items` route, and `/` / `n` shortcuts only fire from the passive page surface
  instead of triggering while focus is on links, buttons, selects, or editable
  fields.
- **Settings export layout** — the tag-scoped Markdown export control now stacks
  cleanly on narrow screens instead of forcing the Settings row to overflow.
- **Settings enrichment feedback** — re-running enrichment now handles API errors,
  malformed responses, missing/non-numeric pipeline counts, and local network
  failures with actionable Settings-page messages.
- **Settings surface polish** — `/settings` now mirrors the observed Account,
  Appearance, Preferences, Quiz, Text to Speech, Help/Feedback, and Danger Zone
  categories with local-first controls, a live Notebook/Reader reading-size
  slider, and disabled placeholders for unsupported cloud, theme, review, and
  TTS preferences; Account now shows a disabled Manage subscription control,
  Text to Speech includes disabled language selection, Help/Feedback includes
  Discord and social-link placeholders, and Quiz notification placeholders now
  split spaced repetition, streak, and challenge events with a shared reminder
  time.
- **Add modal mobile layout** — the URL/Wiki/PDF/Import/Note tab rail scrolls
  horizontally on narrow screens, and save/status controls stack instead of
  crowding the capture form.
- **Long-title wrapping** — library rows, search results, and card detail titles
  now wrap unbroken strings instead of forcing horizontal overflow on small
  screens.
- **Modal semantics** — Add and Search now expose dialog roles and labels while
  preserving Escape/backdrop close behavior.

#### Removed
- Pruned the orphaned Social Bookmarks Triage surface unused by Recall: legacy
  pages (bookmarks/categories/import/inbox/ai-search/categorize/mindmap), their
  components (nav, command-palette, theme-toggle, bookmark-card, mindmap), the
  matching API routes and libs (parser, triage-rules, mindmap, media-cache,
  vision-analyzer, types, tag-utils), the browser extension, bookmarklets,
  MCP server, and Docker/deploy scripts. Dropped the unused vision stage from the
  pipeline.

#### Build
- `npm run lint` is now quiet (0 warnings/errors) and `next build` passes. The
  over-eager `react-hooks/set-state-in-effect` rule remains configured as a
  warning, but the library data-loading effects no longer trip it.
- **Phase 1 fit-and-finish** — quick-create tiles now open the correct URL vs.
  note tab, the card overflow menu closes on outside click/Escape instead of
  mouse-leave, and Reading Room buttons share icon-aware sizing/disabled states.
- **Repo hygiene** — tracked editor swap files were removed and future `.swp` /
  `.swo` artifacts are ignored before the Phase 1 checkpoint.

_Next: Phase 2 (Intelligence) — semantic search, connections, graph, chat._

## [0.1.0] — 2026-06-06 — Phase 1: Foundation · Capture · Read

The first working prototype: a local-first, Pake-wrappable Recall clone.

### Added
- **Project** forked from the Social Bookmarks Triage engine
  (engine reused; runtime state, secrets, and the live deploy untouched).
- **Local LLM backend** — provider-aware client (`lib/ai-client.ts`) targeting
  a local OpenAI-compatible server (`Qwen3.6-35B-A3B-4bit`) with an Ollama (`gemma4`) fallback; thinking
  disabled per-provider so structured stages return clean output.
- **Article capture** — full readable-text extraction via `@mozilla/readability`
  + jsdom (`lib/extract/article.ts`), wired into `POST /api/import/url`.
- **Note capture** — `POST /api/cards/note`.
- **AI enrichment pipeline** — entity extraction → semantic tags → hierarchical
  categories → 1-line summary → structured **Notebook** (`lib/notebook.ts`),
  triggered via `POST /api/enrich`.
- **Data model** — extended `Bookmark`→Card fields (`title`, `provider`,
  `notebookContent`, `status`, `shareId`, `embedding`), hierarchical `Category`
  (`parentId`), and `Connection` / `QuizQuestion` / `ChatThread` models for later
  phases.
- **Card API** — `GET /api/cards`, `GET/PATCH/DELETE /api/cards/:id`,
  `GET /api/tags`, Markdown export (`/api/cards/:id/markdown`, `/api/export/markdown`).
- **Reading Room UI** (built fresh with the `frontend-design` skill):
  - Library at `/` — index-card catalog, date grouping, hierarchical tag-tree
    sidebar with counts, quick-create tiles, staggered reveal.
  - Add Content modal (URL + Note live; Wiki/PDF/Import as "coming soon" tabs).
  - Search modal (Text mode live; AI/semantic reserved for Phase 2).
  - Card detail at `/item/:id` — six tabs (Notebook editable + Reader live;
    Chat/Quiz/Connections/Graph as wired placeholders), editable title,
    Markdown export, delete, drop-cap reader.
  - Settings at `/settings` — Markdown export, re-run enrichment.
  - Aesthetic: cream paper + ink + oxblood, paper grain, Fraunces / Newsreader /
    Spline Sans Mono, editorial motion.

### Notes
- Runs fully local on M5; no cloud calls.
- Internal Prisma model names remain `Bookmark`/`Category`; the UI presents them
  as Card/Tag (minimizes churn against the forked engine).

[Unreleased]: https://github.com/mattwag05/recall/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/mattwag05/recall/releases/tag/v0.1.0
