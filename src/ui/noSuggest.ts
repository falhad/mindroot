/**
 * Stops the text helpers of the system (macOS inline predictions, the completion list, auto-correction)
 * in the fields of the app. Their pop-up takes the arrow keys and Enter, which the command palette,
 * the search fields and the node editor need for themselves.
 *
 * A field for long text keeps the helpers: mark it with `data-prose`.
 * Spell check is not changed here; each field sets `spellCheck` itself.
 */
const ATTRS: [string, string][] = [
  ['autocomplete', 'off'],
  ['autocorrect', 'off'],
  ['autocapitalize', 'off'],
  ['writingsuggestions', 'false'], // inline predictions (Safari 18 and the macOS web view)
]

const TEXT_TYPES = new Set(['', 'text', 'search', 'url', 'email', 'tel'])

export function wantsNoSuggest(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement) || el.hasAttribute('data-prose')) return false
  if (el instanceof HTMLInputElement) return TEXT_TYPES.has((el.getAttribute('type') ?? '').toLowerCase())
  return el instanceof HTMLTextAreaElement || el.isContentEditable === true
}

/** Call once at start. Fields get the attributes when they receive the focus, before the first key. */
export function installNoSuggest(root: Document = document) {
  root.addEventListener(
    'focusin',
    (e) => {
      const el = e.target as Element | null
      if (!wantsNoSuggest(el)) return
      for (const [name, value] of ATTRS) if (el.getAttribute(name) !== value) el.setAttribute(name, value)
    },
    true,
  )
}
