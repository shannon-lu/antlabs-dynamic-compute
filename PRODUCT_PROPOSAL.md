# Product Proposal: Claude Collaborate

## Summary

Claude Collaborate lets a user steer a long agent task while it runs, so the work is a collaboration and not a hand-off. The user sees the plan, follows each step as it finishes, and corrects course before later steps build on a mistake.

**What is new is the effort dial.** Claude sets an effort level for every planned step, and the user can change it before the step starts. A visible plan is familiar from other tools. Effort that the agent sets per step, and the user can override, is the part this product adds.

V1 is a proof of concept. Claude cannot yet change its own effort inside one agent turn, so the prototype simulates that by sending each step as its own message at its own effort level. The capability prediction doc holds the evidence for the bet. The prototype is in this repository, and the [README](README.md) explains how to run it.

## Why Anthropic

- **Only the model developer can close the loop.** User overrides show where Claude's effort judgment is off. That data trains Claude to set its own effort, which turns this simulation into a real capability. The first data comes from internal users.
- **It makes oversight practical as autonomy grows.** V1 lets a person correct a step before work is spent on it. Later versions expose Claude's assumptions and decisions and let the user correct them, so longer tasks stay inspectable.
- **It grows delegated work.** People hand off more when they can steer. Matching effort to each step also lowers the compute a long task needs.

## Problem and user

As agents run longer with less supervision, the bottleneck shifts from intelligence to steering. Today a long task starts from one prompt and returns one answer. If step 3 of 12 is wrong, the user finds out after steps 4 to 12 have built on it. The whole task also runs at one effort level, which overspends on routine steps and can under-think the hard ones.

V1 is for people who hand Claude a long research or planning task and know which parts matter most. Examples are an analyst building a market brief or a couple planning a complex trip. They hold context Claude lacks, and a wrong result costs them a full rerun. V1 is not for short chats, which need no plan.

## V1 Prototype

V1 is a document with a side panel. The task prompt sits above the document, pre-filled with the example below and editable before a run starts. The document holds the result and fills in as steps finish. The side panel has three tabs.

| Tab | What it shows | What the user can do |
| --- | --- | --- |
| Planned steps | Every step not yet finished, in order, with the effort Claude chose and a one-line reason. The step Claude is working on stays in this tab, locked and marked in progress. | Change the effort on any step that has not started |
| Executed steps | One card per finished step: what the step did, the effort used and who chose it, output and thinking tokens, time, estimated cost, web calls, sections written, any assumption or decision Claude made, and any plan change the step caused. A step interrupted by Stop is marked stopped. | Read the audit |
| Log | A time-ordered record of the run: plan, pauses, effort changes, reconnects and errors. Web research within a step collapses to one line that updates in place. | Read the log |

Five rules govern the run:

- **Effort levels.** Claude and the user choose from all five: low, medium, high, xhigh and max.
- **Pauses.** The run pauses briefly (10 seconds by default) after the plan and before any step Claude flags as uncertain, then continues on its own. The user can extend a pause or end it early, and can also change effort on any unstarted step while the run is going.
- **Plan changes.** After a step, Claude can add steps or change the effort on later ones, marking each change with its reason.
- **User choices hold.** Claude never changes an effort level the user set.
- **Document updates.** The document shows the latest version of each section. An edited section shows changes against its previous version. A section Claude rewrote almost entirely shows clean, with the changes one click away.

## User stories

Each story maps to one piece of v1 behavior and can be tested as written.

**Planned steps tab**

- As a user, I can see every planned step with its effort level and a one-line reason before any step runs, so that I can review the plan.
- As a user, I can change the effort on any planned step to any of the five available levels and see later that Claude executed that step with my applied change in effort.
- As a user, I can see the step in progress marked clearly and I cannot change an in-progress step's effort level.
- As a user, I can see a marker and a one-line reason on any planned step that Claude added or whose effort Claude changed.
- As a user, my changes to effort level are not overwritten when Claude updates the plan.

**Run**

- As a user, after the plan and before any step Claude flagged as uncertain, I can see the run pause, change effort levels during the pause, and see the run continue on its own when the pause ends.

**Executed steps tab**

- As a user, I can audit each finished step with what it did, the effort used, the tokens used and any assumption or decision made.

## Example scenario

The example asks Claude to plan a 30-day road trip for two people. Its constraints are chosen so the steps need visibly different effort: some carry safety or scheduling risk, and some are easy. The prompt below is pre-filled in the prototype and can be edited or replaced with any long task. More example prompts are in the [prompt_examples](prompt_examples) directory.

```text
Plan a 30-day road trip for my partner and me, and write it up as a day-by-day itinerary.

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

Make the decisions for us, but do not book or pay for anything. List every assumption you make and every decision you want us to confirm.
```

The table shows the spread of effort we expected across the plan when the proposal was written. The first real run on Opus 5.5 came close: route at xhigh, charging at xhigh, lodging and restaurants at high or above, budget at medium, packing at low. The README has the full numbers.

In that run the user raised the restaurant step to max during the plan pause, and the step ran at max. After pricing lodging, Claude raised the budget step from medium to high and gave its reason. The charger reroute moment did not occur in that run; it remains a possible outcome, not a scripted one.

| Step | Expected effort | Why |
| --- | --- | --- |
| Fix the route and overnight stops around the wedding date | xhigh | Every later step depends on it |
| Plan charging for each driving day | high | A gap strands the car |
| Find places that suit the allergy and the vegetarian diet | high | A mistake has health consequences |
| Choose lodging that fits the work mornings | high | Time zones change along the route |
| Check the plan against the budget | medium | Arithmetic on earlier results |
| Pick hikes, hot springs and photo stops | low | Easy to change later |
| Write the packing list | low | Low stakes |

## How the prototype works

The prototype shows a run as one continuous agent turn and builds it from many short turns. It is a simulation of dynamic effort.

**How effort is applied.** The prototype runs through the Claude Agent SDK under the user's Claude Code login, so a Pro or Max subscription is enough. Each step resumes the same conversation with its own effort level, and the level on each call wins over the one the session started with (verified before building). A second mode uses the Messages API directly with an API key and the per-message effort beta, which keeps the prompt cache across effort changes; that mode was written from the API reference and has not been exercised.

**Model.** Claude Opus 5.5 is the default. It supports all five effort levels and per-message effort, and costs less than half as much per token as Fable 5.1. Sonnet 5.5 and Fable 5.1 are selectable. The final comparison should be repeated on Fable 5.1, the model built for long-horizon work.

**What the simulation cannot show.** Claude chooses each level but the app applies it, and steps are coarser than those inside a real turn. Claude is not told which level it is running at. With web research off, the default, facts come from the model's knowledge rather than live sources. The prototype shows the experience, not that Claude can judge effort inside a turn.

## What the prototype proves

The prototype answers four questions. The targets are starting points, to be revised after the first ten runs.

| Question | Measure | Starting target |
| --- | --- | --- |
| Does step-level effort save work without lowering quality? | Ten runs of the demo prompt: five with every step set to high during the plan pause, five at Claude's chosen levels. The prototype has no automated comparison mode; its HTTP routes can be scripted. | At least 25% fewer output tokens, with quality within 0.3 points |
| Do users steer when they can? | Ten internal users, one session each; sessions with an effort change | 50% or more |
| Does steering improve the result? | Each changed step is replayed at Claude's original level, and raters pick the better version | The user's version wins 60% or more |
| Is Claude's effort judgment sound? | Steps Claude later repeats or repairs | 10% or fewer |

**How quality is rated.** Two people who did not run the task score each document blind, from 1 to 5, on constraints met, accuracy of spot-checked facts, completeness and usability.

## Risks

- **A low-effort step derails later steps.** Planning and source-gathering steps start at high, and Claude picks the higher level when unsure.
- **Users ignore the panel.** The run pauses after the plan, and the share of sessions with an effort change is measured.

## Out of scope for v1

V1 lets the user edit one thing: the effort on a step that has not started.

- Adding a note on a step to provide additional guidance or a correction, especially on uncertain steps. 
- Priority levels on steps, which allow the user to specify which steps are more important to start before others.
- Correcting a completed step, with the steps that depend on it queued again.
- Actions with real-world consequences, such as booking, paying or submitting forms. V1 produces a document only.
- Cost or time estimates before a step runs.
- Editing the document text directly.
- Loading a saved run back into the UI. Runs are saved as JSON for audit only.
