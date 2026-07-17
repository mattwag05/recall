'use client'

import { useEffect, useState } from 'react'

interface Toast { id: number; message: string }

/** Fire a toast from anywhere (client-side). */
export function toast(message: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('rr-toast', { detail: message }))
}

let _seq = 0

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    const onToast = (e: Event) => {
      const message = (e as CustomEvent<string>).detail
      const id = ++_seq
      setToasts(t => [...t, { id, message }])
      setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2600)
    }
    window.addEventListener('rr-toast', onToast)
    return () => window.removeEventListener('rr-toast', onToast)
  }, [])

  return (
    <div
      aria-live="polite"
      role="status"
      className="fixed bottom-6 left-1/2 z-[60] flex flex-col items-center gap-2"
      style={{ transform: 'translateX(-50%)', pointerEvents: 'none' }}
    >
      {toasts.map(t => (
        <div
          key={t.id}
          className="rr-rise"
          style={{
            background: 'var(--ink)',
            color: 'var(--paper)',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.72rem',
            letterSpacing: '0.06em',
            padding: '0.55rem 1rem',
            borderRadius: 3,
            boxShadow: '0 6px 22px rgba(40,30,20,0.25)',
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  )
}
