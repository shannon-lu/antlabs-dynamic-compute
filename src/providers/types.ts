import type { Effort, Usage } from '../types.js';

export interface CallOptions {
  effort: Effort;
  model: string;
  allowWeb: boolean;
  schema: Record<string, unknown>;
  signal: AbortSignal;
  onProgress?: (text: string) => void;
}

export interface CallResult<T> {
  output: T;
  usage: Usage;
  raw?: unknown;
}

/**
 * One conversation with Claude. Each call is one message at its own effort level.
 * The conversation keeps the history, so later steps see earlier results.
 */
export interface Conversation {
  send<T>(prompt: string, opts: CallOptions): Promise<CallResult<T>>;
}

export interface Provider {
  readonly name: string;
  readonly description: string;
  /** Start a new conversation with the given system prompt. */
  open(systemPrompt: string, workDir: string): Conversation;
}
