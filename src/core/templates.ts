import { uid } from './ids'
import { docFromOutline, parseOutline } from './outline'
import type { LayoutKind, MapDoc } from './types'

export interface Template {
  id: string
  name: string
  blurb: string
  layout: LayoutKind
  themeId: string
  outline: string
}

export const TEMPLATES: Template[] = [
  {
    id: 'blank',
    name: 'Blank map',
    blurb: 'One central idea. Start anywhere.',
    layout: 'mindmap',
    themeId: 'mint',
    outline: '# Central idea',
  },
  {
    id: 'brainstorm',
    name: 'Brainstorm',
    blurb: 'Diverge first, then group and pick.',
    layout: 'mindmap',
    themeId: 'sunset',
    outline: `# Brainstorm topic
- Questions
  - Who is this for?
  - What does success look like?
- Wild ideas
  - Idea 1
  - Idea 2
- Constraints
  - Time
  - Budget
- Next steps
  - [ ] Pick the top 3
  - [ ] Test the riskiest idea`,
  },
  {
    id: 'project',
    name: 'Project plan',
    blurb: 'Goals, milestones, risks and owners.',
    layout: 'right',
    themeId: 'ocean',
    outline: `# Project name
- Goal
  - Outcome we want
  - How we measure it
- Milestones
  - Kick-off
  - Prototype
  - Launch
- Risks
  - Scope creep
  - Dependencies
- Team
  - Owner
  - Reviewers`,
  },
  {
    id: 'weekly',
    name: 'Weekly plan',
    blurb: 'Your week on one page.',
    layout: 'down',
    themeId: 'forest',
    outline: `# This week
- Monday
  - Top priority
- Tuesday
- Wednesday
- Thursday
- Friday
  - Review the week
- Habits
  - [ ] Exercise
  - [ ] Read 20 minutes`,
  },
  {
    id: 'swot',
    name: 'SWOT analysis',
    blurb: 'Strengths, weaknesses, opportunities, threats.',
    layout: 'radial',
    themeId: 'grape',
    outline: `# SWOT
- Strengths
  - What we do well
- Weaknesses
  - What we lack
- Opportunities
  - Trends we can use
- Threats
  - What could hurt us`,
  },
  {
    id: 'study',
    name: 'Study notes',
    blurb: 'Concepts, examples and open questions.',
    layout: 'mindmap',
    themeId: 'mint',
    outline: `# Subject
- Key concepts
  - Concept A
  - Concept B
- Examples
- Open questions
  - What is still unclear?
- Summary`,
  },
]

export function docFromTemplate(t: Template): MapDoc {
  const doc = docFromOutline(parseOutline(t.outline))
  doc.layout = t.layout
  doc.themeId = t.themeId
  return doc
}

/** A copy of `doc` where every node, link, group and bracket has a new id. Links to other maps keep pointing where they did. */
export function cloneDocWithNewIds(doc: MapDoc): MapDoc {
  const map = new Map<string, string>()
  for (const id of Object.keys(doc.nodes)) map.set(id, uid())
  const m = (id: string) => map.get(id) ?? id
  const nodes: MapDoc['nodes'] = {}
  for (const n of Object.values(doc.nodes)) {
    const c = structuredClone(n)
    nodes[m(n.id)] = { ...c, id: m(n.id), parentId: n.parentId ? m(n.parentId) : null, children: n.children.map(m) }
  }
  const out: MapDoc = {
    ...structuredClone({ ...doc, nodes: {}, relations: [], groups: undefined, summaries: undefined }),
    root: m(doc.root),
    nodes,
    relations: doc.relations.map((r) => ({ ...r, id: uid(8), from: m(r.from), to: m(r.to) })),
  }
  if (doc.groups?.length) out.groups = doc.groups.map((g) => ({ ...g, id: uid(8), ids: g.ids.map(m) }))
  else delete out.groups
  if (doc.summaries?.length) out.summaries = doc.summaries.map((s) => ({ ...s, id: uid(8), parentId: m(s.parentId), from: m(s.from), to: m(s.to) }))
  else delete out.summaries
  return out
}

/** A map made from `doc` to be saved as a template: its own map id, the given name as title, and none of the library marks. */
export function templateDoc(doc: MapDoc, name: string): MapDoc {
  const c = cloneDocWithNewIds(doc)
  const now = Date.now()
  c.nodes[c.root].text = name.trim() || c.nodes[c.root].text
  c.meta = { id: uid(12), title: c.nodes[c.root].text, createdAt: now, updatedAt: now, nodeCount: Object.keys(c.nodes).length, tags: [], trashedAt: null }
  return c
}
