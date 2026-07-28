/**
 * True when a keystroke landed somewhere the user is typing or operating a
 * control, so single-key shortcuts must not hijack it. Shared by the library
 * ("/" and "n") and the inbox (n/p/a/s/r/e).
 */
export function isShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return !!target.closest('input, textarea, select, button, a, [role="button"], [contenteditable="true"]')
}
