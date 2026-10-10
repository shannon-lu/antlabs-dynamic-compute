import { EventEmitter } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Provider, Conversation } from './providers/types.js';
import { PLAN_SCHEMA, STEP_SCHEMA, SYSTEM_PROMPT, TASK_PROMPT, planPrompt, stepPrompt, rejectedChangesNote } from './prompts.js';
import type { ProgressEvent } from './providers/types.js';
import {
  isEffort,
  type Effort,
  type ExecutedStep,
  type LogEntry,
  type PlanOutput,
  type PlannedStep,
  type RunState,
  type StepOutput,
  type Usage,
} from './types.js';

export interface StartOptions {
  model: string;
  allowWeb: boolean;
  prompt: string;
}

export const MAX_PROMPT_CHARS = 20000;

const PLAN_EFFORT: Effort = 'high';

/**
 * Drives one run: plan, pause, then steps in order. Emits 'change' whenever state changes.
 * The browser gets the full state on every change; it is small enough for that.
 */
export class Orchestrator extends EventEmitter {
  state: RunState;
  private conversation: Conversation | null = null;
  private abort = new AbortController();
  private pauseTimer: NodeJS.Timeout | null = null;
  private pauseResolve: (() => void) | null = null;
  private emitTimer: NodeJS.Timeout | null = null;
  private pendingNote = '';
  private toolCalls: Record<string, number> = {};
  private toolLogEntry: LogEntry | null = null;

  constructor(
    private provider: Provider,
    private runsDir: string,
    private pauseMs: number,
    defaultModel: string,
  ) {
    super();
    this.state = emptyState(provider.name, defaultModel);
  }

  get busy(): boolean {
    return ['planning', 'paused', 'running'].includes(this.state.status);
  }

  // ---- user actions -------------------------------------------------------

  async start(opts: StartOptions): Promise<void> {
    if (this.busy) throw new Error('A run is already in progress');
    this.abort = new AbortController();
    const prompt = (opts.prompt ?? '').trim();
    if (!prompt) throw new Error('The task prompt is empty');
    if (prompt.length > MAX_PROMPT_CHARS) throw new Error(`The task prompt is longer than ${MAX_PROMPT_CHARS} characters`);
    this.state = emptyState(this.provider.name, opts.model);
    this.state.prompt = prompt;
    this.state.id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 6)}`;
    this.state.allowWeb = opts.allowWeb;
    this.state.startedAt = now();
    const workDir = join(this.runsDir, this.state.id);
    mkdirSync(workDir, { recursive: true });
    this.conversation = this.provider.open(SYSTEM_PROMPT, workDir);
    void this.loop().catch((err) => this.fail(err));
  }

  stop(): void {
    if (!this.busy) return;
    this.log('Run stopped by the user.');
    this.state.status = 'stopped';
    this.state.finishedAt = now();
    this.state.pause = null;
    this.state.currentStepId = null;
    this.abort.abort();
    this.endPause();
    this.changed();
  }

  setEffort(stepId: string, effort: string): void {
    if (!isEffort(effort)) throw new Error(`Unknown effort level "${effort}"`);
    const step = this.state.steps.find((s) => s.id === stepId);
    if (!step) throw new Error(`No step ${stepId}`);
    if (step.status !== 'planned') throw new Error('Only steps that have not started can be changed');
    const before = step.userEffort ?? step.effort;
    step.userEffort = effort;
    this.log(`You set ${step.id} (${step.title}) to ${effort}${before !== effort ? ` (was ${before})` : ''}.`);
    this.changed();
  }

  extendPause(ms: number): void {
    if (!this.state.pause) throw new Error('The run is not paused');
    this.state.pause.until = Math.max(this.state.pause.until, Date.now()) + ms;
    this.armPauseTimer();
    this.log(`Pause extended by ${Math.round(ms / 1000)}s.`);
    this.changed();
  }

  continueNow(): void {
    if (!this.state.pause) throw new Error('The run is not paused');
    this.log('Pause ended early by the user.');
    this.endPause();
  }

  // ---- the run ------------------------------------------------------------

  private async loop(): Promise<void> {
    const conv = this.conversation!;
    const signal = this.abort.signal;

    // 1. Plan
    this.state.status = 'planning';
    this.log(`Planning at ${PLAN_EFFORT} effort with ${this.state.model}.`);
    this.changed();
    const plan = await conv.send<PlanOutput>(planPrompt(this.state.prompt), this.callOpts(PLAN_EFFORT));
    if (signal.aborted) return;
    this.adoptPlan(plan.output);
    this.state.planUsage = plan.usage;
    this.addTotals(plan.usage);
    this.log(`Plan ready: ${this.state.steps.length} steps. Review the effort levels; the run continues in ${this.pauseMs / 1000}s.`);

    // 2. Pause after the plan
    await this.pause('after_plan', null);
    if (signal.aborted) return;

    // 3. Steps in order
    for (;;) {
      const step = this.state.steps.find((s) => s.status === 'planned');
      if (!step) break;

      if (step.uncertain) {
        this.log(`Claude flagged "${step.title}" as uncertain: ${step.uncertainReason || 'no reason given'}. Pausing.`);
        await this.pause('uncertain_step', step.id);
        if (signal.aborted) return;
      }

      await this.runStep(step);
      if (signal.aborted) return;
    }

    this.state.status = 'done';
    this.state.finishedAt = now();
    this.state.currentStepId = null;
    this.log('Run complete.');
    this.changed();
  }

  private async runStep(step: PlannedStep): Promise<void> {
    const conv = this.conversation!;
    const effort = step.userEffort ?? step.effort;
    const source = step.userEffort ? 'user' : 'claude';
    step.status = 'in_progress';
    this.state.status = 'running';
    this.state.currentStepId = step.id;
    this.state.currentStepStartedAt = now();
    this.log(`Running ${step.id} (${step.title}) at ${effort} effort${source === 'user' ? ', set by you' : ''}.`);
    this.toolCalls = {};
    this.toolLogEntry = null;
    this.changed();

    const remaining = this.state.steps.filter((s) => s.status === 'planned' || s.id === step.id);
    const titles = Object.fromEntries(this.state.sectionOrder.map((id) => [id, this.state.sections[id].title]));
    const prompt = stepPrompt(step, remaining, titles) + this.pendingNote;
    this.pendingNote = '';

    const startedAt = now();
    let result;
    try {
      result = await conv.send<StepOutput>(prompt, this.callOpts(effort));
    } catch (err) {
      step.status = 'failed';
      if (this.abort.signal.aborted) {
        this.state.executed.push({
          stepId: step.id, title: step.title, effortUsed: effort, effortSource: source, claudeEffort: step.effort,
          startedAt, finishedAt: now(), usage: zeroUsage(), summary: '', assumptions: [], decisions: [],
          sectionsUpdated: [], planChanges: [], toolCalls: { ...this.toolCalls }, outcome: 'stopped', error: 'Stopped by the user before this step finished.',
        });
        this.changed();
        return;
      }
      this.state.executed.push({
        stepId: step.id, title: step.title, effortUsed: effort, effortSource: source, claudeEffort: step.effort,
        startedAt, finishedAt: now(), usage: zeroUsage(), summary: '', assumptions: [], decisions: [],
        sectionsUpdated: [], planChanges: [], toolCalls: { ...this.toolCalls }, outcome: 'failed', error: String((err as Error).message ?? err),
      });
      throw err;
    }
    // If Stop arrived while the result was in flight, the step still finished: record it. The loop stops after it.

    const out = normalizeStepOutput(result.output);
    const executed: ExecutedStep = {
      stepId: step.id,
      title: step.title,
      effortUsed: effort,
      effortSource: source,
      claudeEffort: step.effort,
      startedAt,
      finishedAt: now(),
      usage: result.usage,
      summary: out.summary,
      assumptions: out.assumptions,
      decisions: out.decisions_to_confirm,
      sectionsUpdated: [],
      planChanges: [],
      toolCalls: { ...this.toolCalls },
      outcome: 'done',
    };

    // Document updates
    for (const upd of out.section_updates) {
      const id = slug(upd.section_id);
      if (!this.state.sections[id]) {
        this.state.sections[id] = { id, title: upd.title || id, versions: [] };
        this.state.sectionOrder.push(id);
        executed.planChanges.push(`Added document section "${upd.title || id}".`);
      } else if (upd.title && upd.title !== this.state.sections[id].title) {
        this.state.sections[id].title = upd.title;
      }
      this.state.sections[id].versions.push({ stepId: step.id, at: now(), markdown: upd.markdown });
      executed.sectionsUpdated.push(id);
    }

    // Plan changes: effort on later steps. The user's choice always holds.
    const rejected: string[] = [];
    for (const ch of out.effort_changes) {
      const target = this.state.steps.find((s) => s.id === ch.step_id);
      if (!target || target.status !== 'planned' || !isEffort(ch.effort)) continue;
      const from = target.userEffort ?? target.effort;
      if (target.userEffort) {
        target.effortChanges.push({ at: now(), byStepId: step.id, from, to: ch.effort, reason: ch.reason, applied: false });
        executed.planChanges.push(`Proposed ${target.id} at ${ch.effort} (${ch.reason}). Not applied: you set ${target.userEffort}.`);
        rejected.push(target.id);
        continue;
      }
      if (target.effort === ch.effort) continue;
      target.effortChanges.push({ at: now(), byStepId: step.id, from, to: ch.effort, reason: ch.reason, applied: true });
      target.effort = ch.effort;
      target.reason = ch.reason || target.reason;
      executed.planChanges.push(`Changed ${target.id} from ${from} to ${ch.effort}: ${ch.reason}`);
    }
    this.pendingNote = rejectedChangesNote(rejected);

    // Plan changes: new steps
    for (const ns of out.new_steps) {
      if (!isEffort(ns.effort)) continue;
      const id = this.freshStepId();
      const added: PlannedStep = {
        id,
        title: ns.title,
        reason: ns.reason,
        effort: ns.effort,
        userEffort: null,
        uncertain: Boolean(ns.uncertain),
        uncertainReason: ns.uncertain_reason ?? '',
        sections: (ns.sections ?? []).map(slug),
        status: 'planned',
        origin: { kind: 'added', byStepId: step.id, reason: ns.change_reason || ns.reason },
        effortChanges: [],
      };
      let idx = this.state.steps.findIndex((s) => s.id === ns.insert_after_step_id);
      if (idx < 0 || this.state.steps[idx].status === 'planned' && idx < this.state.steps.indexOf(step)) idx = this.state.steps.indexOf(step);
      // Never insert before a step that already ran or is running.
      while (idx + 1 < this.state.steps.length && this.state.steps[idx + 1].status !== 'planned') idx++;
      this.state.steps.splice(idx + 1, 0, added);
      executed.planChanges.push(`Added step ${id} "${ns.title}" at ${ns.effort}: ${added.origin.kind === 'added' ? added.origin.reason : ''}`);
    }

    step.status = 'done';
    this.state.executed.push(executed);
    this.addTotals(result.usage);
    this.state.currentStepId = null;
    this.log(
      `Finished ${step.id} in ${Math.round(result.usage.durationMs / 1000)}s: ${result.usage.outputTokens.toLocaleString()} output tokens` +
        (executed.planChanges.length ? `, ${executed.planChanges.length} plan change(s)` : '') + '.',
    );
    this.changed();
  }

  // ---- helpers ------------------------------------------------------------

  private adoptPlan(plan: PlanOutput): void {
    this.state.title = (plan.title ?? '').trim() || 'Document';
    const sections = (plan.sections ?? []).filter((s) => s && s.id);
    for (const s of sections) {
      const id = slug(s.id);
      if (this.state.sections[id]) continue;
      this.state.sections[id] = { id, title: s.title || id, versions: [] };
      this.state.sectionOrder.push(id);
    }
    const used = new Set<string>();
    this.state.steps = (plan.steps ?? []).map((s, i) => {
      let id = slug(s.id || `step-${i + 1}`);
      while (used.has(id)) id = `${id}-b`;
      used.add(id);
      return {
        id,
        title: s.title,
        reason: s.reason,
        effort: isEffort(s.effort) ? s.effort : 'high',
        userEffort: null,
        uncertain: Boolean(s.uncertain),
        uncertainReason: s.uncertain_reason ?? '',
        sections: (s.sections ?? []).map(slug),
        status: 'planned',
        origin: { kind: 'plan' },
        effortChanges: [],
      } satisfies PlannedStep;
    });
    if (this.state.steps.length === 0) throw new Error('Claude returned an empty plan');
  }

  private freshStepId(): string {
    let n = this.state.steps.length + 1;
    while (this.state.steps.some((s) => s.id === `step-${n}`)) n++;
    return `step-${n}`;
  }

  private callOpts(effort: Effort) {
    return {
      effort,
      model: this.state.model,
      allowWeb: this.state.allowWeb,
      schema: (this.state.steps.length === 0 ? PLAN_SCHEMA : STEP_SCHEMA) as unknown as Record<string, unknown>,
      signal: this.abort.signal,
      onProgress: (e: ProgressEvent) => this.progress(e),
    };
  }

  private pause(reason: 'after_plan' | 'uncertain_step', stepId: string | null): Promise<void> {
    this.state.status = 'paused';
    this.state.pause = { reason, stepId, until: Date.now() + this.pauseMs };
    this.changed();
    return new Promise<void>((resolve) => {
      this.pauseResolve = resolve;
      this.armPauseTimer();
    });
  }

  private armPauseTimer(): void {
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    if (!this.state.pause) return;
    const ms = Math.max(0, this.state.pause.until - Date.now());
    this.pauseTimer = setTimeout(() => this.endPause(), ms);
  }

  private endPause(): void {
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    this.pauseTimer = null;
    this.state.pause = null;
    const r = this.pauseResolve;
    this.pauseResolve = null;
    if (r) r();
    this.changed();
  }

  private fail(err: unknown): void {
    if (this.state.status === 'stopped') return;
    const msg = String((err as Error)?.message ?? err);
    this.state.status = 'error';
    this.state.error = msg;
    this.state.finishedAt = now();
    this.state.pause = null;
    this.state.currentStepId = null;
    this.log(`Error: ${msg}`);
    this.changed();
  }

  private addTotals(u: Usage): void {
    const t = this.state.totals;
    t.calls += 1;
    t.outputTokens += u.outputTokens;
    t.thinkingTokens += u.thinkingTokens ?? 0;
    t.inputTokens += u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens;
    t.costUsd += u.costUsd ?? 0;
  }

  /** Tool calls within a step collapse into one log line that updates in place; notes get their own line. */
  private progress(e: ProgressEvent): void {
    if (e.type === 'note') { this.log(e.text); return; }
    this.toolCalls[e.name] = (this.toolCalls[e.name] ?? 0) + 1;
    const text = `${this.state.currentStepId ?? 'step'} is researching: ${describeToolCalls(this.toolCalls)}`;
    if (this.toolLogEntry && this.state.log.includes(this.toolLogEntry)) {
      this.toolLogEntry.text = text;
      this.toolLogEntry.at = now();
      this.changed();
    } else {
      this.toolLogEntry = { at: now(), text };
      this.state.log.push(this.toolLogEntry);
      this.changed();
    }
  }

  private log(text: string): void {
    this.state.log.push({ at: now(), text });
    if (this.state.log.length > 500) this.state.log.shift();
    this.changed();
  }

  private changed(): void {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.emit('change', this.state);
      this.persist();
    }, 50);
  }

  private persist(): void {
    if (!this.state.id) return;
    try {
      writeFileSync(join(this.runsDir, `${this.state.id}.json`), JSON.stringify(this.state, null, 2));
    } catch {
      /* best effort */
    }
  }
}

function emptyState(provider: string, model: string): RunState {
  return {
    id: '',
    title: '',
    status: 'idle',
    provider,
    model,
    allowWeb: false,
    prompt: TASK_PROMPT,
    startedAt: null,
    finishedAt: null,
    pause: null,
    currentStepId: null,
    currentStepStartedAt: null,
    steps: [],
    executed: [],
    sectionOrder: [],
    sections: {},
    planUsage: null,
    totals: { outputTokens: 0, thinkingTokens: 0, inputTokens: 0, costUsd: 0, calls: 0 },
    log: [],
    error: null,
  };
}

function normalizeStepOutput(o: Partial<StepOutput> | undefined): StepOutput {
  return {
    summary: o?.summary ?? '',
    assumptions: arr(o?.assumptions),
    decisions_to_confirm: arr(o?.decisions_to_confirm),
    section_updates: arr(o?.section_updates).filter((u) => u && u.section_id && typeof u.markdown === 'string'),
    new_steps: arr(o?.new_steps).filter((s) => s && s.title),
    effort_changes: arr(o?.effort_changes).filter((c) => c && c.step_id),
  };
}

export function describeToolCalls(calls: Record<string, number>): string {
  const names: Record<string, [string, string]> = {
    WebSearch: ['web search', 'web searches'], web_search: ['web search', 'web searches'],
    WebFetch: ['page fetched', 'pages fetched'], web_fetch: ['page fetched', 'pages fetched'],
  };
  return Object.entries(calls)
    .map(([name, n]) => { const [one, many] = names[name] ?? [`${name} call`, `${name} calls`]; return `${n} ${n === 1 ? one : many}`; })
    .join(', ');
}

function arr<T>(x: T[] | undefined | null): T[] {
  return Array.isArray(x) ? x : [];
}

function slug(s: string): string {
  return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
}

function zeroUsage(): Usage {
  return { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, thinkingTokens: null, costUsd: null, durationMs: 0 };
}

function now(): string {
  return new Date().toISOString();
}
