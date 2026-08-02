'use client'

import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import Link from 'next/link'
import { Bot, CheckCircle2, KeyRound, Moon, RotateCcw, Server, Sun, TestTube2, Volume2, type LucideIcon } from 'lucide-react'
import { READING_SIZES, readReadingSize, writeReadingSize, type ReadingSize } from '@/lib/reading-preferences'
import { setTheme, useTheme } from '@/components/recall/theme-toggle'
import {
  DAILY_REVIEW_GOALS,
  DEFAULT_REVIEW_PREFERENCES,
  REVIEW_SESSION_SIZES,
  readReviewPreferences,
  writeReviewPreferences,
  type DailyReviewGoal,
  type ReviewPreferences,
  type ReviewSessionSize,
} from '@/lib/review-preferences'
import { TTS_LANGUAGES, DEFAULT_TTS_VOICE, readTtsVoice, writeTtsVoice, languageForVoice, voicesForLanguage } from '@/lib/tts-preferences'
import { DEFAULT_PREFERENCES, SUPPORTED_LANGUAGES, type AppPreferences, type SummaryDepth } from '@/lib/app-preferences'
import type { TagNode } from '@/lib/recall-types'

// Spelled out here rather than in lib/app-preferences.ts so the server module
// stays free of UI copy.
const SUMMARY_DEPTH_COPY: Record<SummaryDepth, { label: string; detail: string }> = {
  concise: { label: 'Concise', detail: 'TL;DR plus 4 to 8 key points' },
  detailed: { label: 'Detailed', detail: 'TL;DR, 8 to 14 key points, and per-theme sections' },
  off: { label: 'Off', detail: 'Skip summarization; no notebook is generated' },
}

const ON_OFF = [{ id: 'on' as const, label: 'On' }, { id: 'off' as const, label: 'Off' }]

export default function SettingsPage() {
  const [enriching, setEnriching] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [exportMsg, setExportMsg] = useState<string | null>(null)
  const [tagLoadMsg, setTagLoadMsg] = useState<string | null>(null)
  const [tags, setTags] = useState<TagNode[]>([])
  const [exportTag, setExportTag] = useState('')
  const [readingSize, setReadingSize] = useState<ReadingSize>('regular')
  const [reviewPreferences, setReviewPreferences] = useState<ReviewPreferences>(DEFAULT_REVIEW_PREFERENCES)
  const [ttsVoice, setTtsVoice] = useState<string>(DEFAULT_TTS_VOICE)
  const [sampling, setSampling] = useState(false)
  const [preferences, setPreferences] = useState<AppPreferences>(DEFAULT_PREFERENCES)
  const [preferencesMsg, setPreferencesMsg] = useState<string | null>(null)
  const theme = useTheme()

  useEffect(() => {
    let cancelled = false
    setReadingSize(readReadingSize())
    setReviewPreferences(readReviewPreferences())
    setTtsVoice(readTtsVoice())
    loadTags(() => cancelled)
    loadPreferences(() => cancelled)
    return () => { cancelled = true }
  }, [])

  async function loadPreferences(cancelled: () => boolean = () => false) {
    try {
      const res = await fetch('/api/settings/preferences')
      if (!res.ok) throw new Error('load failed')
      const data = await res.json()
      if (!cancelled() && data?.preferences) setPreferences(data.preferences as AppPreferences)
    } catch {
      // Leave the defaults showing. They are what the server falls back to
      // anyway, so the form is not lying about the effective behavior.
      if (!cancelled()) setPreferencesMsg('Could not load content preferences; showing defaults.')
    }
  }

  // Optimistic: the control moves immediately, and reverts with a message if
  // the write fails. A preference that silently did not save is worse than a
  // control that visibly snaps back.
  async function updatePreferences(patch: Partial<AppPreferences>) {
    const previous = preferences
    setPreferences({ ...preferences, ...patch })
    setPreferencesMsg(null)
    try {
      const res = await fetch('/api/settings/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error('save failed')
      const data = await res.json()
      if (data?.preferences) setPreferences(data.preferences as AppPreferences)
    } catch {
      setPreferences(previous)
      setPreferencesMsg('Could not save that preference. It has been reverted.')
    }
  }

  async function loadTags(cancelled: () => boolean = () => false) {
    setTagLoadMsg(null)
    try {
      const res = await fetch('/api/tags')
      const data = await res.json().catch(() => ({}))
      if (cancelled()) return
      if (!res.ok) {
        setTagLoadMsg(tagFilterLoadMessage(data.error, 'Could not load tag filters.'))
        return
      }
      if (!Array.isArray(data.tags)) {
        setTagLoadMsg(tagFilterLoadMessage(null, 'The local tag API returned an unexpected response.'))
        return
      }
      setTags(data.tags)
    } catch {
      if (cancelled()) return
      setTagLoadMsg(tagFilterLoadMessage(null, 'Could not load tag filters.'))
    }
  }

  async function reenrich() {
    setEnriching(true); setMsg('Running the local model over un-enriched cards…')
    try {
      const res = await fetch('/api/enrich', { method: 'POST' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.ok) {
        setMsg(d.error ? `Enrichment failed: ${d.error}` : 'Enrichment failed. Check that the local model and Recall are still running.')
        return
      }
      if (!isPipelineResult(d)) {
        setMsg('Enrichment returned an unexpected response. Check the local app logs before assuming pending cards finished.')
        return
      }
      setMsg(`Done — processed ${d.processed}, ${d.errors} errors.`)
    } catch {
      setMsg('Could not reach the enrichment API. Check that Recall is still running, then try again.')
    } finally {
      setEnriching(false)
    }
  }

  const flatTags = flattenTags(tags)
  const markdownHref = exportTag
    ? `/api/export/markdown?category=${encodeURIComponent(exportTag)}`
    : '/api/export/markdown'
  function updateReadingSize(size: ReadingSize) {
    setReadingSize(size)
    writeReadingSize(size)
  }

  function updateReviewPreferences(next: ReviewPreferences) {
    setReviewPreferences(next)
    writeReviewPreferences(next)
  }

  async function exportMarkdownFile() {
    setExporting(true)
    setExportMsg('Preparing Markdown export…')
    try {
      const res = await fetch(markdownHref)
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setExportMsg(d.error || 'Markdown export failed.')
        return
      }
      const markdown = await res.text()
      const blobUrl = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = exportTag ? `recall-${exportTag}-export.md` : 'recall-export.md'
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(blobUrl)
      setExportMsg(exportTag ? 'Tag subtree Markdown export downloaded.' : 'Library Markdown export downloaded.')
    } catch {
      setExportMsg('Could not download Markdown export. Check that Recall is still running, then try again.')
    } finally {
      setExporting(false)
    }
  }

  function onVoiceChange(id: string) {
    setTtsVoice(id)
    writeTtsVoice(id)
  }

  function onLanguageChange(lang: string) {
    const first = voicesForLanguage(lang)[0]
    if (first) onVoiceChange(first.id)
  }

  async function playSample() {
    if (sampling) return
    setSampling(true)
    setMsg(null)
    try {
      const res = await fetch('/api/tts/sample', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice: ttsVoice }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error((data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') ? data.error : 'Could not play voice sample')
      }
      const url = URL.createObjectURL(await res.blob())
      const audio = new Audio(url)
      audio.onended = () => URL.revokeObjectURL(url)
      await audio.play()
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Could not play voice sample. Check that the local TTS service is running.')
    } finally {
      setSampling(false)
    }
  }

  return (
    <div className="rr-safe-bottom mx-auto max-w-2xl px-6 md:px-10">
      <header className="flex items-end justify-between pt-10 pb-5 rr-rule">
        <h1 style={{ fontSize: '2.2rem', fontWeight: 500 }}>Settings</h1>
        <Link href="/items" className="rr-mono rr-link">← Library</Link>
      </header>

      <Section title="Account · Data">
        <Row label="Plan" hint="Local desktop build">
          <span className="rr-tag">Local only</span>
        </Row>
        <Row label="Export library" hint="Download all cards, or just one tag subtree, as one Markdown file.">
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            <select
              aria-label="Export tag filter"
              value={exportTag}
              onChange={e => setExportTag(e.target.value)}
              className="rr-select min-w-0 flex-1 sm:flex-none"
            >
              <option value="">All tags</option>
              {flatTags.map(tag => (
                <option key={tag.slug} value={tag.slug}>{tag.label}</option>
              ))}
            </select>
            <button
              type="button"
              className="rr-btn shrink-0"
              disabled={exporting}
              aria-label={exportTag ? 'Export selected tag as Markdown' : 'Export library as Markdown'}
              onClick={exportMarkdownFile}
            >
              {exporting ? 'Exporting…' : 'Export .md'}
            </button>
          </div>
          {exportMsg && <p className="rr-mono mt-2 w-full sm:text-right">{exportMsg}</p>}
          {tagLoadMsg && (
            <div className="mt-2 flex w-full flex-col gap-2 sm:items-end">
              <p className="rr-mono sm:text-right">{tagLoadMsg}</p>
              <button type="button" className="rr-mono rr-link" onClick={() => loadTags()}>Retry tag filters</button>
            </div>
          )}
        </Row>
      </Section>

      <Section title="Intelligence">
        <AiEndpointSettings />
        <Row label="Re-run enrichment" hint="Generate notebooks, summaries, tags, and embeddings for any pending cards.">
          <button
            className="rr-btn"
            disabled={enriching}
            aria-label={enriching ? 'Re-enrichment running' : 'Run re-enrichment now'}
            onClick={reenrich}
          >
            {enriching ? 'Working…' : 'Run now'}
          </button>
        </Row>
        {msg && <p className="rr-mono mt-2">{msg}</p>}
      </Section>

      <Section title="Content">
        <Row
          label="Auto summarization"
          hint="How much notebook to generate for a new card. Off skips the summarization stage entirely."
        >
          <PreferenceRadioGroup
            ariaLabel="Auto summarization"
            value={preferences.autoSummarize}
            options={(['concise', 'detailed', 'off'] as SummaryDepth[]).map(id => ({ id, label: SUMMARY_DEPTH_COPY[id].label }))}
            describeOption={value => SUMMARY_DEPTH_COPY[value].detail}
            onChange={(autoSummarize: SummaryDepth) => updatePreferences({ autoSummarize })}
          />
        </Row>
        <Row label="Auto tagging" hint="Run semantic tagging and categorization on new cards.">
          <PreferenceRadioGroup
            ariaLabel="Auto tagging"
            value={preferences.autoTagging ? 'on' : 'off'}
            options={ON_OFF}
            describeOption={value => value === 'on' ? 'Tag and categorize new cards' : 'Leave new cards untagged'}
            onChange={(value: 'on' | 'off') => updatePreferences({ autoTagging: value === 'on' })}
          />
        </Row>
        <Row label="Auto connections" hint="Link new cards to related cards and extracted entities.">
          <PreferenceRadioGroup
            ariaLabel="Auto connections"
            value={preferences.autoConnections ? 'on' : 'off'}
            options={ON_OFF}
            describeOption={value => value === 'on' ? 'Generate entity links on new cards' : 'Only manual links'}
            onChange={(value: 'on' | 'off') => updatePreferences({ autoConnections: value === 'on' })}
          />
        </Row>
        <Row label="AI language" hint="Language generated notebooks and summaries are written in. Applies to newly enriched cards, not existing ones.">
          <select
            aria-label="AI language"
            className="rr-select"
            value={preferences.aiLanguage}
            onChange={e => updatePreferences({ aiLanguage: e.target.value })}
          >
            {SUPPORTED_LANGUAGES.map(language => (
              <option key={language} value={language}>{language}</option>
            ))}
          </select>
        </Row>
        {preferencesMsg && <p className="rr-mono mt-2">{preferencesMsg}</p>}
      </Section>

      <Section title="Appearance">
        <Row label="Theme" hint="Recall ships dark. Light is remembered on this device.">
          <SegmentedControl
            ariaLabel="Theme"
            options={[
              { label: 'Dark', icon: Moon, active: theme === 'dark', onClick: () => setTheme('dark') },
              { label: 'Light', icon: Sun, active: theme === 'light', onClick: () => setTheme('light') },
            ]}
          />
        </Row>
        <Row label="Reading text size" hint="Applies to Notebook and Reader text on card detail.">
          <PreferenceRadioGroup
            ariaLabel="Reading text size"
            value={readingSize}
            options={READING_SIZES.map(size => ({ id: size.id, label: READING_SIZE_COPY[size.id].label }))}
            describeOption={value => READING_SIZE_COPY[value].detail}
            onChange={updateReadingSize}
          />
        </Row>
      </Section>

      <Section id="quiz" title="Quiz">
        <Row label="Daily review goal" hint="Sets the local target shown in the spaced-repetition review dashboard.">
          <PreferenceRadioGroup
            ariaLabel="Daily review goal"
            value={reviewPreferences.dailyGoal}
            options={DAILY_REVIEW_GOALS}
            describeOption={value => `${value} questions`}
            onChange={(dailyGoal: DailyReviewGoal) => updateReviewPreferences({ ...reviewPreferences, dailyGoal })}
          />
        </Row>
        <Row label="Review session size" hint="Limits each Start review session without changing due dates or hiding the full queue.">
          <PreferenceRadioGroup
            ariaLabel="Review session size"
            value={reviewPreferences.sessionSize}
            options={REVIEW_SESSION_SIZES}
            describeOption={value => value === 'all' ? 'All due questions' : `${value} questions`}
            onChange={(sessionSize: ReviewSessionSize) => updateReviewPreferences({ ...reviewPreferences, sessionSize })}
          />
        </Row>
      </Section>

      <Section title="Text to Speech">
        <Row label="Language" hint="Language/accent for spoken summaries (sets the Kokoro lang_code).">
          <select
            aria-label="Text to speech language"
            title="Language and accent used for local card audio summaries."
            className="rr-select w-full sm:w-56"
            value={languageForVoice(ttsVoice)}
            onChange={e => onLanguageChange(e.target.value)}
          >
            {TTS_LANGUAGES.map(language => (
              <option key={language.code} value={language.code}>{language.label}</option>
            ))}
          </select>
        </Row>
        <Row label="Voice" hint="Voice used for card audio summaries (Notebook → Listen).">
          <select
            aria-label="Text to speech voice"
            title="Voice used for local card audio summaries."
            className="rr-select w-full sm:w-56"
            value={ttsVoice}
            onChange={e => onVoiceChange(e.target.value)}
          >
            {voicesForLanguage(languageForVoice(ttsVoice)).map(voice => (
              <option key={voice.id} value={voice.id}>{voice.label}</option>
            ))}
          </select>
        </Row>
        <Row label="Playback" hint="Preview the selected voice via the local TTS service.">
          <button
            className="rr-btn rr-btn-icon"
            disabled={sampling}
            onClick={() => void playSample()}
            aria-live="polite"
            aria-label={sampling ? 'Playing voice sample' : 'Play a sample in the selected text to speech voice'}
            title="Play a short sample using the selected voice."
          >
            <Volume2 size={14} aria-hidden="true" />
            <span>{sampling ? 'Playing…' : 'Sample'}</span>
          </button>
        </Row>
      </Section>

      <Section title="About">
        <p className="rr-prose" style={{ fontSize: '0.95rem' }}>
          Recall (Reading Room) — a personal AI knowledge base, running fully local on this Mac.
          Summaries, tags and notebooks are generated by your local model.
          Phase 2 adds semantic search, a knowledge graph and chat; Phase 3 adds spaced-repetition review.
        </p>
      </Section>
    </div>
  )
}

function flattenTags(nodes: TagNode[], trail: string[] = []): { slug: string; label: string }[] {
  return nodes.flatMap(node => {
    const path = [...trail, node.name]
    return [
      { slug: node.slug, label: path.join(' / ') },
      ...flattenTags(node.children, path),
    ]
  })
}

function isPipelineResult(value: unknown): value is { ok: true; processed: number; errors: number } {
  return value !== null &&
    typeof value === 'object' &&
    'ok' in value &&
    value.ok === true &&
    'processed' in value &&
    typeof value.processed === 'number' &&
    'errors' in value &&
    typeof value.errors === 'number'
}

function tagFilterLoadMessage(error: unknown, fallback: string): string {
  const base = typeof error === 'string' && error.trim() ? error : fallback
  return `${base} Existing tag choices are preserved; export all cards still works.`
}

type AiProviderOption = {
  id: string
  label: string
  defaultBaseUrl: string
  defaultModel: string
  keyRequired: boolean
}

type AiSettingsDraft = {
  provider: string
  baseUrl: string
  model: string
  apiKeySet: boolean
  embeddingBaseUrl: string
  embeddingModel: string
  embeddingApiKeySet: boolean
  requestTimeoutMs: number
}

function AiEndpointSettings() {
  const [providers, setProviders] = useState<AiProviderOption[]>([])
  const [draft, setDraft] = useState<AiSettingsDraft | null>(null)
  const [chatApiKey, setChatApiKey] = useState('')
  const [embeddingApiKey, setEmbeddingApiKey] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<'chat' | 'embedding' | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadAiSettings().then(result => {
      if (cancelled) return
      setProviders(result.providers)
      setDraft(result.settings)
      setLoading(false)
    }).catch(err => {
      if (cancelled) return
      setMessage(err instanceof Error ? err.message : 'Could not load AI endpoint settings.')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const selectedProvider = providers.find(provider => provider.id === draft?.provider)

  function applyProvider(provider: AiProviderOption) {
    if (!draft) return
    setDraft({
      ...draft,
      provider: provider.id,
      baseUrl: provider.defaultBaseUrl || draft.baseUrl,
      model: provider.defaultModel || draft.model,
      embeddingBaseUrl: draft.embeddingBaseUrl || provider.defaultBaseUrl,
    })
    setMessage(null)
  }

  async function save() {
    if (!draft || saving) return
    setSaving(true)
    setMessage('Saving AI endpoint settings…')
    try {
      const res = await fetch('/api/settings/ai', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: draft.provider,
          baseUrl: draft.baseUrl,
          model: draft.model,
          ...(chatApiKey.trim() ? { apiKey: chatApiKey.trim() } : {}),
          embeddingBaseUrl: draft.embeddingBaseUrl,
          embeddingModel: draft.embeddingModel,
          ...(embeddingApiKey.trim() ? { embeddingApiKey: embeddingApiKey.trim() } : {}),
          requestTimeoutMs: draft.requestTimeoutMs,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(apiSettingsError(data, 'Could not save AI endpoint settings.'))
      if (!isAiSettingsResponse(data)) throw new Error('The AI settings API returned an unexpected response.')
      setProviders(data.providers)
      setDraft(data.settings)
      setChatApiKey('')
      setEmbeddingApiKey('')
      setMessage('AI endpoint settings saved.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save AI endpoint settings.')
    } finally {
      setSaving(false)
    }
  }

  async function clearKey(kind: 'chat' | 'embedding') {
    if (!draft || saving) return
    setSaving(true)
    setMessage(kind === 'chat' ? 'Clearing chat API key…' : 'Clearing embedding API key…')
    try {
      const res = await fetch('/api/settings/ai', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(kind === 'chat' ? { apiKey: null } : { embeddingApiKey: null }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(apiSettingsError(data, 'Could not clear API key.'))
      if (!isAiSettingsResponse(data)) throw new Error('The AI settings API returned an unexpected response.')
      setDraft(data.settings)
      setMessage(kind === 'chat' ? 'Chat API key cleared.' : 'Embedding API key cleared.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not clear API key.')
    } finally {
      setSaving(false)
    }
  }

  async function test(target: 'chat' | 'embedding') {
    if (!draft || testing) return
    setTesting(target)
    setMessage(target === 'chat' ? 'Testing chat endpoint…' : 'Testing embedding endpoint…')
    try {
      const res = await fetch('/api/settings/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target,
          baseUrl: draft.baseUrl,
          model: draft.model,
          apiKey: chatApiKey.trim(),
          embeddingBaseUrl: draft.embeddingBaseUrl,
          embeddingModel: draft.embeddingModel,
          embeddingApiKey: embeddingApiKey.trim(),
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) throw new Error(apiSettingsError(data, target === 'chat' ? 'Chat endpoint test failed.' : 'Embedding endpoint test failed.'))
      setMessage(`${target === 'chat' ? 'Chat' : 'Embedding'} endpoint responded in ${data.ms} ms.`)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Endpoint test failed.')
    } finally {
      setTesting(null)
    }
  }

  if (loading) {
    return (
      <div className="rr-card mb-4 p-4">
        <p className="rr-mono">Loading AI endpoint settings…</p>
      </div>
    )
  }
  if (!draft) {
    return (
      <div className="rr-card mb-4 p-4">
        <p className="rr-mono">{message ?? 'AI endpoint settings are unavailable.'}</p>
      </div>
    )
  }

  return (
    <div className="mb-5 space-y-4">
      <div className="rr-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="rr-mono">Model endpoint</div>
            <h2 className="font-display" style={{ fontSize: '1.15rem', fontWeight: 500 }}>OpenAI-compatible backend</h2>
          </div>
          <span className="rr-tag inline-flex items-center gap-1.5">
            <CheckCircle2 size={13} aria-hidden="true" />
            {selectedProvider?.label ?? 'Custom'}
          </span>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-5" role="radiogroup" aria-label="AI provider preset">
          {providers.map(provider => {
            const selected = provider.id === draft.provider
            return (
              <button
                key={provider.id}
                type="button"
                role="radio"
                aria-checked={selected}
                className="rr-btn rr-btn-icon justify-center"
                style={{
                  background: selected ? 'var(--accent)' : undefined,
                  color: selected ? 'var(--paper)' : undefined,
                }}
                onClick={() => applyProvider(provider)}
              >
                <Server size={14} aria-hidden="true" />
                <span>{provider.label}</span>
              </button>
            )
          })}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <LabeledField label="Chat endpoint">
            <input
              className="rr-input w-full"
              value={draft.baseUrl}
              placeholder="https://host.example/v1"
              onChange={e => setDraft({ ...draft, baseUrl: e.target.value })}
            />
          </LabeledField>
          <LabeledField label="Chat model">
            <input
              className="rr-input w-full"
              value={draft.model}
              placeholder="model name"
              onChange={e => setDraft({ ...draft, model: e.target.value })}
            />
          </LabeledField>
          <LabeledField label="API key">
            <div className="flex gap-2">
              <input
                className="rr-input min-w-0 flex-1"
                type="password"
                value={chatApiKey}
                placeholder={draft.apiKeySet ? 'Configured · leave blank to keep' : selectedProvider?.keyRequired ? 'Required' : 'Optional'}
                onChange={e => setChatApiKey(e.target.value)}
              />
              {draft.apiKeySet && (
                <button type="button" className="rr-btn" onClick={() => void clearKey('chat')} disabled={saving}>Clear</button>
              )}
            </div>
          </LabeledField>
          <LabeledField label="Timeout">
            <div className="flex items-center gap-2">
              <input
                className="rr-input w-28"
                type="number"
                min={5}
                max={300}
                step={5}
                value={Math.round(draft.requestTimeoutMs / 1000)}
                onChange={e => setDraft({ ...draft, requestTimeoutMs: Number(e.target.value) * 1000 })}
              />
              <span className="rr-mono">seconds</span>
            </div>
          </LabeledField>
        </div>
      </div>

      <div className="rr-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="rr-mono">Embeddings</div>
            <h2 className="font-display" style={{ fontSize: '1.05rem', fontWeight: 500 }}>Semantic search vector model</h2>
          </div>
          <span className="rr-tag">Phase 2</span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <LabeledField label="Embedding endpoint">
            <input
              className="rr-input w-full"
              value={draft.embeddingBaseUrl}
              placeholder={draft.baseUrl || 'https://host.example/v1'}
              onChange={e => setDraft({ ...draft, embeddingBaseUrl: e.target.value })}
            />
          </LabeledField>
          <LabeledField label="Embedding model">
            <input
              className="rr-input w-full"
              value={draft.embeddingModel}
              placeholder="nomic-embed-text"
              onChange={e => setDraft({ ...draft, embeddingModel: e.target.value })}
            />
          </LabeledField>
          <LabeledField label="Embedding API key">
            <div className="flex gap-2">
              <input
                className="rr-input min-w-0 flex-1"
                type="password"
                value={embeddingApiKey}
                placeholder={draft.embeddingApiKeySet ? 'Configured · leave blank to keep' : 'Optional'}
                onChange={e => setEmbeddingApiKey(e.target.value)}
              />
              {draft.embeddingApiKeySet && (
                <button type="button" className="rr-btn" onClick={() => void clearKey('embedding')} disabled={saving}>Clear</button>
              )}
            </div>
          </LabeledField>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button className="rr-btn rr-btn-icon" type="button" onClick={() => void save()} disabled={saving}>
          <KeyRound size={14} aria-hidden="true" />
          <span>{saving ? 'Saving…' : 'Save endpoint'}</span>
        </button>
        <button className="rr-btn rr-btn-icon" type="button" onClick={() => void test('chat')} disabled={testing !== null || saving}>
          <TestTube2 size={14} aria-hidden="true" />
          <span>{testing === 'chat' ? 'Testing…' : 'Test chat'}</span>
        </button>
        <button className="rr-btn rr-btn-icon" type="button" onClick={() => void test('embedding')} disabled={testing !== null || saving}>
          <Bot size={14} aria-hidden="true" />
          <span>{testing === 'embedding' ? 'Testing…' : 'Test embeddings'}</span>
        </button>
        <button
          className="rr-btn rr-btn-icon"
          type="button"
          onClick={() => selectedProvider && applyProvider(selectedProvider)}
          disabled={!selectedProvider || saving}
          title="Restore this provider preset's default endpoint and model."
        >
          <RotateCcw size={14} aria-hidden="true" />
          <span>Preset defaults</span>
        </button>
      </div>
      {message && <p className="rr-mono" aria-live="polite">{message}</p>}
    </div>
  )
}

function LabeledField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="rr-mono mb-1 block">{label}</span>
      {children}
    </label>
  )
}

async function loadAiSettings(): Promise<{ providers: AiProviderOption[]; settings: AiSettingsDraft }> {
  const res = await fetch('/api/settings/ai')
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(apiSettingsError(data, 'Could not load AI endpoint settings.'))
  if (!isAiSettingsResponse(data)) throw new Error('The AI settings API returned an unexpected response.')
  return data
}

function isAiSettingsResponse(value: unknown): value is { providers: AiProviderOption[]; settings: AiSettingsDraft } {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  const settings = record.settings as Partial<AiSettingsDraft> | undefined
  return Array.isArray(record.providers) &&
    settings !== undefined &&
    typeof settings.provider === 'string' &&
    typeof settings.baseUrl === 'string' &&
    typeof settings.model === 'string' &&
    typeof settings.embeddingBaseUrl === 'string' &&
    typeof settings.embeddingModel === 'string' &&
    typeof settings.requestTimeoutMs === 'number'
}

function apiSettingsError(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && 'error' in data && typeof (data as { error?: unknown }).error === 'string') {
    return (data as { error: string }).error
  }
  return fallback
}

function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="py-6 rr-rule">
      <div className="rr-mono mb-4" style={{ color: 'var(--gold)' }}>{title}</div>
      {children}
    </section>
  )
}

function Row({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div>
        <div className="font-display" style={{ fontSize: '1.05rem' }}>{label}</div>
        <div className="rr-prose" style={{ fontSize: '0.88rem' }}>{hint}</div>
      </div>
      <div className="w-full sm:w-auto sm:shrink-0">{children}</div>
    </div>
  )
}

function SegmentedControl({
  ariaLabel,
  options,
}: {
  ariaLabel: string
  options: { label: string; icon: LucideIcon; active?: boolean; disabled?: boolean; title?: string; onClick?: () => void }[]
}) {
  return (
    <div className="inline-flex w-full overflow-hidden border sm:w-auto" role="radiogroup" aria-label={ariaLabel} style={{ borderColor: 'var(--hairline)' }}>
      {options.map(option => {
        const Icon = option.icon
        return (
          <button
            key={option.label}
            type="button"
            role="radio"
            aria-checked={option.active === true}
            aria-label={option.label}
            disabled={option.disabled}
            title={option.title}
            onClick={option.onClick}
            className="rr-mono flex flex-1 items-center justify-center gap-1.5 px-3 py-2 sm:flex-none"
            style={{
              background: option.active ? 'var(--accent-fill)' : 'var(--card)',
              color: option.active ? '#ffffff' : 'var(--sepia)',
              opacity: option.disabled ? 0.5 : 1,
            }}
          >
            <Icon size={13} aria-hidden="true" />
            <span>{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}

const READING_SIZE_COPY: Record<ReadingSize, { label: string; detail: string }> = {
  compact: { label: 'Compact', detail: '90%' },
  regular: { label: 'Regular', detail: '100%' },
  large: { label: 'Large', detail: '110%' },
  wide: { label: 'Wide', detail: '120%' },
}

function PreferenceRadioGroup<T extends string | number>({
  ariaLabel,
  value,
  options,
  describeOption,
  onChange,
}: {
  ariaLabel: string
  value: T
  options: { id: T; label: string }[]
  describeOption: (value: T) => string
  onChange: (value: T) => void
}) {
  function controlId(option: T) {
    return `${ariaLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${String(option)}`
  }

  function moveFocus(nextValue: T) {
    window.setTimeout(() => {
      document.getElementById(controlId(nextValue))?.focus()
    }, 0)
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>, current: T) {
    const currentIndex = options.findIndex(option => option.id === current)
    const lastIndex = options.length - 1
    let nextIndex = currentIndex

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextIndex = Math.min(lastIndex, currentIndex + 1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') nextIndex = Math.max(0, currentIndex - 1)
    else if (e.key === 'Home') nextIndex = 0
    else if (e.key === 'End') nextIndex = lastIndex
    else return

    e.preventDefault()
    const next = options[nextIndex]
    onChange(next.id)
    moveFocus(next.id)
  }

  return (
    <div
      className="grid w-full grid-cols-2 overflow-hidden border sm:inline-grid sm:w-auto sm:grid-cols-4"
      role="radiogroup"
      aria-label={ariaLabel}
      style={{ borderColor: 'var(--hairline)' }}
    >
      {options.map(option => {
        const selected = option.id === value
        return (
          <button
            key={String(option.id)}
            id={controlId(option.id)}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`${ariaLabel}: ${describeOption(option.id)}`}
            tabIndex={selected ? 0 : -1}
            className="rr-mono flex min-w-20 flex-col items-center justify-center gap-0.5 px-3 py-2 text-center"
            style={{
              background: selected ? 'var(--accent-fill)' : 'var(--card)',
              color: selected ? '#ffffff' : 'var(--sepia)',
            }}
            onClick={() => onChange(option.id)}
            onKeyDown={e => onKeyDown(e, option.id)}
          >
            <span>{option.label}</span>
            <span style={{ fontSize: '0.72rem', opacity: 0.78 }}>{describeOption(option.id)}</span>
          </button>
        )
      })}
    </div>
  )
}
