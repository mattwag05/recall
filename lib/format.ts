// Display helpers that were duplicated across import routes and components.

/** Card title with the first 120 chars of body text as a fallback. */
export function cardTitle(title: string | null, text: string, fallback = 'Untitled'): string {
  return title || text.slice(0, 120) || fallback
}

/**
 * Exact size for stated limits — "8 MB", "512 KB". Only divides when it comes
 * out whole, so a configured cap never renders as "8.0 MB".
 * For arbitrary file sizes use formatFileSize.
 */
export function formatBytes(bytes: number): string {
  if (bytes % (1024 * 1024) === 0) return `${bytes / (1024 * 1024)} MB`
  if (bytes % 1024 === 0) return `${bytes / 1024} KB`
  return `${bytes} B`
}

/** Rounded size for real files — "1.4 MB", "37 KB". */
export function formatFileSize(size: number | null): string {
  if (size === null) return 'unknown size'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
