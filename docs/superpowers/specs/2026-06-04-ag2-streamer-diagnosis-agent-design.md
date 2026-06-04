# AG2 Streamer Diagnosis Agent Design

## Goal

Upgrade the existing streamer diagnosis AI path from a deterministic tool response into the shared `AgentOutput` contract, without changing settlement, task, or war-room rule behavior.

## Scope

This AG-2 slice only covers the streamer card-point diagnosis path:

- Reuse the existing `streamer_diagnosis` read-only AI tool.
- Keep `/api/ai/diagnosis` backward compatible by still returning the existing `result`.
- Add `agentOutput` and `validation` to `/api/ai/diagnosis`.
- Keep all numbers in `facts[]` with `sourceTool/sourceId`.
- Keep `findings[]`, `caveats[]`, and `recommendations[]` free of numeric claims.
- Keep recommendations as proposals that require human approval.

Out of scope:

- No `/api/ai/scripts` endpoint in this PR.
- No automatic script mutation.
- No task, settlement, auto-review, or streamer allocation writes.
- No LLM prompt orchestration beyond the existing deterministic tool and contract wrapper.

## Architecture

`runStreamerDiagnosisAgent` will live in `features/ai/streamer-diagnosis-agent.ts`.

The agent receives:

- `client`: the same audit/ledger-capable client used by `runAiToolQuery`
- `actor`: the authenticated actor
- `input`: the diagnosis payload from `/api/ai/diagnosis`

Flow:

1. Call `runAiToolQuery` with `toolName: "streamer_diagnosis"`.
2. Use the tool result `invocationId` as the evidence source root.
3. Build `facts[]` from streamer-safe tool output and visible input only.
4. Build findings from the diagnosis type and evidence level.
5. Add caveats for unverified platform traffic and missing historical baseline.
6. Add recommendations for script rhythm review, replay review, or evidence review.
7. Validate with `validateAgentOutput`.
8. Return `{ result, agentOutput, validation }`.

## Data Contract

Fact source identifiers use the format:

```text
<toolInvocationId>:<fieldPath>
```

Examples:

- `invocation-id:report.totalViews`
- `invocation-id:report.settlementDuration`
- `invocation-id:output.diagnosisType`

The source tool is always:

```text
streamer_diagnosis
```

## Security

The agent must never include MCN-only economics in `agentOutput`.

Forbidden fields include:

- `receivableCents`
- `grossMarginCents`
- `supplierCostCents`
- `costCents`
- `vendorPriceCents`
- `vendorReceivableCents`
- `internalRiskNotes`
- `marginRateBps`

The existing `streamer_diagnosis` tool already strips these fields for streamer actors. The agent also avoids reading those fields when building facts.

## API Shape

`POST /api/ai/diagnosis` response becomes:

```json
{
  "result": {
    "toolName": "streamer_diagnosis",
    "invocationId": "uuid",
    "mode": "deterministic",
    "answer": "...",
    "output": {}
  },
  "agentOutput": {
    "facts": [],
    "findings": [],
    "caveats": [],
    "recommendations": []
  },
  "validation": {
    "valid": true,
    "errors": []
  }
}
```

Existing consumers that read `result` continue to work.

## Testing

Unit tests cover:

- traffic-drop diagnosis emits sourced facts and numeric-free findings
- content-rhythm diagnosis emits sourced facts and numeric-free recommendations
- sensitive economics do not appear in `agentOutput`
- validation rejects any accidental ungrounded numeric text

Route tests cover:

- authenticated streamer gets old `result` plus new `agentOutput`
- unauthenticated request returns 401
- sensitive fields remain absent from response body

Regression:

- `pnpm test:ai-system`
- `pnpm test:p4-flywheel`
- `pnpm test:golden`
- `pnpm lint`
- `pnpm type-check`
- `pnpm test`
- `pnpm build`

## Self-Review

- No placeholders remain.
- Scope is narrow and excludes script generation.
- The API is backward compatible.
- Numeric grounding and sensitive-field boundaries are explicit.
