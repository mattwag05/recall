export type ReadingSize = 'compact' | 'regular' | 'large' | 'wide'

export const READING_SIZE_KEY = 'recall:reading-size:v1'

export const READING_SIZES: { id: ReadingSize; label: string; scale: number }[] = [
  { id: 'compact', label: '90%', scale: 0.94 },
  { id: 'regular', label: '100%', scale: 1 },
  { id: 'large', label: '110%', scale: 1.1 },
  { id: 'wide', label: '120%', scale: 1.2 },
]

export function readReadingSize(): ReadingSize {
  if (typeof window === 'undefined') return 'regular'
  try {
    const value = localStorage.getItem(READING_SIZE_KEY)
    return READING_SIZES.some(size => size.id === value) ? (value as ReadingSize) : 'regular'
  } catch {
    return 'regular'
  }
}

export function writeReadingSize(size: ReadingSize) {
  try { localStorage.setItem(READING_SIZE_KEY, size) } catch {}
}
