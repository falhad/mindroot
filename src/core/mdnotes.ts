/**
 * Node notes as Markdown: headings, lists, links, code with highlighting, and LaTeX math.
 *
 * The output is always passed through DOMPurify, so notes (which may come from a synced vault
 * or an imported file) cannot run scripts. KaTeX and highlight.js load on first use, so maps
 * without math or code do not pay for them.
 */
import DOMPurify from 'dompurify'
import { marked } from 'marked'

const OPEN = ''
const CLOSE = ''

let hookAdded = false
function ensureHook() {
  if (hookAdded) return
  hookAdded = true
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('rel', 'noopener noreferrer')
      node.setAttribute('target', '_blank')
    }
    // text direction follows the first strong character, so Persian and English both read correctly
    if (/^(P|LI|H[1-6]|BLOCKQUOTE|TD|TH)$/.test(node.tagName)) node.setAttribute('dir', 'auto')
  })
}

interface MathPart {
  tex: string
  display: boolean
}

/** Replace `$$…$$` and `$…$` outside code with placeholders. A price like "$5 and $10" is not math. */
function extractMath(md: string): { text: string; parts: MathPart[] } {
  const parts: MathPart[] = []
  const take = (tex: string, display: boolean) => {
    parts.push({ tex: tex.trim(), display })
    return `${OPEN}${parts.length - 1}${CLOSE}`
  }
  const text = md
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((seg, i) => {
      if (i % 2 === 1) return seg // code: leave alone
      return seg
        .replace(/\$\$([\s\S]+?)\$\$/g, (_, t: string) => take(t, true))
        .replace(/(?<![\\$\w])\$(?!\s)([^$\n]+?)(?<!\s)\$(?![\w$])/g, (_, t: string) => take(t, false))
    })
    .join('')
  return { text, parts }
}

type Hljs = typeof import('highlight.js/lib/core').default
let hljsPromise: Promise<Hljs> | null = null

function loadHighlighter(): Promise<Hljs> {
  hljsPromise ??= (async () => {
    const core = (await import('highlight.js/lib/core')).default
    const langs: [string, () => Promise<{ default: any }>][] = [
      ['javascript', () => import('highlight.js/lib/languages/javascript')],
      ['typescript', () => import('highlight.js/lib/languages/typescript')],
      ['python', () => import('highlight.js/lib/languages/python')],
      ['rust', () => import('highlight.js/lib/languages/rust')],
      ['json', () => import('highlight.js/lib/languages/json')],
      ['bash', () => import('highlight.js/lib/languages/bash')],
      ['css', () => import('highlight.js/lib/languages/css')],
      ['xml', () => import('highlight.js/lib/languages/xml')],
      ['sql', () => import('highlight.js/lib/languages/sql')],
      ['kotlin', () => import('highlight.js/lib/languages/kotlin')],
      ['yaml', () => import('highlight.js/lib/languages/yaml')],
      ['markdown', () => import('highlight.js/lib/languages/markdown')],
      ['go', () => import('highlight.js/lib/languages/go')],
      ['java', () => import('highlight.js/lib/languages/java')],
      ['cpp', () => import('highlight.js/lib/languages/cpp')],
    ]
    for (const [name, load] of langs) core.registerLanguage(name, (await load()).default)
    core.registerAliases(['ts', 'tsx'], { languageName: 'typescript' })
    core.registerAliases(['js', 'jsx', 'mjs'], { languageName: 'javascript' })
    core.registerAliases(['py'], { languageName: 'python' })
    core.registerAliases(['rs'], { languageName: 'rust' })
    core.registerAliases(['sh', 'shell', 'zsh'], { languageName: 'bash' })
    core.registerAliases(['html'], { languageName: 'xml' })
    core.registerAliases(['yml'], { languageName: 'yaml' })
    core.registerAliases(['kt'], { languageName: 'kotlin' })
    return core
  })()
  return hljsPromise
}

/**
 * Markdown to safe HTML. Empty or blank text gives an empty string.
 *
 * Order matters: Markdown, then code highlighting and math are put into the page, and DOMPurify
 * runs LAST over everything. Nothing is changed after sanitizing.
 */
export async function renderNotes(md: string): Promise<string> {
  if (!md.trim()) return ''
  ensureHook()
  // the placeholder characters are private to this function: remove them from the input first
  const { text, parts } = extractMath(md.replace(/[\uE000\uE001]/g, ''))
  const raw = marked.parse(text, { async: false, gfm: true, breaks: true }) as string

  // an inert document (DOMParser runs no scripts and loads nothing); its output is sanitized below
  const doc = new DOMParser().parseFromString(`<body>${raw}</body>`, 'text/html')
  const blocks = [...doc.body.querySelectorAll('pre code')].filter((c) => /language-/.test(c.className))
  if (blocks.length) {
    const hljs = await loadHighlighter()
    for (const code of blocks) {
      const lang = /language-([\w+-]+)/.exec(code.className)?.[1] ?? ''
      if (!hljs.getLanguage(lang)) continue
      code.innerHTML = hljs.highlight(code.textContent ?? '', { language: lang, ignoreIllegals: true }).value
      code.classList.add('hljs')
    }
  }

  let html = doc.body.innerHTML
  if (parts.length) {
    const katex = (await import('katex')).default
    html = html.replace(new RegExp(`${OPEN}(\\d+)${CLOSE}`, 'g'), (_whole, i: string) => {
      const part = parts[Number(i)]
      if (!part) return ''
      try {
        return katex.renderToString(part.tex, { displayMode: part.display, throwOnError: true, output: 'html', trust: false })
      } catch {
        const src = part.display ? `$$${part.tex}$$` : `$${part.tex}$`
        return `<code>${src.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code>`
      }
    })
  }
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true, svg: true } })
}
