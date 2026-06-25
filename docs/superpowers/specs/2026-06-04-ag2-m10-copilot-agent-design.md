# AG2 M10 Copilot Agent Design

## Goal

Build the first deterministic M10 Copilot orchestration layer. It routes an explicit intent to an already grounded Agent, returns one consistent Copilot envelope, and preserves the child AgentOutput without adding free-form LLM reasoning or executable actions.

## Scope

In scope:

- Add `runM10CopilotAgent(input)` under `features/ai`.
- Add `POST /api/ai/copilot` for MCN staff.
- Support these explicit intents:
  - `pricing_tradeoff`
  - `casting_advice`
  - `project_review`
  - `script_optimization`
- Return `intent`, `copilotSummary`, `routedResult`, `agentOutput`, and `validation`.
- Preserve the routed Agent facts, findings, caveats, recommendations, and validation.
- Keep all recommendations human-approval only.

Out of scope:

- No natural-language intent parsing.
- No LLM provider call in this slice.
- No automatic project, invitation, settlement, pricing, or task mutation.
- No database write in `/api/ai/copilot`.
- No script draft persistence from Copilot; script persistence remains owned by `/api/ai/scripts`.

## Public Contract

`M10CopilotInput` accepts:

- `intent`: `pricing_tradeoff | casting_advice | project_review | script_optimization`
- `payload`: the existing input payload for the selected Agent

`M10CopilotSummary` returns:

- `intent`
- `title`
- `status`: `ready_for_review | needs_review | blocked`
- `nextStep`
- `requiresHumanApproval: true`
- `persistence`: `read_only | draft_not_persisted`

`M10CopilotAgentResult` returns:

- `intent`
- `copilotSummary`
- `routedResult`
- `agentOutput`
- `validation`

## Routing Rules

- `pricing_tradeoff` calls `runPricingTradeoffAgent(payload)`.
- `casting_advice` calls `runCastingAdviceAgent(payload)`.
- `project_review` calls `runBusinessAnalysisAgent(payload)` and maps `output` to `agentOutput`.
- `script_optimization` calls `runScriptOptimizationAgent(payload)` and returns the draft as not persisted.
- Unknown intents throw a route-safe error.

## Summary Rules

- Pricing:
  - `pause_commitment` maps to `blocked`.
  - `raise_quote_review` maps to `needs_review`.
  - `approve_review` maps to `ready_for_review`.
- Casting:
  - A top `manual_review` candidate maps to `needs_review`.
  - Empty advice maps to `blocked`.
  - Otherwise maps to `ready_for_review`.
- Project review:
  - `shouldContinue` maps to `ready_for_review`.
  - Otherwise maps to `needs_review`.
- Script optimization:
  - Always maps to `needs_review` because the draft must be reviewed before use.

## Security

- `/api/ai/copilot` uses `createSupabaseServerClient`, `getAuthContext`, and `isMcnStaff`.
- Unauthenticated requests return `401`.
- Streamer role receives `403`.
- The route does not call `.from(...).insert(...)` or any database write.
- The Copilot Agent does not expose extra data beyond the selected child Agent payload and output.

## Testing

- Unit test routing for pricing, casting, project review, and script optimization.
- Unit test unsupported intent errors.
- Unit test that the returned AgentOutput validates and keeps numeric claims inside child facts.
- Route test MCN staff success, streamer denial, unauthenticated denial, and read-only database behavior.
- Run `test:ai-system`, `test:p4-flywheel`, `test:golden`, lint, type-check, full tests, and build.

## Self Review

- The design keeps Copilot deterministic and explicit-intent only.
- It preserves the evidence model already enforced by child Agents.
- It avoids adding a second persistence path for scripts.
- It leaves LLM natural-language orchestration for a future AI-3 style slice.
