# Claude Collaborate — prototype

A clickable prototype of the product in [PRODUCT_PROPOSAL.md](PRODUCT_PROPOSAL.md): steer a long Claude task while it runs, with an **effort dial on every step**. Claude plans the steps and picks an effort level for each. You can change any level before the step starts, and the app sends that level to Claude for real. The capability bet behind it is in [CAPABILITY_PREDICTION.md](CAPABILITY_PREDICTION.md).

Everything you see comes from live model calls. There is no mock mode and no canned output.

![Planned steps tab during a run](docs/planned-steps.png)

![Executed steps tab with per-step effort and tokens](docs/executed-steps.png)

## Run it

You need Node 20 or newer and a Claude Pro or Max subscription signed in to Claude Code on this machine (or an API key, see below).

```bash
git clone <this repo> && cd antlabs-dynamic-compute
npm install
npm start
# open http://localhost:4310
```

If you have never used Claude Code here, sign in first:

```bash
npm install -g @anthropic-ai/claude-code
claude          # follow the login prompt, then quit
claude auth status   # should show "loggedIn": true
```

Optional check before the first run, two tiny calls on your login:

```bash
npm run doctor
```

Then press **Start run**. Claude plans the road trip task, pauses 10 seconds so you can review and change effort levels, and then works through the steps. The document on the left fills in as steps finish. The side panel shows the planned steps (with editable effort) and the executed steps (with the effort used, tokens spent, assumptions and decisions).

### Options

Copy `.env.example` to `.env` to change defaults. The important ones:

| Variable | Default | What it does |
| --- | --- | --- |
| `COLLABORATE_PROVIDER` | `sdk` | `sdk` runs Claude through the Claude Agent SDK with your Claude Code login. `api` calls the Messages API directly with `ANTHROPIC_API_KEY`. |
| `ANTHROPIC_API_KEY` | unset | Required for `api`. If set with `sdk`, the SDK bills the key instead of your subscription. |
| `COLLABORATE_MODEL` | `claude-opus-5-5` | Default model in the UI. Opus 5.5, Sonnet 5.5 and Fable 5.1 all support the five effort levels. |
| `COLLABORATE_PAUSE_MS` | `10000` | Pause after the plan and before uncertain steps. |
| `PORT` | `4310` | Local port. |

**Allow web research** in the header lets Claude use web search and fetch during steps. It is off by default because it makes steps several times slower. Without it, Claude plans from its own knowledge, which is fine for the demo but means chargers and restaurants are not verified.

Each run is saved as JSON under `runs/` for audit.

## What it does

1. **Plan.** One call at `high` effort returns the document outline and 5 to 10 steps, each with an effort level (`low`, `medium`, `high`, `xhigh`, `max`), a one-line reason, and an "uncertain" flag.
2. **Pause.** The run pauses 10 seconds. You can extend the pause, end it early, or change effort levels. You can also change levels at any time while the run is going, on any step that has not started.
3. **Steps.** Each step is one message to Claude in the same conversation, sent at the step's current effort: yours if you set one, otherwise Claude's. Claude returns the full new content of the sections it changed, its assumptions, decisions to confirm, and any plan changes.
4. **Plan changes.** After a step Claude can add steps or change the effort of later steps, with a reason. Each change is marked on the step card. A level you set is never overwritten: Claude's proposal is recorded and shown as "kept your choice", and Claude is told on its next message.
5. **Document.** Each section keeps every version. An edited section shows changes against the previous version (added blocks green, removed blocks red). A section that was rewritten almost entirely shows clean, labelled "rewritten", with a "show changes" toggle. Both can be switched per section.
6. **Audit.** The Executed steps tab shows, per step: the effort used and who chose it, output tokens, thinking tokens, input tokens including cache, wall time, estimated cost, and the assumptions and decisions.

## Decisions made while building

These were open questions in the proposal or came up during the build. Each has the choice and the reason.

1. **Subscription access goes through the Claude Agent SDK.** It is the only supported way to run Claude under a Claude Pro/Max login; the Messages API needs an API key. The SDK runs the Claude Code engine locally and uses whatever Claude Code is signed in with. Note the docs say third-party developers may not offer claude.ai login *in their products* without approval. This prototype is a local tool each person runs under their own existing login, not a product offering login, but if you distribute it widely, check with Anthropic.
2. **Effort on a resumed session is honored, verified empirically.** The docs do not say whether `effort` passed on a resumed call takes effect. Tested on 2026-10-09 with the installed CLI (2.1.296): a fresh session at `low` produced 51 output tokens and at `max` 249 on the same puzzle; resuming the `low` session at `max` on a second puzzle produced 198 tokens, and resuming the `max` session at `low` produced 109. The level passed on each call wins. Sample size is small; the Executed tab shows the same signal on every run.
3. **An API-key path exists but is untested.** `COLLABORATE_PROVIDER=api` uses the Messages API with the per-message effort beta (`mid-conversation-output-config-2026-07-01`): an effort-only system message before each user turn, which keeps the prompt cache across effort changes. It was written from the API reference without a key to test against, so expect small fixes. The `sdk` provider also accepts a key via `ANTHROPIC_API_KEY`, which is the tested way to use a key.
4. **One conversation per run, one message per step.** Later steps see earlier results through the conversation history. This matches the proposal's "simulation of dynamic effort" and avoids re-sending the document each step.
5. **The plan call runs at `high`.** The proposal says planning steps start at high and Claude picks the higher level when unsure. The plan's own effort is not user-editable because nothing exists yet to edit.
6. **Claude is not told what effort level it is running at.** The point of the demo is that effort is a real inference parameter, not an instruction. Telling the model "you are at low effort" would confound the two.
7. **Steps run strictly in order, one at a time.** The proposal's model is a single agent turn, and sequential steps keep the plan tab easy to read. Parallel steps are out of scope.
8. **Web tools are off by default.** They make the run several times longer. The toggle exists so a run can be grounded when the audience cares about accuracy.
9. **Tokens come from the per-call `usage` field.** If a connection drops mid-step and Claude Code retries, the step's count includes the abandoned attempts; the Log tab shows when that happened. Output tokens include thinking; thinking tokens are shown separately where the backend reports them (the SDK does, the direct API does not). Cost is the SDK's client-side estimate, shown as a delta per call because the SDK reports a running total.
10. **Document changes are marked at paragraph level.** A line-level LCS diff of the Markdown, with changed blocks rendered and marked. Word-level marking inside rendered Markdown was not worth the complexity for v1.
11. **New steps are inserted where Claude asks, but never before a step that already ran or is running.**
12. **The task prompt is fixed** to the road trip scenario from the proposal. An editable prompt was dropped from scope.
13. **Claude Code settings are ignored for the run.** The SDK is started with no setting sources so a user's `effortLevel` default or CLAUDE.md files cannot leak into the demo, and `CLAUDE_CODE_EFFORT_LEVEL` is removed from the environment because it would override per-step effort.
14. **Default model is Opus 5.5**, as the proposal recommends. Sonnet 5.5 and Fable 5.1 are selectable.
15. **The app keeps a Mac awake during a run.** The first full test run stalled for an hour because the laptop idle-slept while a step was generating; Claude Code reconnects after a wake, but the step restarts from scratch each time. The server now runs `caffeinate -i -s` while a run is active (macOS only), which blocks idle and system sleep while on AC power. It does not stop sleep when the lid is closed, so keep the lid open during a run.

## Results from the first full run

Opus 5.5, web research off, 2026-10-09. Two overrides were made during the plan pause: the restaurant step raised to `max`, the final check lowered to `low`. Output tokens include thinking.

| Step | Effort | Chosen by | Output tokens | Thinking | Time |
| --- | --- | --- | --- | --- | --- |
| Plan | high | app | 2,174 | 745 | 21s |
| 1. Route loop, overnight stops, calendar | xhigh | Claude | 117,141* | 105,566* | 81m* |
| 2. Charging for every driving day | xhigh | Claude | 42,829 | 34,133 | 6m 51s |
| 3. Lodging with Wi-Fi and charging | high | Claude | 13,572 | 6,887 | 2m 12s |
| 4. Two safe restaurants per stop | **max** | **you** (Claude chose xhigh) | 65,748 | 55,082 | 10m 32s |
| 5. Day-by-day itinerary | high | Claude | 15,290 | 5,761 | 2m 14s |
| 6. Budget against the $9,000 cap | high | Claude, raised from medium after step 3 | 6,510 | 2,944 | 1m 2s |
| 7. Photo stops and packing list | low | Claude | 1,607 | 0 | 16s |
| 8. Constraint check, assumptions, decisions | **low** | **you** (Claude chose high) | 3,750 | 156 | 32s |

\* Step 1 is inflated: the laptop slept four times during it and each reconnect restarted the generation.

Three things to point at in a demo. The effort gradient is real: the `low` steps used under 4,000 output tokens and almost no thinking, the `xhigh` steps used tens of thousands. Overrides are honored: step 4 ran at `max` and step 8 at `low`, both marked "you set" in the Executed tab. And Claude edited its own plan: after pricing lodging in step 3 it raised the budget step from `medium` to `high`, with the reason "Lodging alone is about $5,760, leaving roughly $3,240 for 30 days of food plus activities. The budget step will likely have to make real trade-offs, not just add things up."

A full run takes 25 to 40 minutes when the machine stays awake. The two `xhigh` steps and the `max` step are most of that.

## What the prototype cannot show

- Claude chooses each level but the app applies it between messages. Real in-turn effort switching is the capability being predicted, not demonstrated.
- Steps are coarser than those inside a real agent turn.
- Without web research, facts such as charger locations are from the model's knowledge and may be out of date.

## Layout

```
src/server.ts          Express server: static UI, SSE state stream, action routes
src/orchestrator.ts    The run: plan, pauses, steps, plan changes, document versions
src/prompts.ts         Task prompt, system prompt, JSON schemas, per-step prompt
src/providers/         sdk (Agent SDK, subscription login) and api (Messages API, key)
public/                Browser UI, no build step
runs/                  Saved run state, one JSON per run (gitignored)
```
