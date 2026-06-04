# AG2 Casting Advice Agent Design

## Goal

Build a read-only casting advice Agent that wraps the existing streamer matching engine with the shared AgentOutput contract. The Agent recommends who should be reviewed for invitation, names risks, and keeps all numeric claims grounded in facts.

## Scope

In scope:

- Reuse `rankStreamerCandidates` as the source of matching truth.
- Add `runCastingAdviceAgent(input)` under `features/ai`.
- Add `POST /api/ai/briefs` for MCN staff.
- Return `matches`, `candidateAdvice`, `agentOutput`, and `validation`.
- Keep every number in `agentOutput.facts`.
- Require human approval for all recommendations.

Out of scope:

- No automatic streamer invitations.
- No schedule, project status, settlement, or learning-weight mutation.
- No supplier scoring changes.
- No LLM provider call in this step.

## Public Contract

`CastingAdviceInput` accepts:

- `project`: `MatchingProjectContext`
- `candidates`: `StreamerCandidateSnapshot[]`
- `maxRecommendations?: number`

`CandidateAdvice` returns:

- `streamerId`
- `streamerName`
- `rank`
- `suggestedSettlementMethod`
- `recommendation`: `invite | backup | manual_review`
- `reasons`
- `riskNotes`

`/api/ai/briefs` accepts the same input and returns the full Agent result. It uses the same MCN staff guard as `/api/war-room/matching`.

## Evidence Rules

- Fact sources use `sourceTool: "casting_advice"`.
- Fact source IDs include the candidate or project field, for example `casting_advice:streamer-a:score`.
- Findings only cite existing facts.
- Caveats are reserved for unverified external factors such as platform traffic and schedule conflicts.
- Recommendations are proposals only and must require human approval.

## Security

- The route requires a Supabase client and `getAuthContext`.
- Streamer role receives `403`.
- Unauthenticated requests receive `401`.
- The route performs no database writes.
- Returned advice is derived only from caller-provided project and candidate snapshots.

## Testing

- Unit test the Agent against a high-fit candidate, a risky candidate, and numeric grounding.
- Route test MCN staff success, streamer denial, unauthenticated denial, and no database writes.
- Include this in `test:ai-system` through the existing `features/ai` and `app/api/ai` globs.

## Self Review

- The design reuses the existing matching engine instead of adding a second scoring path.
- It keeps AG-2 advice read-only and consistent with the AgentOutput guardrails.
- It leaves AI-3 learning and active automation out of scope.
