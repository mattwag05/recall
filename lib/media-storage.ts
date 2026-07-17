import { mkdir, stat, unlink, writeFile } from 'fs/promises'
import path from 'path'

export const MEDIA_ROOT = path.join(process.cwd(), 'public', 'media')

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export function extensionForImageMime(mimeType: string): string {
  return MIME_EXTENSIONS[mimeType] ?? 'bin'
}

export function mediaLocalPath(kind: 'images', hash: string, extension: string): string {
  return path.join(kind, `${hash}.${extension}`)
}

export function resolveMediaPath(localPath: string): string | null {
  const parts = localPath.split(/[\\/]/).filter(Boolean)
  if (path.isAbsolute(localPath) || parts.length === 0 || parts.includes('..')) return null
  return path.join(process.cwd(), 'public', 'media', ...parts)
}

export async function saveMediaFile(localPath: string, data: Uint8Array): Promise<void> {
  const resolved = resolveMediaPath(localPath)
  if (!resolved) throw new Error('Invalid media path')
  try {
    await stat(resolved)
    return
  } catch {}
  await mkdir(path.dirname(resolved), { recursive: true })
  await writeFile(resolved, data)
}

export async function deleteMediaFile(localPath: string): Promise<void> {
  const resolved = resolveMediaPath(localPath)
  if (!resolved) return
  try {
    await unlink(resolved)
  } catch {}
}
