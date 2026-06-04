# AG2 Script Optimization Agent Design

## Goal

Add the first script optimization Agent behind `/api/ai/scripts`, producing a grounded script version draft for MCN staff review without publishing or mutating live tasks.

## Scope

This PR covers:

- A deterministic `runScriptOptimizationAgent`.
- A `POST /api/ai/scripts` route.
- Draft insertion into `ai_script_versions`.
- A returned `AgentOutput` with sourced facts and human-approved recommendations.

Out of scope:

- No automatic publishing.
- No live task mutation.
- No settlement mutation.
- No streamer-facing script version reads.
- No LLM prompt orchestration beyond the deterministic contract wrapper.

## Architecture

`features/ai/script-optimization-agent.ts` owns the draft generation logic.

Input:

- `scriptKey`
- `version`
- `currentScript`
- `diagnosisType`
- `feedback`
- `replayNotes`
- `streamerId`
- `projectId`

Output:

- `scriptVersionDraft`
- `agentOutput`
- `validation`

`app/api/ai/scripts/route.ts` handles auth, rejects non-MCN staff, calls the agent, inserts an `ai_script_versions` row with `status: "draft"`, and returns the draft plus validation. The route does not publish or apply the draft.

## Data Contract

`scriptVersionDraft` shape:

```typescript
type ScriptVersionDraft = {
  scriptKey: string;
  version: number;
  status: "draft";
  content: string;
  streamerId?: string;
  projectId?: string;
};
```

Fact source identifiers use:

```text
script_optimization:<scriptKey>:<field>
```

The source tool is:

```text
script_optimization
```

## Security

Only MCN staff can call this route because `ai_script_versions` is staff-only by RLS.

The route writes only:

- draft script content
- sourced facts
- actor id
- optional streamer/project ids

It does not write published status, task fields, settlement fields, or auto-review fields.

## Testing

Unit tests:

- draft version has `status: "draft"`
- findings and recommendations contain no numeric claims
- facts contain all numeric claims with `sourceTool/sourceId`
- recommendations require human approval

Route tests:

- MCN staff can create a draft row
- streamers receive 403
- unauthenticated users receive 401
- inserted row has draft status and does not publish

Regression:

- `pnpm test:ai-system`
- `pnpm test:p4-flywheel`
- `pnpm test:golden`
- `pnpm lint`
- `pnpm type-check`
- `pnpm test`
- `pnpm build`

## Self-Review

- Scope is focused on script draft creation only.
- No business action executes automatically.
- Numeric grounding and human approval are explicit.
- Route auth follows the current RLS boundary.
