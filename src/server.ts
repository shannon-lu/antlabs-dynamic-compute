import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { MAX_PROMPT_CHARS, Orchestrator } from './orchestrator.js';
import { TASK_PROMPT } from './prompts.js';
import { selectProvider } from './providers/index.js';
import { MODELS } from './types.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const runsDir = join(root, 'runs');
mkdirSync(runsDir, { recursive: true });

const port = Number(process.env.PORT ?? 4310);
const pauseMs = Number(process.env.COLLABORATE_PAUSE_MS ?? 10000);
const defaultModel = process.env.COLLABORATE_MODEL ?? 'claude-opus-5-5';

const provider = selectProvider();
const orchestrator = new Orchestrator(provider, runsDir, pauseMs, defaultModel);

const app = express();
app.use(express.json());
app.use(express.static(join(root, 'public'), { etag: false, lastModified: false, setHeaders: (res) => res.setHeader('Cache-Control', 'no-store') }));

// On macOS, keep the machine from idle-sleeping while a run is active. A sleep drops the
// model stream and the step restarts from scratch when the connection comes back.
let caffeinate: ChildProcess | null = null;
orchestrator.on('change', () => {
  if (process.platform !== 'darwin') return;
  if (orchestrator.busy && !caffeinate) {
    caffeinate = spawn('caffeinate', ['-i', '-s'], { stdio: 'ignore' }); // -i: no idle sleep, -s: no system sleep while on AC power
    caffeinate.on('exit', () => { caffeinate = null; });
  } else if (!orchestrator.busy && caffeinate) {
    caffeinate.kill();
    caffeinate = null;
  }
});
process.on('exit', () => caffeinate?.kill());

const clients = new Set<Response>();
orchestrator.on('change', (state) => {
  const payload = `data: ${JSON.stringify(state)}\n\n`;
  for (const res of clients) res.write(payload);
});

app.get('/api/events', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify(orchestrator.state)}\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
});

app.get('/api/config', (_req, res) => {
  res.json({
    provider: provider.name,
    providerDescription: provider.description,
    models: MODELS,
    defaultModel,
    pauseMs,
    defaultPrompt: TASK_PROMPT,
    maxPromptChars: MAX_PROMPT_CHARS,
  });
});

app.get('/api/state', (_req, res) => res.json(orchestrator.state));

function action(fn: (req: Request) => void | Promise<void>) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ ok: false, error: String((err as Error).message ?? err) });
    }
  };
}

app.post('/api/run/start', action(async (req) => {
  const model = typeof req.body?.model === 'string' && MODELS.some((m) => m.id === req.body.model) ? req.body.model : defaultModel;
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt : '';
  await orchestrator.start({ model, allowWeb: Boolean(req.body?.allowWeb), prompt });
}));
app.post('/api/run/stop', action(() => orchestrator.stop()));
app.post('/api/run/effort', action((req) => orchestrator.setEffort(String(req.body?.stepId), String(req.body?.effort))));
app.post('/api/run/pause/extend', action((req) => orchestrator.extendPause(Number(req.body?.ms ?? 30000))));
app.post('/api/run/pause/continue', action(() => orchestrator.continueNow()));

app.listen(port, () => {
  console.log(`Claude Collaborate  http://localhost:${port}`);
  console.log(`Backend: ${provider.description}`);
  console.log(`Default model: ${defaultModel}. Pause: ${pauseMs / 1000}s. Runs are saved in ${runsDir}`);
});
