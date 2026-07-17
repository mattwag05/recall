// Browser-local TTS voice + language choice for card audio summaries. Curated
// subset of Kokoro voices (stable IDs) so Settings needs no live voice-list
// fetch. Kokoro's lang_code is the voice id's first letter.
export type TtsVoice = {
  id: string
  label: string
  lang: string // matches a TtsLanguage.code
}

export type TtsLanguage = {
  code: string   // UI/display id, e.g. 'en-US'
  label: string
  kokoro: string // single-char Kokoro lang_code
}

export const TTS_LANGUAGES: TtsLanguage[] = [
  { code: 'en-US', label: 'English (US)', kokoro: 'a' },
  { code: 'en-GB', label: 'English (UK)', kokoro: 'b' },
  { code: 'es', label: 'Spanish', kokoro: 'e' },
  { code: 'fr', label: 'French', kokoro: 'f' },
  { code: 'it', label: 'Italian', kokoro: 'i' },
  { code: 'pt', label: 'Portuguese (BR)', kokoro: 'p' },
  { code: 'hi', label: 'Hindi', kokoro: 'h' },
  { code: 'ja', label: 'Japanese', kokoro: 'j' },
  { code: 'zh', label: 'Chinese', kokoro: 'z' },
]

export const TTS_VOICES: TtsVoice[] = [
  { id: 'af_heart', label: 'Heart (warm)', lang: 'en-US' },
  { id: 'af_bella', label: 'Bella (female)', lang: 'en-US' },
  { id: 'am_adam', label: 'Adam (male)', lang: 'en-US' },
  { id: 'am_michael', label: 'Michael (male)', lang: 'en-US' },
  { id: 'am_onyx', label: 'Onyx (male)', lang: 'en-US' },
  { id: 'bf_emma', label: 'Emma (female)', lang: 'en-GB' },
  { id: 'bf_alice', label: 'Alice (female)', lang: 'en-GB' },
  { id: 'bm_daniel', label: 'Daniel (male)', lang: 'en-GB' },
  { id: 'bm_george', label: 'George (male)', lang: 'en-GB' },
  { id: 'ef_dora', label: 'Dora (female)', lang: 'es' },
  { id: 'em_alex', label: 'Alex (male)', lang: 'es' },
  { id: 'ff_siwis', label: 'Siwis (female)', lang: 'fr' },
  { id: 'if_sara', label: 'Sara (female)', lang: 'it' },
  { id: 'im_nicola', label: 'Nicola (male)', lang: 'it' },
  { id: 'pf_dora', label: 'Dora (female)', lang: 'pt' },
  { id: 'pm_alex', label: 'Alex (male)', lang: 'pt' },
  { id: 'hf_alpha', label: 'Alpha (female)', lang: 'hi' },
  { id: 'hm_omega', label: 'Omega (male)', lang: 'hi' },
  { id: 'jf_alpha', label: 'Alpha (female)', lang: 'ja' },
  { id: 'jm_kumo', label: 'Kumo (male)', lang: 'ja' },
  { id: 'zf_xiaoxiao', label: 'Xiaoxiao (female)', lang: 'zh' },
  { id: 'zm_yunxi', label: 'Yunxi (male)', lang: 'zh' },
]

export const DEFAULT_TTS_VOICE = TTS_VOICES[0].id

export const TTS_VOICE_KEY = 'recall:tts-voice:v1'

/** True when the id is one of the curated voices (server-side validation too). */
export function isAllowedVoice(id: unknown): id is string {
  return typeof id === 'string' && TTS_VOICES.some(voice => voice.id === id)
}

export function normalizeVoice(id: unknown): string {
  return isAllowedVoice(id) ? id : DEFAULT_TTS_VOICE
}

/** Kokoro lang_code for a voice — its id's first letter (validated voices only). */
export function langCodeForVoice(id: string): string {
  return isAllowedVoice(id) ? id[0] : DEFAULT_TTS_VOICE[0]
}

/** The UI language code (e.g. 'en-GB') a voice belongs to. */
export function languageForVoice(id: string): string {
  return TTS_VOICES.find(voice => voice.id === id)?.lang ?? TTS_VOICES[0].lang
}

export function voicesForLanguage(lang: string): TtsVoice[] {
  return TTS_VOICES.filter(voice => voice.lang === lang)
}

export function readTtsVoice(): string {
  if (typeof window === 'undefined') return DEFAULT_TTS_VOICE
  try {
    return normalizeVoice(localStorage.getItem(TTS_VOICE_KEY))
  } catch {
    return DEFAULT_TTS_VOICE
  }
}

export function writeTtsVoice(id: string) {
  try {
    localStorage.setItem(TTS_VOICE_KEY, normalizeVoice(id))
  } catch {}
}
