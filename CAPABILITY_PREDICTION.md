# Capability Prediction: Right-Sized Compute&#32;

Long agent tasks mix routine steps, hard steps, and steps that require a specialist. Today a task stays on one model at one effort level, so it overpays for the easy steps, underthinks the hard ones, and cannot cheaply bring in a specialist.

The long-term bet is a shared cache: models of different sizes and specializations read one cache, so each step goes to the right model at no switching cost. That is more than 12 months out, because model families must be trained for it.

The near-term step is effort. Within 12 months, a model on a long-running task will set its own effort at each step within an agent turn. Per-message effort is a feature currently in beta and doesn't invalidate the prompt cache on select models.&#32;

## Trends and Demand Signals

- **[Per-message effort](https://platform.claude.com/docs/en/build-with-claude/effort) (beta)****:**** **On select models, effort can be changed mid-conversation and does not invalidate the cache.
- **[Task budgets](https://platform.claude.com/docs/en/build-with-claude/task-budgets) (beta)****:** The model paces itself against a token countdown and scopes down when the budget is too small.
- **[Managed Agents advisor](https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration):** Self-initiated escalation already exists in multi-agent sessions. The agent decides when a step requires a stronger model.
- [**Claude Code issue #60200**](https://github.com/anthropics/claude-code/issues/60200)**:** Users ask for effort that adapts per turn.
- **T****y****p****e****S****a****f****e****'****s**** ****Jev:** A specialized model that returns typed decisions, such as which model should handle a step, instead of text. Within a week of its September launch, four model gateways and three agent frameworks had integrated it, a sign of demand for specialized models and for compute matched to the size of the judgment.

## Recent Research

- **[Adaptive Reasoning Effort Selection (ARES)](https://arxiv.org/pdf/2603.07915) (March 2026):** Setting effort per step cuts cost without losing accuracy, and can raise it. A 1.7B trained router cut an agent’s reasoning tokens 35–45% on three agent benchmarks, with accuracy within 2 points of fixed high effort. With further training it beat high effort by about 4 points on tool-use tasks at under half the tokens, because high effort sometimes hurts.
- [**DroidSpeak**](https://www.usenix.org/system/files/nsdi26-liu-yuhan.pdf)** (May 2026):** Specialized models fine-tuned from the same base model can reuse each other’s cache. The receiving model recomputes only a few layers and reuses the rest, making prefill 1.7–3.1x faster and throughput up to 4x higher with negligible quality loss. The waste this removes is large: in a realistic four-agent workflow, 49% of tokens were context that had already been processed.
- **[Cross-model cache transfer](https://arxiv.org/pdf/2608.03893) (August 2026)****:** A cache built by one model can be converted for a different-sized model in the same family without reprocessing. An NVIDIA linear mapping did this 2.7 to 25 times faster than reprocessing. Four of six pairs kept 73–98% of accuracy averaged over five benchmarks; the other two fell to 42–44%.

## Characteristics

|  | Self-directed effort (within 12 months) | Shared cache across models (long-term bet) |
| --- | --- | --- |
| What it is | Before each step, the model judges how hard the step is and sets its own effort. | Models of different sizes or specializations read one cache directly, so a task moves between them with no reprocessing and no translation step. Mixture-of-experts models already do this inside a single model: experts are selected after attention, so every expert reads the same cache (DroidSpeak, tested on Mixtral). |
| Cost of switching | None intended; feature is still in beta. Per-message effort keeps the prompt cache. | None by design. |
| What it enables | Results can start rough and deepen where needed; a cost quote before work starts; agents that idle cheaply. | Small-model compute for routine steps and large-model compute for more complex ones. Switches between specialized models or different sized models are possible without context reloads. |

## Limitations

- **Self-assessment is unproven.** The measured savings come from a separately trained router. When frontier models were simply prompted to choose the effort, accuracy fell by up to 15 points, which suggests the skill must be trained.
- **Errors compound.** A step given too little effort can derail every step after it, so a wrong call can cost more than it saved. In one research benchmark, low effort on every step cut accuracy from 43% to 8%.
- **The evidence is on open models.** The ARES study used a 20B agent. On a 120B agent the router was never trained on, savings fell to 23%. Nothing here is shown on frontier models.
- **Today's hand-offs are narrow.** DroidSpeak works only between models fine-tuned from the same base model. The NVIDIA method was tested only within a model family, needs a separate 4–12 GB mapping for each pair and direction, and kept math reasoning above 90% on only one of six pairs.
- **A shared cache has to be designed in.** Models must be trained to read the same cache, so model families would be built for it from the start. No frontier lab has published one.

## Readiness

| Stage | Today | Expected |
| --- | --- | --- |
| A router sets effort per step | Shown in research on open models (ARES) | Products within 6 months |
| The model sets its own effort per step | Not shipped. Budget pacing and advisor escalation are the nearest shipped behaviors | 6 to 12 months |
| Cached hand-offs between fine-tuned variants of one base model | Peer-reviewed, built on open serving software (DroidSpeak) | Within 12 months for self-hosted models |
| Cached hand-offs across model sizes | Research on open models up to 70B; reasoning degrades | 12 months or more at frontier scale |
| Shared cache across models | Not built at scale | Beyond 12 months (long-term bet) |
