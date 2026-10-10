import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { selectProvider } from './providers/index.js';

/**
 * Checks that this machine can reach Claude with per-call effort before you start a run.
 * Makes two tiny calls (low, then max) in one conversation and prints the output tokens.
 */
const provider = selectProvider();
const model = process.env.COLLABORATE_MODEL ?? 'claude-opus-5-5';
console.log(`Backend: ${provider.description}`);
console.log(`Model:   ${model}`);
console.log(`Node:    ${process.version}`);

const workDir = join(tmpdir(), 'claude-collaborate-doctor');
mkdirSync(workDir, { recursive: true });
const conv = provider.open('You are a careful solver. Answer with only what is asked.', workDir);
const schema = { type: 'object', properties: { answer: { type: 'integer' } }, required: ['answer'], additionalProperties: false };
const ac = new AbortController();

try {
  for (const effort of ['low', 'max'] as const) {
    const r = await conv.send<{ answer: number }>(
      `How many ways can a 2x${effort === 'low' ? 6 : 7} board be tiled with 1x2 dominoes? Return the integer.`,
      { effort, model, allowWeb: false, schema, signal: ac.signal },
    );
    console.log(`  ${effort.padEnd(4)} effort: answer=${r.output.answer}, output tokens=${r.usage.outputTokens}, thinking=${r.usage.thinkingTokens ?? 'n/a'}, ${Math.round(r.usage.durationMs / 1000)}s`);
  }
  console.log('OK. Both calls went through on this login with their own effort level. On a trivial puzzle the token counts may be close; the difference shows on real steps.');
} catch (err) {
  console.error('FAILED:', (err as Error).message);
  console.error('If you use the sdk backend, run `claude auth status` and sign in with `claude` if needed.');
  process.exit(1);
}
