'use client'

import { useSyncExternalStore } from 'react'

export type Theme = 'dark' | 'light'

export const THEME_KEY = 'recall:theme'
const THEME_EVENT = 'recall-theme-change'

// Runs in <head> before first paint so a stored light theme never flashes dark.
// Kept as a string because it has to be inlined into the document, not bundled.
export const THEME_INIT_SCRIPT = `try{if(localStorage.getItem('${THEME_KEY}')==='light')document.documentElement.dataset.theme='light'}catch(e){}`

function read(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(THEME_EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(THEME_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

export function useTheme(): Theme {
  // Server renders the default; the pre-paint script has already applied the
  // stored value to <html>, so there is nothing to correct visually.
  return useSyncExternalStore(subscribe, read, () => 'dark')
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {}
  if (theme === 'light') document.documentElement.dataset.theme = 'light'
  else delete document.documentElement.dataset.theme
  window.dispatchEvent(new CustomEvent(THEME_EVENT))
}
