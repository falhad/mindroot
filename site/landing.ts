// The landing page of mindroot.app. The page is complete without this script (text, links, images);
// the script adds motion, the animated map in the hero, and the download links for this computer.
import '@fontsource-variable/inter'
import '@fontsource-variable/vazirmatn'
import './landing.css'
import { downloads, installSteps, OS_NAMES, primaryDownload, type DesktopOs } from '../src/core/download'
import { latestReleaseVersion, visitorArch, visitorOs } from '../src/io/release'

const root = document.documentElement
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches
const $ = <T extends Element>(sel: string, from: ParentNode = document) => from.querySelector<T>(sel)
const $$ = <T extends Element>(sel: string, from: ParentNode = document) => Array.from(from.querySelectorAll<T>(sel))
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function start() {
  reveal()
  scrollEffects()
  spotlight()
  counters()
  tour()
  themeToggle()
  faq()
  heroDemo()
  void downloadLinks()
}

/* ---------- Scroll reveal ---------- */
function reveal() {
  const items = $$<HTMLElement>('[data-reveal]')
  if (calm || !('IntersectionObserver' in window)) return items.forEach((el) => el.classList.add('in'))
  // Neighbours come in one after the other.
  const seen = new Map<Element, number>()
  for (const el of items) {
    const parent = el.parentElement!
    const i = seen.get(parent) ?? 0
    el.style.setProperty('--i', String(Math.min(i, 7)))
    seen.set(parent, i + 1)
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue
      e.target.classList.add('in')
      io.unobserve(e.target)
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 })
  items.forEach((el) => io.observe(el))
  const steps = $<HTMLElement>('[data-steps]')
  if (steps) {
    const so = new IntersectionObserver(([e]) => { if (e.isIntersecting) { steps.style.setProperty('--steps', '1'); so.disconnect() } }, { threshold: 0.5 })
    so.observe(steps)
  }
}

/* ---------- Top bar, progress line, tilt of the demo window ---------- */
function scrollEffects() {
  const nav = $<HTMLElement>('[data-nav]')
  const stage = $<HTMLElement>('[data-tilt]')
  let queued = false
  const update = () => {
    queued = false
    const y = scrollY
    nav?.classList.toggle('stuck', y > 12)
    const max = document.documentElement.scrollHeight - innerHeight
    root.style.setProperty('--scroll', String(max > 0 ? clamp(y / max, 0, 1) : 0))
    if (stage && !calm) {
      // The window lies back at first and stands up while it moves to the middle of the screen.
      const top = stage.getBoundingClientRect().top
      stage.style.setProperty('--tilt', (clamp((top - innerHeight * 0.18) / (innerHeight * 0.6), 0, 1) * 14).toFixed(2))
    }
  }
  addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update) } }, { passive: true })
  addEventListener('resize', update)
  update()
}

/* ---------- A soft light that follows the pointer on cards ---------- */
function spotlight() {
  if (!matchMedia('(hover: hover)').matches) return
  for (const el of $$<HTMLElement>('[data-spot]')) {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect()
      el.style.setProperty('--mx', `${e.clientX - r.left}px`)
      el.style.setProperty('--my', `${e.clientY - r.top}px`)
    })
  }
}

/* ---------- Numbers that count up ---------- */
function counters() {
  const items = $$<HTMLElement>('[data-count]')
  if (calm || !('IntersectionObserver' in window)) return
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue
      io.unobserve(e.target)
      const el = e.target as HTMLElement
      const to = Number(el.dataset.count)
      if (!to) continue
      const t0 = performance.now()
      const tick = (t: number) => {
        const p = clamp((t - t0) / 1100, 0, 1)
        el.textContent = String(Math.round(to * (1 - Math.pow(1 - p, 3))))
        if (p < 1) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }
  }, { threshold: 0.6 })
  items.forEach((el) => io.observe(el))
}

/* ---------- The tour: tabs with screenshots that advance on their own ---------- */
function tour() {
  const box = $<HTMLElement>('[data-tour]')
  if (!box) return
  const tabs = $$<HTMLButtonElement>('[role=tab]', box)
  const shots = $$<HTMLElement>('.shot', box)
  const DWELL = 5200
  let at = 0
  let timer = 0
  let auto = !calm
  shots.forEach((s) => s.removeAttribute('hidden')) // the panels cross-fade; CSS keeps the others out of the way

  const show = (i: number, focus = false) => {
    at = (i + tabs.length) % tabs.length
    tabs.forEach((t, n) => {
      t.setAttribute('aria-selected', String(n === at))
      t.tabIndex = n === at ? 0 : -1
    })
    shots.forEach((s, n) => { s.classList.toggle('on', n === at); s.setAttribute('aria-hidden', String(n !== at)) })
    if (focus) tabs[at].focus()
    // On a phone the tabs are one row that scrolls sideways. Move the row only, never the page.
    const row = tabs[at].parentElement!
    row.scrollTo({ left: tabs[at].offsetLeft - row.clientWidth / 2 + tabs[at].clientWidth / 2, behavior: calm ? 'auto' : 'smooth' })
    plan()
  }
  const plan = () => {
    clearTimeout(timer)
    box.classList.toggle('auto', auto)
    if (auto && !box.classList.contains('paused')) timer = window.setTimeout(() => show(at + 1), DWELL)
  }
  box.style.setProperty('--dwell', `${DWELL}ms`)
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => { auto = false; show(i) }) // the reader took over
    t.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0
      if (!step) return
      e.preventDefault()
      auto = false
      show(at + step, true)
    })
  })
  const pause = (on: boolean) => { box.classList.toggle('paused', on); plan() }
  box.addEventListener('pointerenter', () => pause(true))
  box.addEventListener('pointerleave', () => pause(false))
  box.addEventListener('focusin', () => pause(true))
  box.addEventListener('focusout', () => pause(false))
  // Run only while the tour is on the screen.
  if ('IntersectionObserver' in window) {
    box.classList.add('paused')
    new IntersectionObserver(([e]) => pause(!e.isIntersecting), { threshold: 0.35 }).observe(box)
  }
  show(0)
}

/* ---------- Light and dark. The choice is the same one the app uses. ---------- */
function themeToggle() {
  const btn = $<HTMLButtonElement>('[data-theme-toggle]')
  if (!btn) return
  btn.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark'
    const apply = () => {
      root.dataset.theme = next
      try { localStorage.setItem('mr.theme', next) } catch { /* private window: the choice lasts for this page */ }
    }
    const r = btn.getBoundingClientRect()
    root.style.setProperty('--vx', `${r.left + r.width / 2}px`)
    root.style.setProperty('--vy', `${r.top + r.height / 2}px`)
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown }
    if (doc.startViewTransition && !calm) doc.startViewTransition(apply)
    else apply()
  })
}

/* ---------- Questions open with a soft slide ---------- */
function faq() {
  if (calm) return
  for (const d of $$<HTMLDetailsElement>('.faq details, .platform details')) {
    d.addEventListener('toggle', () => {
      const body = d.querySelector<HTMLElement>(':scope > :not(summary)')
      if (!d.open || !body) return
      body.animate([{ height: '0px', opacity: 0 }, { height: `${body.scrollHeight}px`, opacity: 1 }], { duration: 320, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' })
    })
  }
}

/* ---------- Download links for this computer ---------- */
async function downloadLinks() {
  const isDesktop = (os: string): os is DesktopOs => os === 'mac' || os === 'windows' || os === 'linux'
  if (isDesktop(visitorOs)) $(`.platform[data-os="${visitorOs}"]`)?.classList.add('here')
  const [version, arch] = await Promise.all([latestReleaseVersion(), visitorArch()])
  const list = downloads(version)

  for (const el of $$('[data-version]')) el.textContent = `Version ${version}`
  for (const el of $$('[data-version-text]')) el.textContent = `Version ${version}`

  const main = primaryDownload(list, visitorOs, arch)
  for (const a of $$<HTMLAnchorElement>('[data-download-main]')) {
    const label = $('[data-download-label]', a)
    if (main) {
      a.href = main.url
      a.setAttribute('download', '')
      if (label) label.textContent = `Download for ${OS_NAMES[main.os]}`
      a.title = `${main.file} · ${main.label}`
    } else if (a.closest('.hero')) {
      a.href = '#download' // a phone or an unknown system: show all files
    }
  }

  for (const os of ['mac', 'windows', 'linux'] as const) {
    const ul = $<HTMLUListElement>(`[data-files="${os}"]`)
    if (ul) {
      ul.replaceChildren(...list.filter((d) => d.os === os).map((d) => {
        const li = document.createElement('li')
        const a = document.createElement('a')
        a.href = d.url
        a.setAttribute('download', '')
        const text = document.createElement('span')
        text.textContent = d.label
        const small = document.createElement('small')
        small.textContent = d.detail
        text.append(small)
        a.append(text)
        li.append(a)
        return li
      }))
    }
    const ol = $<HTMLOListElement>(`[data-steps-for="${os}"]`)
    if (ol) {
      ol.replaceChildren(...installSteps(os).map((s) => {
        const li = document.createElement('li')
        li.textContent = s.text
        if (s.code) { const code = document.createElement('code'); code.textContent = s.code; li.append(code) }
        return li
      }))
    }
  }
}

/* ---------- The hero: a mind map that builds itself, with the keys that make it ---------- */
interface DemoNode { id: string; text: string; x: number; y: number; parent?: string; color: string; ai?: boolean }
type Step = { key?: string; add?: string; select?: string; palette?: string; wait?: number }
interface Scene { w: number; h: number; font: number; nodes: DemoNode[]; steps: Step[] }

const WIDE: Scene = {
  w: 960, h: 540, font: 15,
  nodes: [
    { id: 'root', text: 'Product launch', x: 480, y: 270, color: 'var(--accent)' },
    { id: 'research', text: 'Research', x: 690, y: 130, parent: 'root', color: 'var(--b1)' },
    { id: 'design', text: 'Design', x: 690, y: 270, parent: 'root', color: 'var(--b2)' },
    { id: 'release', text: 'Release', x: 690, y: 410, parent: 'root', color: 'var(--b3)' },
    { id: 'marketing', text: 'Marketing', x: 268, y: 170, parent: 'root', color: 'var(--b4)' },
    { id: 'pricing', text: 'Pricing', x: 276, y: 380, parent: 'root', color: 'var(--b5)' },
    { id: 'interviews', text: 'User interviews', x: 868, y: 92, parent: 'research', color: 'var(--b1)' },
    { id: 'rivals', text: 'Competitors', x: 856, y: 164, parent: 'research', color: 'var(--b1)' },
    { id: 'beta', text: 'Beta test', x: 848, y: 376, parent: 'release', color: 'var(--b3)' },
    { id: 'day', text: 'Launch day', x: 854, y: 446, parent: 'release', color: 'var(--b3)' },
    { id: 'news', text: 'Newsletter', x: 96, y: 104, parent: 'marketing', color: 'var(--b4)', ai: true },
    { id: 'post', text: 'Launch post', x: 96, y: 170, parent: 'marketing', color: 'var(--b4)', ai: true },
    { id: 'partners', text: 'Partners', x: 96, y: 236, parent: 'marketing', color: 'var(--b4)', ai: true },
  ],
  steps: [
    { add: 'root', wait: 700 },
    { key: 'Tab', add: 'research' }, { key: 'Enter', add: 'design' }, { key: 'Enter', add: 'release' },
    { key: 'Enter', add: 'marketing' }, { key: 'Enter', add: 'pricing' },
    { key: '↑', select: 'research', wait: 350 }, { key: 'Tab', add: 'interviews' }, { key: 'Enter', add: 'rivals' },
    { key: '↓', select: 'release', wait: 350 }, { key: 'Tab', add: 'beta' }, { key: 'Enter', add: 'day' },
    { key: '←', select: 'marketing', wait: 450 },
    { key: '⌘ K', palette: 'ai expand', wait: 500 },
    { add: 'news', wait: 140 }, { add: 'post', wait: 140 }, { add: 'partners', wait: 400 },
  ],
}

const NARROW: Scene = {
  w: 560, h: 420, font: 19,
  nodes: [
    { id: 'root', text: 'Launch', x: 280, y: 210, color: 'var(--accent)' },
    { id: 'research', text: 'Research', x: 452, y: 90, parent: 'root', color: 'var(--b1)' },
    { id: 'design', text: 'Design', x: 458, y: 210, parent: 'root', color: 'var(--b2)' },
    { id: 'release', text: 'Release', x: 454, y: 330, parent: 'root', color: 'var(--b3)' },
    { id: 'marketing', text: 'Marketing', x: 104, y: 110, parent: 'root', color: 'var(--b4)' },
    { id: 'pricing', text: 'Pricing', x: 108, y: 210, parent: 'root', color: 'var(--b5)', ai: true },
    { id: 'support', text: 'Support', x: 108, y: 310, parent: 'root', color: 'var(--b5)', ai: true },
  ],
  steps: [
    { add: 'root', wait: 700 },
    { key: 'Tab', add: 'research' }, { key: 'Enter', add: 'design' }, { key: 'Enter', add: 'release' }, { key: 'Enter', add: 'marketing' },
    { key: '←', select: 'root', wait: 400 },
    { key: '⌘ K', palette: 'ai gaps', wait: 500 },
    { add: 'pricing', wait: 160 }, { add: 'support', wait: 400 },
  ],
}

const SVG = 'http://www.w3.org/2000/svg'
const svgEl = <K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number> = {}) => {
  const el = document.createElementNS(SVG, name)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
  return el
}

function heroDemo() {
  const host = $<HTMLElement>('[data-demo]')
  const keys = $<HTMLElement>('[data-keys]')
  if (!host) return
  const narrow = matchMedia('(max-width: 640px)')
  let run = 0 // each run has a number; an old run stops when the number changes
  let visible = false

  const sleep = (ms: number, mine: number) => new Promise<void>((resolve, reject) => {
    setTimeout(() => (mine === run && visible && !document.hidden ? resolve() : reject(new Error('stopped'))), ms)
  })

  const play = async (instant = false) => {
    const mine = ++run
    const scene = narrow.matches ? NARROW : WIDE
    host.style.aspectRatio = `${scene.w} / ${scene.h}`
    const svg = svgEl('svg', { viewBox: `0 0 ${scene.w} ${scene.h}`, role: 'img', 'aria-label': 'An animated mind map of a product launch. It grows as the keys Tab and Enter are pressed.' })
    const edges = svgEl('g')
    const nodes = svgEl('g')
    svg.append(edges, nodes)
    const palette = document.createElement('div')
    palette.className = 'palette'
    const q = document.createElement('div')
    q.className = 'q'
    const typed = document.createElement('span')
    q.append(typed)
    const hit = document.createElement('div')
    hit.className = 'hit'
    palette.append(q, hit)
    host.replaceChildren(svg, palette)

    const pad = scene.font * 1.25
    const height = scene.font * 2.5
    const made = new Map<string, { g: SVGGElement; rect: SVGRectElement; label: SVGTextElement; width: number; node: DemoNode }>()
    const widthOf = (label: SVGTextElement, text: string) => { label.textContent = text; return label.getComputedTextLength() + pad * 2 }
    const size = (rect: SVGRectElement, n: DemoNode, w: number) => { rect.setAttribute('x', String(n.x - w / 2)); rect.setAttribute('width', String(w)) }
    const select = (id: string) => made.forEach((m, key) => m.g.classList.toggle('sel', key === id))

    const add = async (id: string) => {
      const n = scene.nodes.find((x) => x.id === id)!
      const g = svgEl('g', { class: `nd${n.parent ? '' : ' root'}${n.ai ? ' ai' : ''}` })
      const rect = svgEl('rect', { y: n.y - height / 2, height, rx: height / 2.6, stroke: n.color })
      const label = svgEl('text', { x: n.x, y: n.y, 'font-size': n.parent ? scene.font : scene.font + 2 })
      g.append(rect, label)
      nodes.append(g)
      const width = widthOf(label, n.text)
      made.set(id, { g, rect, label, width, node: n })
      const parent = n.parent ? made.get(n.parent) : undefined
      if (parent) {
        const dir = n.x > parent.node.x ? 1 : -1
        const x1 = parent.node.x + (dir * parent.width) / 2
        const x2 = n.x - (dir * width) / 2
        const mid = (x1 + x2) / 2
        const path = svgEl('path', { class: 'edge', stroke: n.color, d: `M${x1} ${parent.node.y}C${mid} ${parent.node.y} ${mid} ${n.y} ${x2} ${n.y}` })
        edges.append(path)
        if (!instant) {
          const len = path.getTotalLength()
          path.style.strokeDasharray = String(len)
          path.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 420, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' })
        }
      }
      select(id)
      if (instant || n.ai || !n.parent) return size(rect, n, width)
      // The user types the text: the node grows with each letter.
      for (let i = 1; i <= n.text.length; i++) {
        size(rect, n, widthOf(label, n.text.slice(0, i)))
        await sleep(34 + Math.random() * 30, mine)
      }
    }

    const press = (text: string) => {
      if (!keys) return
      const cap = document.createElement('span')
      cap.className = 'keycap'
      cap.textContent = text
      keys.replaceChildren(cap)
    }

    try {
      for (const step of scene.steps) {
        if (!instant && step.key) { press(step.key); await sleep(240, mine) }
        if (step.select) select(step.select)
        if (step.palette) {
          hit.textContent = step.palette === 'ai gaps' ? 'AI: Find what is missing' : 'AI: Expand this idea'
          if (!instant) {
            palette.classList.add('on')
            for (let i = 1; i <= step.palette.length; i++) { typed.textContent = step.palette.slice(0, i); await sleep(70, mine) }
            await sleep(520, mine)
            press('Enter')
            palette.classList.remove('on')
          }
        }
        if (step.add) await add(step.add)
        if (!instant) await sleep(step.wait ?? 260, mine)
      }
      keys?.replaceChildren()
      select('')
      if (instant) return
      await sleep(7000, mine)
      await svg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 500, fill: 'forwards' }).finished
      if (mine === run) void play()
    } catch { /* a newer run took over, or the demo left the screen */ }
  }

  if (calm) { visible = true; void play(true); return }
  $('[data-replay]')?.addEventListener('click', () => { visible = true; void play() })
  narrow.addEventListener('change', () => void play())
  document.addEventListener('visibilitychange', () => { if (!document.hidden && visible) void play() })
  new IntersectionObserver(([e]) => {
    const was = visible
    visible = e.isIntersecting
    if (visible && !was) void play()
  }, { threshold: 0.25 }).observe(host)
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
else start()
