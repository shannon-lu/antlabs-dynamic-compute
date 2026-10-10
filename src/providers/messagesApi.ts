import Anthropic from '@anthropic-ai/sdk';
import type { CallOptions, CallResult, Conversation, Provider } from './types.js';
import type { Usage } from '../types.js';

/**
 * Talks to the Messages API directly with an API key. Effort is set per message with the
 * per-message effort beta (an effort-only system message before each user turn), so the
 * prompt cache survives effort changes between steps.
 *
 * This path was written from the API reference but has NOT been exercised end to end,
 * because no API key was available while building. Expect to fix small things.
 */
const EFFORT_BETA = 'mid-conversation-output-config-2026-07-01';

class ApiConversation implements Conversation {
  private messages: any[] = [];
  private client = new Anthropic();

  constructor(private systemPrompt: string) {}

  async send<T>(prompt: string, opts: CallOptions): Promise<CallResult<T>> {
    const started = Date.now();
    // Effort-only system message: changes effort from here on without a cache reset.
    this.messages.push({ role: 'system', content: [], output_config: { effort: opts.effort } });
    this.messages.push({ role: 'user', content: prompt });

    const tools: any[] = opts.allowWeb
      ? [
          { type: 'web_search_20260209', name: 'web_search', max_uses: 8 },
          { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 8 },
        ]
      : [];

    const stream = this.client.beta.messages.stream(
      {
        model: opts.model,
        max_tokens: 32000,
        betas: [EFFORT_BETA],
        system: [{ type: 'text', text: this.systemPrompt, cache_control: { type: 'ephemeral' } }],
        thinking: { type: 'adaptive' },
        output_config: {
          effort: opts.effort,
          format: { type: 'json_schema', schema: opts.schema },
        },
        ...(tools.length ? { tools } : {}),
        messages: this.messages,
      } as any,
      { signal: opts.signal },
    );
    const response: any = await stream.finalMessage();

    if (response.stop_reason === 'refusal') {
      throw new Error(`Claude declined this step (${response.stop_details?.category ?? 'refusal'})`);
    }
    // Keep the full content (thinking blocks included) so the history stays valid.
    this.messages.push({ role: 'assistant', content: response.content });

    const text = (response.content as any[])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    let output: T;
    try {
      output = JSON.parse(text) as T;
    } catch {
      throw new Error('Claude did not return valid JSON');
    }

    const u = response.usage ?? {};
    const usage: Usage = {
      inputTokens: u.input_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      thinkingTokens: null, // the Messages API does not break thinking tokens out of output_tokens
      costUsd: null,
      durationMs: Date.now() - started,
    };
    return { output, usage, raw: { id: response.id, stop_reason: response.stop_reason } };
  }
}

export const messagesApiProvider: Provider = {
  name: 'api',
  description: 'Messages API with per-message effort (beta), billed to ANTHROPIC_API_KEY',
  open(systemPrompt) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('COLLABORATE_PROVIDER=api needs ANTHROPIC_API_KEY');
    }
    return new ApiConversation(systemPrompt);
  },
};
