import { EFFORT_LEVELS, type PlannedStep } from './types.js';

export const TASK_PROMPT = `Plan a 30-day road trip for my partner and me, and write it up as a day-by-day itinerary.

The basics
- Dates: Saturday, September 11, 2027 to Sunday, October 10, 2027.
- Start and end in Denver, Colorado. We want to see the best of Colorado, Utah, Arizona and New Mexico.
- We must be in Santa Fe on Saturday, September 25 for a friend's wedding.

Constraints
- We drive an electric car with about 250 miles of real-world range. Plan where we charge on every driving day.
- I have a severe tree-nut allergy and carry epinephrine. My partner is vegetarian. For each stop, find at least two places where we can both eat safely.
- My partner works remotely Tuesday to Thursday, 8am to noon Pacific time, and needs reliable Wi-Fi and a quiet room. No driving during those hours.
- No more than 4 hours of driving in a day, and none after dark.
- Budget: $9,000 total for lodging, food and activities. Charging is separate.
- We like hikes of up to 6 miles, hot springs and small towns. We dislike crowds.

Also include a short packing list and a few scenic photo stops.

Make the decisions for us, but do not book or pay for anything. List every assumption you make and every decision you want us to confirm.`;

export const SYSTEM_PROMPT = `You are Claude working inside Claude Collaborate, a tool where a person watches a long task run and steers it while it runs.

How a run works
- The task is split into steps. You plan the steps first, then execute them one at a time in order. Each step is one message to you.
- Every step carries an effort level: one of ${EFFORT_LEVELS.join(', ')}. You choose a level for each planned step with a one-line reason. The person can change the level on any step that has not started. When a step runs, the app sends your message at the chosen level.
- Choose effort by stakes and dependency: steps that later steps build on, or that carry safety or scheduling risk, get high or above. Routine steps that are easy to redo get low or medium. When unsure, pick the higher level.
- Flag a step as uncertain only when you think the person should look before you run it, for example when its outcome rests on an assumption they may want to correct. The run pauses briefly before uncertain steps.
- After a step, you may add steps or change the effort on later steps that have not started. Give a reason for each change. The app will refuse to change an effort the person set themselves, and will tell you if that happens.
- The result is a document with named sections. Each step writes or rewrites whole sections. Always return the complete new content of a section you update, in Markdown, not a diff. Do not update sections you did not change.
- Never book, pay, or submit anything. You produce a document only.
- Be concrete and specific. Record every assumption you make and every decision you want the person to confirm.
- You answer only in the JSON shape the app asks for. No prose outside it.`;

export const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    sections: {
      type: 'array',
      description: 'The document outline in reading order. Short, stable ids like "route" or "charging".',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, title: { type: 'string' } },
        required: ['id', 'title'],
        additionalProperties: false,
      },
    },
    steps: {
      type: 'array',
      description: 'Steps in execution order. Between 5 and 10 steps.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Short stable id like "step-1".' },
          title: { type: 'string', description: 'What the step does, under 12 words.' },
          reason: { type: 'string', description: 'One line: why this effort level.' },
          effort: { type: 'string', enum: [...EFFORT_LEVELS] },
          uncertain: { type: 'boolean' },
          uncertain_reason: { type: 'string', description: 'Empty string when not uncertain.' },
          sections: { type: 'array', items: { type: 'string' }, description: 'Section ids this step will write.' },
        },
        required: ['id', 'title', 'reason', 'effort', 'uncertain', 'uncertain_reason', 'sections'],
        additionalProperties: false,
      },
    },
  },
  required: ['sections', 'steps'],
  additionalProperties: false,
} as const;

export const STEP_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Two or three sentences on what this step did and found.' },
    assumptions: { type: 'array', items: { type: 'string' }, description: 'Assumptions made in this step.' },
    decisions_to_confirm: { type: 'array', items: { type: 'string' }, description: 'Decisions the person should confirm.' },
    section_updates: {
      type: 'array',
      description: 'Complete new content for each section this step changed. Existing section ids or new ones.',
      items: {
        type: 'object',
        properties: {
          section_id: { type: 'string' },
          title: { type: 'string' },
          markdown: { type: 'string', description: 'Full section body in Markdown. Do not repeat the title as a heading.' },
        },
        required: ['section_id', 'title', 'markdown'],
        additionalProperties: false,
      },
    },
    new_steps: {
      type: 'array',
      description: 'Steps to add to the plan. Usually empty.',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          reason: { type: 'string', description: 'One line: why this effort level.' },
          effort: { type: 'string', enum: [...EFFORT_LEVELS] },
          uncertain: { type: 'boolean' },
          uncertain_reason: { type: 'string' },
          insert_after_step_id: { type: 'string', description: 'Id of an existing step. The new step runs right after it. Use the current step id to run next.' },
          sections: { type: 'array', items: { type: 'string' } },
          change_reason: { type: 'string', description: 'One line: why this step is being added now.' },
        },
        required: ['title', 'reason', 'effort', 'uncertain', 'uncertain_reason', 'insert_after_step_id', 'sections', 'change_reason'],
        additionalProperties: false,
      },
    },
    effort_changes: {
      type: 'array',
      description: 'Effort changes for later steps that have not started. Usually empty.',
      items: {
        type: 'object',
        properties: {
          step_id: { type: 'string' },
          effort: { type: 'string', enum: [...EFFORT_LEVELS] },
          reason: { type: 'string' },
        },
        required: ['step_id', 'effort', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'assumptions', 'decisions_to_confirm', 'section_updates', 'new_steps', 'effort_changes'],
  additionalProperties: false,
} as const;

export function planPrompt(task: string): string {
  return `Here is the task.

<task>
${task}
</task>

Plan the run. Return the document outline (sections) and the ordered steps with an effort level and a one-line reason for each. Keep steps coarse enough that each one produces a meaningful part of the document. Do not execute any step yet.`;
}

export function stepPrompt(step: PlannedStep, remaining: PlannedStep[], sectionTitles: Record<string, string>): string {
  const later = remaining
    .filter((s) => s.id !== step.id)
    .map((s) => `- ${s.id}: ${s.title} (effort ${s.userEffort ?? s.effort}${s.userEffort ? ', set by the person' : ''})`)
    .join('\n');
  const sections = Object.entries(sectionTitles).map(([id, t]) => `- ${id}: ${t}`).join('\n');
  return `Execute step ${step.id}: ${step.title}

Expected sections to write: ${step.sections.join(', ') || '(your choice)'}

Current document sections:
${sections}

Steps still to run after this one:
${later || '(none)'}

Return the complete new content of every section you changed, your assumptions, the decisions to confirm, and any plan changes with reasons. Only propose effort changes for steps listed above that the person has not set.`;
}

export function rejectedChangesNote(rejected: string[]): string {
  if (rejected.length === 0) return '';
  return `\n\nNote from the app: the person had already set the effort on ${rejected.join(', ')}, so your proposed change there was not applied.`;
}
