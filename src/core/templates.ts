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
