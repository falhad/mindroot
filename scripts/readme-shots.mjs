#!/usr/bin/env node
// Makes the screenshots that README.md shows. It drives the web build (the same UI as the desktop app).
//
//   node scripts/readme-shots.mjs              write docs/screenshots/*.png
//   node scripts/readme-shots.mjs --out <dir>  write to another folder
//   node scripts/readme-shots.mjs --url <url>  use a dev server that already runs (default http://localhost:1420)
//
// If nothing answers on the URL, the script starts `pnpm dev` and stops it at the end.
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node scripts/readme-shots.mjs [--out docs/screenshots] [--url http://localhost:1420]')
  process.exit(0)
}
const OUT = resolve(flag('--out', 'docs/screenshots'))
const URL_ = flag('--url', 'http://localhost:1420')

// ---------- demo maps ----------

let seq = 0
/** Turn a nested `{ text, ...fields, kids: [] }` tree into the flat `nodes` record of a map file. */
function flatten(tree, nodes = {}, parentId = null) {
  const id = tree.id ?? `n${++seq}`
  const { kids = [], id: _id, ...fields } = tree
  nodes[id] = { id, parentId, children: [], ...fields }
  for (const k of kids) nodes[id].children.push(flatten(k, nodes, id).id)
  return { id, nodes }
}

function makeMap(title, tree, extra = {}) {
  const { id, nodes } = flatten(tree)
  return JSON.stringify({ v: 1, meta: { title, tags: extra.tags ?? [] }, root: id, nodes, relations: [], layout: 'mindmap', edge: 'curve', themeId: 'mint', bg: 'dots', ...extra })
}

const NOTES = `## Interview plan

Talk to **8 people** who plan trips more than twice a year.

- What did they use the last time?
- Where did they lose time?
- What would they pay for?

\`\`\`text
30 minutes each, record with consent
\`\`\`
`

// All content below is invented demo data.
const heroMap = makeMap(
  'Product launch plan',
  {
    id: 'root', text: 'Product launch plan', icon: 'lucide:rocket',
    kids: [
      {
        text: 'Research', icon: 'lucide:search', side: 'right',
        kids: [
          { id: 'local', text: 'User interviews', icon: 'lucide:users', notes: NOTES, notesFmt: 'md', tags: ['discovery'] },
          { text: 'Competitor review', icon: 'lucide:chart', tags: ['discovery'] },
          { id: 'insights', text: 'Key insights', icon: 'lucide:lightbulb' },
        ],
      },
      {
        text: 'Design', icon: 'lucide:edit', side: 'right',
        kids: [
          { id: 'wire', text: 'Wireframes', icon: 'lucide:image' },
          { text: 'Usability test', icon: 'lucide:target' },
          { text: 'Brand and colours', icon: 'emoji:🎨' },
        ],
      },
      {
        text: 'Launch checklist', icon: 'lucide:flag', side: 'right',
        kids: [
          { id: 't1', text: 'Landing page', done: true, tags: ['launch'] },
          { id: 't2', text: 'Demo video', done: true, tags: ['launch'] },
          { id: 't3', text: 'Press kit', done: false, due: '2027-03-12', tags: ['launch'] },
          { text: 'Announcement', done: false, due: '2027-03-15', tags: ['launch'] },
        ],
      },
      {
        text: 'Build', icon: 'lucide:code', side: 'left',
        kids: [
          { text: 'Prototype', icon: 'lucide:zap' },
          { text: 'Beta with 50 users', icon: 'emoji:🧪' },
          { text: 'Fix the top 10 problems', icon: 'emoji:🐛' },
        ],
      },
      {
        text: 'Marketing', icon: 'lucide:bell', side: 'left',
        kids: [
          { text: 'Newsletter' },
          { text: 'Launch post' },
          { text: 'Community events' },
          { text: 'Partner outreach', icon: 'lucide:mail' },
        ],
      },
      {
        text: 'Team', icon: 'lucide:heart', side: 'left',
        kids: [
          { text: 'Weekly sync, 30 minutes' },
          { text: 'Shared roadmap' },
          { text: 'Budget', icon: 'lucide:money' },
        ],
      },
    ],
  },
  {
    tags: ['launch', 'planning'],
    relations: [{ id: 'r1', from: 'insights', to: 'wire', label: 'informs', arrow: 'end', dash: 'dashed' }],
    groups: [{ id: 'g1', ids: ['t1', 't2', 't3'] }],
  },
)

const travelMap = makeMap(
  'Trip to Japan',
  {
    text: 'Trip to Japan', icon: 'lucide:pin',
    kids: [
      { text: 'Tokyo', kids: [{ text: 'Museums' }, { text: 'Food tour' }] },
      { text: 'Kyoto', kids: [{ text: 'Temples' }, { text: 'Tea house' }] },
      { text: 'Before we go', kids: [{ text: 'Rail pass', done: true }, { text: 'Book hotels', done: false }] },
      { text: 'Budget', kids: [{ text: 'Flights' }, { text: 'Daily costs' }] },
    ],
  },
  { themeId: 'grape', tags: ['travel'] },
)

const rtlMap = makeMap(
  'نقشه راه محصول',
  {
    text: 'نقشه راه محصول', icon: 'lucide:rocket',
    kids: [
      { text: 'پژوهش', icon: 'lucide:search', kids: [{ text: 'گفت‌وگو با کاربران' }, { text: 'بررسی رقبا' }] },
      { text: 'طراحی', icon: 'lucide:edit', kids: [{ text: 'طرح اولیه' }, { text: 'آزمون کاربردپذیری' }] },
      { text: 'ساخت', icon: 'lucide:code', kids: [{ text: 'نسخه آزمایشی', done: true }, { text: 'انتشار عمومی', done: false }] },
      { text: 'رشد', icon: 'lucide:chart', kids: [{ text: 'بازخورد' }, { text: 'جامعه کاربران' }] },
    ],
  },
  { dir: 'rtl', font: 'vazirmatn', themeId: 'grape', tags: ['فارسی'] },
)

const arabicMap = makeMap(
  'خطة المشروع',
  {
    text: 'خطة المشروع', icon: 'lucide:target',
    kids: [
      { text: 'البحث', icon: 'lucide:search', kids: [{ text: 'مقابلات المستخدمين' }, { text: 'تحليل المنافسين' }] },
      { text: 'التصميم', icon: 'lucide:edit', kids: [{ text: 'النماذج الأولية' }, { text: 'اختبار سهولة الاستخدام' }] },
      { text: 'التطوير', icon: 'lucide:code', kids: [{ text: 'النسخة التجريبية', done: true }, { text: 'إصلاح الأخطاء', done: false }] },
      { text: 'الإطلاق', icon: 'lucide:rocket', kids: [{ text: 'الصفحة التعريفية' }, { text: 'الإعلان' }] },
    ],
  },
  { dir: 'rtl', font: 'vazirmatn', layout: 'right', themeId: 'sunset', tags: ['عربي'] },
)

const orgMap = makeMap(
  'Team structure',
  {
    text: 'Product team', icon: 'lucide:users',
    kids: [
      { text: 'Design', kids: [{ text: 'Research' }, { text: 'Interface' }] },
      { text: 'Engineering', kids: [{ text: 'Desktop' }, { text: 'Sync' }, { text: 'Plugins' }] },
      { text: 'Growth', kids: [{ text: 'Docs' }, { text: 'Community' }] },
    ],
  },
  { layout: 'down', edge: 'elbow', themeId: 'ocean', tags: ['team'] },
)

const radialMap = makeMap(
  'Book notes: Deep Work',
  {
    text: 'Deep Work', icon: 'lucide:book',
    kids: [
      { text: 'Work deeply', kids: [{ text: 'Rituals' }, { text: 'Grand gestures' }] },
      { text: 'Embrace boredom', kids: [{ text: 'Schedule the internet' }] },
      { text: 'Quit shallow work', kids: [{ text: 'Fixed schedule' }, { text: 'Say no' }] },
      { text: 'Measure', kids: [{ text: 'Deep hours each day' }] },
      { text: 'Rest', kids: [{ text: 'Shutdown ritual' }] },
    ],
  },
  { layout: 'radial', themeId: 'sunset', tags: ['reading'] },
)

const weekMap = makeMap(
  'Weekly review',
  {
    text: 'Weekly review', icon: 'lucide:calendar',
    kids: [
      { text: 'Wins', kids: [{ text: 'Finished the draft' }, { text: 'Ran three times' }] },
      { text: 'Blocked', kids: [{ text: 'Waiting for feedback' }] },
      { text: 'Next', kids: [{ text: 'Plan the workshop', done: false }, { text: 'Read two chapters', done: false }] },
    ],
  },
  { layout: 'right', themeId: 'forest', tags: ['review'] },
)

// ---------- browser steps ----------

async function reachable(url) {
  try {
    return (await fetch(url)).ok
  } catch {
    return false
  }
}

async function ensureServer() {
  if (await reachable(URL_)) return null
  console.log('Starting pnpm dev ...')
  const child = spawn('pnpm', ['dev'], { stdio: 'ignore', detached: true })
  for (let i = 0; i < 120; i++) {
    if (await reachable(URL_)) return child
    await new Promise((r) => setTimeout(r, 500))
  }
  process.kill(-child.pid)
  throw new Error(`No answer from ${URL_} after 60 s`)
}

const banner = (page) => page.getByRole('banner')

async function importMap(page, name, json) {
  await page.goto(URL_)
  await banner(page).getByRole('button', { name: 'New map' }).waitFor()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Import' }).click()
  await (await chooser).setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(json) })
  await page.locator('[data-node-id]').first().waitFor()
  await page.waitForTimeout(900) // autosave (600 ms) and the dashboard thumbnail
  await page.getByText('Imported', { exact: true }).waitFor({ state: 'hidden', timeout: 10_000 })
}

/** Open or close the side panel (the state is remembered between maps). */
async function sidePanel(page, open) {
  const btn = page.getByRole('button', { name: 'Toggle side panel' })
  if (((await btn.getAttribute('aria-pressed')) === 'true') !== open) await btn.click()
  await page.waitForTimeout(350)
}

async function shot(page, name, scheme) {
  await page.emulateMedia({ colorScheme: scheme })
  await page.mouse.move(2, 450)
  await page.waitForTimeout(450)
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log(`  ${name}.png`)
}

const fit = async (page) => {
  await page.getByRole('button', { name: 'Fit to screen' }).click()
  await page.waitForTimeout(500)
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const server = await ensureServer()
  const browser = await chromium.launch()
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
    const page = await ctx.newPage()

    // supporting maps first, so the dashboard has content
    await importMap(page, 'week.json', weekMap)
    await importMap(page, 'travel.json', travelMap)
    await importMap(page, 'book.json', radialMap)

    await importMap(page, 'rtl.json', rtlMap)
    await sidePanel(page, false)
    await fit(page)
    await shot(page, 'rtl-dark', 'dark')

    await importMap(page, 'arabic.json', arabicMap)
    await sidePanel(page, false)
    await fit(page)
    await shot(page, 'arabic-light', 'light')

    await importMap(page, 'team.json', orgMap)
    await sidePanel(page, false)
    await fit(page)
    await shot(page, 'layout-dark', 'dark')

    await importMap(page, 'hero.json', heroMap)
    await sidePanel(page, false)
    await fit(page)
    await shot(page, 'map-dark', 'dark')
    await shot(page, 'map-light', 'light')

    // notes: select a node with Markdown notes; the side panel shows them
    await page.locator('[data-node-id="local"]').click() // before the panel opens: the panel covers this node
    await sidePanel(page, true)
    await page.getByRole('button', { name: 'Preview', exact: true }).or(page.getByRole('tab', { name: 'Preview', exact: true })).first().click()
    await page.getByText('Interview plan').last().scrollIntoViewIfNeeded()
    await page.getByText('record with consent').last().scrollIntoViewIfNeeded()
    await shot(page, 'notes-light', 'light')
    await page.keyboard.press('Escape')
    await sidePanel(page, false)

    // outline beside the map
    await page.getByRole('button', { name: 'Toggle outline' }).click()
    await fit(page)
    await shot(page, 'outline-dark', 'dark')
    await page.getByRole('button', { name: 'Toggle outline' }).click()

    // presentation
    await page.locator('[data-node-id="root"]').click()
    await page.keyboard.press('F5')
    await page.waitForTimeout(600)
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(700)
    await shot(page, 'present-dark', 'dark')
    await page.keyboard.press('Escape')

    // dashboard
    await page.getByRole('button', { name: 'All maps' }).click()
    await banner(page).getByRole('button', { name: 'New map' }).waitFor()
    await page.waitForTimeout(600)
    await shot(page, 'dashboard-dark', 'dark')
    await shot(page, 'dashboard-light', 'light')
  } finally {
    await browser.close()
    if (server) process.kill(-server.pid)
  }
  console.log(`Done: ${OUT}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
