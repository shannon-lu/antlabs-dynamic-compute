export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORT_LEVELS)[number];
export function isEffort(x: unknown): x is Effort {
  return typeof x === 'string' && (EFFORT_LEVELS as readonly string[]).includes(x);
}

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (recommended)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1' },
] as const;

export interface Usage {
  inputTokens: number;       // fresh input tokens this call
  cacheReadTokens: number;   // input tokens served from the prompt cache
  cacheWriteTokens: number;
  outputTokens: number;      // includes thinking tokens
  thinkingTokens: number | null; // null when the backend does not report it
  costUsd: number | null;    // client-side estimate when available
  durationMs: number;
}

export interface EffortChange {
  at: string;          // ISO time
  byStepId: string;    // the executed step whose output proposed the change
  from: Effort;
  to: Effort;
  reason: string;
  applied: boolean;    // false when the user had already set the effort
}

export interface PlannedStep {
  id: string;
  title: string;
  reason: string;            // Claude's one-line reason for the effort level
  effort: Effort;            // Claude's current choice
  userEffort: Effort | null; // the user's override, if any. Never overwritten by Claude.
  uncertain: boolean;        // Claude flagged this step: the run pauses before it
  uncertainReason: string;
  sections: string[];        // document section ids this step expects to write
  status: 'planned' | 'in_progress' | 'done' | 'failed';
  origin:
    | { kind: 'plan' }
    | { kind: 'added'; byStepId: string; reason: string };
  effortChanges: EffortChange[];
}

export interface ExecutedStep {
  stepId: string;
  title: string;
  effortUsed: Effort;
  effortSource: 'claude' | 'user';
  claudeEffort: Effort; // what Claude had chosen at the time it ran
  startedAt: string;
  finishedAt: string;
  usage: Usage;
  summary: string;
  assumptions: string[];
  decisions: string[];
  sectionsUpdated: string[];
  planChanges: string[]; // human-readable log of plan edits this step made or proposed
  error?: string;
}

export interface SectionVersion {
  stepId: string;
  at: string;
  markdown: string;
}

export interface Section {
  id: string;
  title: string;
  versions: SectionVersion[];
}

export type RunStatus = 'idle' | 'planning' | 'paused' | 'running' | 'done' | 'stopped' | 'error';

export interface PauseState {
  reason: 'after_plan' | 'uncertain_step';
  stepId: string | null;
  until: number; // epoch ms
}

export interface LogEntry {
  at: string;
  text: string;
}

export interface RunState {
  id: string;
  title: string; // document title, chosen by Claude in the plan
  status: RunStatus;
  provider: string;
  model: string;
  allowWeb: boolean;
  prompt: string;
  startedAt: string | null;
  finishedAt: string | null;
  pause: PauseState | null;
  currentStepId: string | null;
  currentStepStartedAt: string | null;
  steps: PlannedStep[];
  executed: ExecutedStep[];
  sectionOrder: string[];
  sections: Record<string, Section>;
  planUsage: Usage | null;
  totals: { outputTokens: number; thinkingTokens: number; inputTokens: number; costUsd: number; calls: number };
  log: LogEntry[];
  error: string | null;
}

// Shapes Claude returns via structured output.
export interface PlanOutput {
  title: string;
  sections: { id: string; title: string }[];
  steps: {
    id: string;
    title: string;
    reason: string;
    effort: Effort;
    uncertain: boolean;
    uncertain_reason: string;
    sections: string[];
  }[];
}

export interface StepOutput {
  summary: string;
  assumptions: string[];
  decisions_to_confirm: string[];
  section_updates: { section_id: string; title: string; markdown: string }[];
  new_steps: {
    title: string;
    reason: string;
    effort: Effort;
    uncertain: boolean;
    uncertain_reason: string;
    insert_after_step_id: string;
    sections: string[];
    change_reason: string;
  }[];
  effort_changes: { step_id: string; effort: Effort; reason: string }[];
}
