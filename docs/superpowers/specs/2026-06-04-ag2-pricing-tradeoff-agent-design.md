# AG2 Pricing Tradeoff Agent Design

## Goal

Build a read-only pricing tradeoff Agent that wraps the existing project pricing calculator with the shared AgentOutput contract. The Agent explains quote economics, margin risk, and review proposals without changing project pricing, settlement rules, or downstream commitments.

## Scope

In scope:

- Reuse `calculateProjectPricing` as the source of pricing truth.
- Add `runPricingTradeoffAgent(input)` under `features/ai`.
- Extend `POST /api/ai/briefs` with `kind: "pricing"`.
- Keep existing casting brief behavior compatible when `kind` is absent or `"casting"`.
- Return `pricing`, `tradeoffAdvice`, `agentOutput`, and `validation`.
- Keep every numeric claim inside `agentOutput.facts`.
- Require human approval for all recommendations.

Out of scope:

- No project quote mutation.
- No settlement rule mutation.
- No task, invitation, billing, or learning-weight mutation.
- No supplier or streamer allocation changes.
- No LLM provider call in this step.

## Public Contract

`PricingTradeoffInput` accepts:

- All fields from `ProjectPricingInput`
- `kind?: "pricing"` when sent to `/api/ai/briefs`

`PricingTradeoffAdvice` returns:

- `decision`: `approve_review | raise_quote_review | pause_commitment`
- `riskLevel`: `low | medium | high`
- `recommendedSettlementMethod`
- `riskNotes`
- `reviewChecklist`

`POST /api/ai/briefs` accepts either:

- Casting input: omitted `kind` or `kind: "casting"`
- Pricing input: `kind: "pricing"`

The route response for pricing contains:

- `pricing`: `ProjectPricingResult`
- `tradeoffAdvice`: `PricingTradeoffAdvice`
- `agentOutput`: shared AgentOutput
- `validation`: shared AgentOutput validation result

## Evidence Rules

- Fact sources use `sourceTool: "pricing_tradeoff"`.
- Fact source IDs use stable field names, for example `pricing_tradeoff:marginRateBps`.
- Findings only cite existing facts.
- Findings, caveats, and recommendations contain no digits.
- Caveats represent unverified external factors such as demand movement, competitor timing, and finance approval state.
- Recommendations are proposals only and must require human approval.

## Decision Rules

- If the pricing calculator emits `negative_margin`, return `pause_commitment`.
- If it emits `low_margin`, `invalid_margin_target`, `high_platform_fee`, or `zero_receivable`, return `raise_quote_review`.
- If there are no risk notes, return `approve_review`.
- Risk level is high for negative margin, invalid margin target, or zero receivable.
- Risk level is medium for low margin or high platform fee.
- Risk level is low when no risk notes exist.

## Security

- `/api/ai/briefs` requires a Supabase client and `getAuthContext`.
- Streamer role receives `403`.
- Unauthenticated requests receive `401`.
- Pricing brief performs no database writes.
- Returned pricing economics are only available to MCN staff through the AI route.

## Testing

- Unit test a healthy quote with fully sourced facts and no numeric claims outside facts.
- Unit test low margin and negative margin decisions.
- Route test `kind: "pricing"` success, default casting compatibility, streamer denial, unauthenticated denial, and no database writes.
- Existing `test:ai-system` and `test:p4-flywheel` must include the new Agent and route tests through current globs.

## Self Review

- The design reuses the existing pricing calculator instead of introducing a parallel economics model.
- It keeps AG-2 pricing advice read-only and compatible with current casting briefs.
- It avoids AI-3 learning or active automation.
- It does not expose pricing economics to streamer roles.
