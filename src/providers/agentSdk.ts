import { query, type SDKMessage, type SDKResultMessage, type Options } from '@anthropic-ai/claude-agent-sdk';
import type { CallOptions, CallResult, Conversation, Provider } from './types.js';
import type { Usage } from '../types.js';

/**
 * Talks to Claude through the Claude Agent SDK, which runs the Claude Code engine
 * locally. Authentication is whatever Claude Code is signed in with on this machine:
 * a Claude Pro/Max subscription login by default, or ANTHROPIC_API_KEY if that is set.
 *
 * Each step is one query() call that resumes the same session with its own `effort`.
 * Verified on 2026-10-09 (see README): the effort passed on a resumed call is honored.
 */
class SdkConversation implements Conversation {
  private sessionId: string | null = null;
  private lastCost = 0;

  constructor(private systemPrompt: string, private workDir: string) {}

  async send<T>(prompt: string, opts: CallOptions): Promise<CallResult<T>> {
    const env: Record<string, string | undefined> = { ...process.env };
    // A global effort override would silently defeat per-step effort.
    delete env.CLAUDE_CODE_EFFORT_LEVEL;

    const webTools = opts.allowWeb ? ['WebSearch', 'WebFetch'] : [];
    const options: Options = {
      model: opts.model,
      effort: opts.effort,
      systemPrompt: this.systemPrompt,
      tools: webTools,
      allowedTools: webTools,
      maxTurns: opts.allowWeb ? 40 : 4,
      settingSources: [],      // ignore the user's Claude Code settings and CLAUDE.md files
      strictMcpConfig: true,
      persistSession: true,
      cwd: this.workDir,
      env: env as Record<string, string>,
      outputFormat: { type: 'json_schema', schema: opts.schema },
      abortController: abortFrom(opts.signal),
      ...(this.sessionId ? { resume: this.sessionId } : {}),
    };

    const started = Date.now();
    let result: SDKResultMessage | undefined;
    for await (const msg of query({ prompt, options }) as AsyncIterable<SDKMessage>) {
      if (msg.type === 'result') result = msg;
      else if (msg.type === 'system' && (msg as any).subtype === 'api_error' && opts.onProgress) {
        // Claude Code retries dropped connections (for example after the computer sleeps) on its own,
        // but a retry restarts the generation, so tell the person why the step is taking longer.
        const e = (msg as any).error;
        opts.onProgress(`Connection problem, Claude Code is retrying (attempt ${(msg as any).retryAttempt ?? '?'}): ${e?.formatted ?? e?.message ?? 'unknown error'}`);
      } else if (msg.type === 'assistant' && opts.onProgress) {
        const content = (msg as any).message?.content as Array<{ type: string; name?: string }> | undefined;
        const tool = content?.find((c) => c.type === 'tool_use');
        if (tool) opts.onProgress(`Using ${tool.name}`);
      }
    }
    if (!result) throw new Error('Claude returned no result message');
    this.sessionId = result.session_id;

    if (result.subtype !== 'success') {
      const errs = (result as any).errors as string[] | undefined;
      throw new Error(`Claude run ended with ${result.subtype}${errs?.length ? ': ' + errs.join('; ') : ''}`);
    }

    const output = (result.structured_output ?? tryParse(result.result)) as T | undefined;
    if (output === undefined) throw new Error('Claude did not return structured output');

    const u = result.usage as any;
    const cost = typeof result.total_cost_usd === 'number' ? result.total_cost_usd : null;
    const usage: Usage = {
      inputTokens: u?.input_tokens ?? 0,
      cacheReadTokens: u?.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u?.cache_creation_input_tokens ?? 0,
      outputTokens: u?.output_tokens ?? 0,
      thinkingTokens: u?.output_tokens_details?.thinking_tokens ?? null,
      costUsd: cost === null ? null : Math.max(0, cost - this.lastCost), // total_cost_usd is cumulative across the session
      durationMs: Date.now() - started,
    };
    if (cost !== null) this.lastCost = cost;
    return { output, usage, raw: { session_id: result.session_id, num_turns: result.num_turns } };
  }
}

function abortFrom(signal: AbortSignal): AbortController {
  const ac = new AbortController();
  if (signal.aborted) ac.abort();
  else signal.addEventListener('abort', () => ac.abort(), { once: true });
  return ac;
}

function tryParse(text: string | undefined): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return undefined;
    try { return JSON.parse(m[0]); } catch { return undefined; }
  }
}

export const agentSdkProvider: Provider = {
  name: 'sdk',
  description: process.env.ANTHROPIC_API_KEY
    ? 'Claude Agent SDK, billed to ANTHROPIC_API_KEY'
    : 'Claude Agent SDK, using your Claude Code login',
  open(systemPrompt, workDir) {
    return new SdkConversation(systemPrompt, workDir);
  },
};
