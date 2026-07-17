import { useEffect, type RefObject } from 'react'

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'textarea:not([disabled])', 'select:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',')

// Track the last element focused OUTSIDE any dialog, so we can restore focus to
// the real trigger after a modal closes — a modal's own autoFocus fires during
// React commit (before our effect), so capturing activeElement on open is too late.
let lastExternalFocus: HTMLElement | null = null
if (typeof document !== 'undefined') {
  document.addEventListener('focusin', e => {
    const t = e.target as HTMLElement | null
    if (t && t !== document.body && !t.closest('[role="dialog"]')) lastExternalFocus = t
  }, true)
}

function focusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter(el => el.offsetParent !== null || el === document.activeElement)
}

/**
 * Modal focus management: when `active`, focus the first focusable element in
 * `ref` (unless something inside already has focus — preserves autoFocus), trap
 * Tab/Shift+Tab within the dialog, and restore focus to the triggering element
 * (the last focus outside any dialog) on close.
 */
export function useDialogFocus(active: boolean, ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active) return
    const root = ref.current
    if (!root) return

    // Prefer the currently-focused element if it's still outside the dialog
    // (e.g. modals that focus their input via a timeout). If a modal's autoFocus
    // attribute already moved focus inside during commit, fall back to the last
    // focus tracked outside any dialog.
    const focused = document.activeElement as HTMLElement | null
    const opener = focused && focused !== document.body && !root.contains(focused)
      ? focused
      : lastExternalFocus

    // Focus the first control only if focus isn't already inside the dialog.
    if (!root.contains(document.activeElement)) {
      window.setTimeout(() => focusable(root)[0]?.focus(), 0)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const items = focusable(root)
      if (items.length === 0) { e.preventDefault(); return }
      const first = items[0]
      const last = items[items.length - 1]
      const current = document.activeElement
      if (e.shiftKey && current === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && current === last) { e.preventDefault(); first.focus() }
      else if (!root.contains(current)) { e.preventDefault(); first.focus() }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      // Restore focus to the trigger if it's still in the document.
      if (opener && document.contains(opener)) opener.focus()
    }
  }, [active, ref])
}
