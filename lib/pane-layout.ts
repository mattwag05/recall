// Two-pane card-detail layout: which tab each pane shows, and whether the right
// (AI) pane is open. Persisted the same way lib/reading-preferences.ts is.
//
// Invariant: the two panes never show the same tab. Picking a tab the other pane
// already holds moves that pane to the first free tab, so the disabled state in
// the tab strip can be a straight "the other pane has it" check.

export type CardTab = 'notebook' | 'reader' | 'chat' | 'quiz' | 'connections' | 'graph'
export type PaneSide = 'left' | 'right'

export const CARD_TABS: { id: CardTab; label: string; title: string }[] = [
  { id: 'notebook', label: 'Notebook', title: 'The editable AI summary for this card.' },
  { id: 'chat', label: 'Chat', title: 'Card chat uses local RAG over the current card and selected Recall context with cited saved-card sources.' },
  { id: 'reader', label: 'Reader', title: 'The extracted article text or transcript for this card.' },
  { id: 'quiz', label: 'Quiz', title: 'Generate or create short-answer questions, run a local card quiz, and update review scheduling from self-graded answers.' },
  { id: 'connections', label: 'Connections', title: 'Related cards, manual links, generated local entity links, backlinks, and return links.' },
  { id: 'graph', label: 'Graph', title: 'The graph visualizes related cards, multi-hop local connections, generated entity links, filters, fit, and fullscreen controls.' },
]

export const PANE_LAYOUT_KEY = 'recall:card-panes:v1'

export interface PaneLayout {
  left: CardTab
  right: CardTab
  rightHidden: boolean
}

export const DEFAULT_PANE_LAYOUT: PaneLayout = { left: 'notebook', right: 'chat', rightHidden: false }

export function parseCardTab(value: unknown): CardTab | null {
  return CARD_TABS.some(tab => tab.id === value) ? value as CardTab : null
}

export function parsePaneLayout(raw: string | null): PaneLayout {
  if (!raw) return DEFAULT_PANE_LAYOUT
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return DEFAULT_PANE_LAYOUT
  }
  if (!parsed || typeof parsed !== 'object') return DEFAULT_PANE_LAYOUT
  const record = parsed as Record<string, unknown>
  const left = parseCardTab(record.left) ?? DEFAULT_PANE_LAYOUT.left
  const right = parseCardTab(record.right) ?? DEFAULT_PANE_LAYOUT.right
  const rightHidden = record.rightHidden === true
  // A stored layout with both panes on one tab predates the invariant (or was
  // hand-edited); repair it rather than rendering a duplicate.
  return left === right
    ? { left, right: firstFreeTab([left]), rightHidden }
    : { left, right, rightHidden }
}

export function serializePaneLayout(layout: PaneLayout): string {
  return JSON.stringify({ left: layout.left, right: layout.right, rightHidden: layout.rightHidden })
}

export function readPaneLayout(): PaneLayout {
  if (typeof window === 'undefined') return DEFAULT_PANE_LAYOUT
  try {
    return parsePaneLayout(localStorage.getItem(PANE_LAYOUT_KEY))
  } catch {
    return DEFAULT_PANE_LAYOUT
  }
}

export function writePaneLayout(layout: PaneLayout) {
  try { localStorage.setItem(PANE_LAYOUT_KEY, serializePaneLayout(layout)) } catch {}
}

/**
 * Show `tab` in `pane`. If the other pane already held it the two swap, which
 * both keeps the invariant and is what a drag between panes would do.
 */
export function selectPaneTab(layout: PaneLayout, pane: PaneSide, tab: CardTab): PaneLayout {
  const other: PaneSide = pane === 'left' ? 'right' : 'left'
  if (layout[pane] === tab) return layout
  const next: PaneLayout = { ...layout, [pane]: tab }
  if (next[other] === tab) next[other] = layout[pane]
  return next
}

/**
 * True when the tab is unavailable in this pane because the other, visible pane
 * is already showing it. With one pane on screen nothing is locked.
 */
export function isTabLocked(layout: PaneLayout, pane: PaneSide, tab: CardTab, twoPane: boolean): boolean {
  if (!twoPane) return false
  const other: PaneSide = pane === 'left' ? 'right' : 'left'
  return layout[other] === tab
}

/** The tabs this pane can move to with the keyboard, in strip order. */
export function selectableTabs(layout: PaneLayout, pane: PaneSide, twoPane: boolean): CardTab[] {
  return CARD_TABS.map(tab => tab.id).filter(id => !isTabLocked(layout, pane, id, twoPane))
}

function firstFreeTab(taken: CardTab[]): CardTab {
  return CARD_TABS.map(tab => tab.id).find(id => !taken.includes(id)) ?? DEFAULT_PANE_LAYOUT.right
}
