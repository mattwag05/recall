export const AI_PROVIDER_OPTIONS = [
  { id: 'ollama', label: 'Ollama', defaultBaseUrl: 'http://127.0.0.1:11434/v1', defaultModel: 'gemma4:latest', keyRequired: false },
  { id: 'lmstudio', label: 'LM Studio', defaultBaseUrl: 'http://127.0.0.1:1234/v1', defaultModel: 'local-model', keyRequired: false },
  { id: 'omlx', label: 'Local LLM', defaultBaseUrl: 'http://localhost:8000/v1', defaultModel: 'Qwen3.6-35B-A3B-4bit', keyRequired: true },
  { id: 'openrouter', label: 'OpenRouter', defaultBaseUrl: 'https://openrouter.ai/api/v1', defaultModel: '', keyRequired: true },
  { id: 'custom', label: 'OpenAI-compatible', defaultBaseUrl: '', defaultModel: '', keyRequired: false },
] as const

export type AiProvider = typeof AI_PROVIDER_OPTIONS[number]['id']

export function normalizeAiProvider(value: string | null | undefined): AiProvider {
  const normalized = (value ?? '').trim().toLowerCase()
  return AI_PROVIDER_OPTIONS.some(option => option.id === normalized)
    ? normalized as AiProvider
    : 'custom'
}

export function providerDefaults(provider: AiProvider) {
  return AI_PROVIDER_OPTIONS.find(option => option.id === provider) ?? AI_PROVIDER_OPTIONS[AI_PROVIDER_OPTIONS.length - 1]
}

export function providerNeedsKey(provider: AiProvider): boolean {
  return providerDefaults(provider).keyRequired
}
