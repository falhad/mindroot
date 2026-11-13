import { describe, expect, it } from 'vitest'
import { installNoSuggest, wantsNoSuggest } from '../src/ui/noSuggest'

const make = (html: string) => {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.append(host)
  return host.firstElementChild as HTMLElement
}
const focus = (el: HTMLElement) => el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))

describe('system text suggestions are off in app fields', () => {
  installNoSuggest()

  it('a text field gets the attributes when it gets the focus', () => {
    for (const html of ['<input>', '<input type="search">', '<textarea></textarea>']) {
      const el = make(html)
      focus(el)
      expect([el.getAttribute('autocomplete'), el.getAttribute('autocorrect'), el.getAttribute('autocapitalize'), el.getAttribute('writingsuggestions')]).toEqual(['off', 'off', 'off', 'false'])
    }
  })

  it('a field for long text (data-prose) and non-text inputs are left alone', () => {
    for (const html of ['<textarea data-prose></textarea>', '<input type="checkbox">', '<input type="password">', '<input type="color">', '<button>x</button>']) {
      const el = make(html)
      focus(el)
      expect(el.hasAttribute('autocorrect')).toBe(false)
      expect(wantsNoSuggest(el)).toBe(false)
    }
  })

  it('spell check is not changed', () => {
    const el = make('<input spellcheck="true">')
    focus(el)
    expect(el.getAttribute('spellcheck')).toBe('true')
  })
})
