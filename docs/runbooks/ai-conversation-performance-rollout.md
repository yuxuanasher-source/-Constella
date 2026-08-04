# AI Conversation Performance Rollout

This runbook covers the durability, recall, and browser recovery changes for
Xingyao AI conversations. It deliberately separates executable local contract
evidence from production observation.

`CONTRACT_ONLY_NOT_PRODUCTION_CANARY`

## Evidence Boundary

Run the local contract gate from the Product release source:

```powershell
$env:HERMES_RESILIENCE_DB_CONTAINER = "supabase_db_jingying-cabin"
$env:HERMES_RESILIENCE_SUPABASE_PROJECT = "jingying-cabin"
$env:XINGYAO_HERMES_GATEWAY_WORKTREE = "C:\path\to\xingyao-hermes-agent"
pnpm test:ai-resilience
```

The database container must be disposable or a local development container.
The runner rejects other container-name shapes, remote application URLs, and
Docker endpoints other than local `unix://` or `npipe://` transports. Before
running database tests, it also requires both `com.supabase.cli.project` and
`com.docker.compose.project` container labels to match the explicit local
Supabase project. It does not create production records or print credentials.

The gate executes these real suites:

| Gate                            | Evidence produced                                                                                                                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `postgres_recovery_and_memory`  | Applies the additive memory and recovery migrations inside real local PostgreSQL transactions; checks identity isolation, bounded payloads, monotonic cursors, concurrency, and rollback. |
| `product_turn_recovery`         | Executes the Product executor, stream adapter, status, clarify, and cancel modules, including submit-once and restart-recovery contracts.                                                 |
| `browser_reattach_and_batching` | Executes the real dashboard component and stream buffer for route switching, remount, two network failures, cursor replay, and render batching.                                           |
| `gateway_session_lifecycle`     | When a Gateway worktree is supplied, executes its real pytest lifecycle, transport, protocol, cache, and server suites.                                                                   |

This gate does **not** prove PM2/systemd restart recovery, Nginx behavior,
production network impairment, production latency, or a completed canary
window. Those require operator evidence from the immutable release host.

## Actual Controls

No per-phase runtime flags exist. Do not claim that session reuse, structured
memory, recovery snapshots, or browser batching can be independently disabled.
The supported traffic rollback is the existing runtime selector:

```sh
XINGYAO_HERMES_GATEWAY_ENABLED=false
XINGYAO_HERMES_GATEWAY_ALLOWLIST=
XINGYAO_HERMES_LEGACY_RUNTIME_ENABLED=true
```

Code rollback uses the last reviewed immutable Product release. Database
migrations are additive; rollback does not delete conversations, messages,
turns, summaries, recovery events, or stage telemetry.

## Release Order

1. Record the exact Product and Gateway commits, tree hashes, test-output
   hashes, migration checksums, Product artifact SHA-256, and rollback artifact
   SHA-256. Both source trees must be clean.
2. Release Gateway first and keep Product Gateway routing disabled.
3. Back up PostgreSQL, then apply additive migrations through the reviewed
   deployment controls.
4. Release Product from the exact reviewed artifact with
   `XINGYAO_HERMES_GATEWAY_ENABLED=false` and an empty allowlist.
5. Verify PM2 persistence, systemd enablement, Product health, Legacy health,
   Gateway health, runtime commit, and release-manifest identity.
6. Enable one explicit `<organization-uuid>/<user-uuid>` pair for 24 hours.
   Never use an organization wildcard for the first canary.
7. Consider a larger enumerated allowlist only after at least 100 Fast turns
   and every measurable gate below passes for the complete observation window.
8. Treat 5%, 25%, and 100% as operator-selected cohorts of explicit actor
   pairs. The current runtime selector does not calculate percentage rollout.

## Database Evidence

The following query reports sample counts separately from percentiles so a
missing first delta cannot silently shrink the denominator:

```sql
with observed as (
  select
    status,
    outcome,
    accepted_at,
    first_delta_at,
    terminal_at,
    persisted_at,
    session_action,
    recovery_event_sequence,
    recovery_terminal_event,
    lease_expires_at,
    error_code
  from public.ai_chat_turns
  where mode = 'fast'
    and accepted_at >= now() - interval '24 hours'
)
select
  count(*) as accepted_samples,
  count(*) filter (
    where status = 'completed' and outcome = 'complete'
  ) as successful_samples,
  round(
    count(*) filter (
      where status = 'completed' and outcome = 'complete'
    )::numeric /
    nullif(count(*), 0),
    4
  ) as success_rate,
  count(*) filter (where first_delta_at is not null) as first_delta_samples,
  percentile_disc(0.95) within group (
    order by extract(epoch from (first_delta_at - accepted_at)) * 1000
  ) filter (where first_delta_at is not null) as first_delta_p95_ms,
  count(*) filter (where terminal_at is not null) as terminal_samples,
  percentile_disc(0.95) within group (
    order by extract(epoch from (terminal_at - accepted_at)) * 1000
  ) filter (where terminal_at is not null) as total_p95_ms,
  count(*) filter (where session_action = 'resumed') as resumed_sessions,
  count(*) filter (where session_action = 'rebuilt') as rebuilt_sessions,
  count(*) filter (
    where terminal_at is not null and persisted_at is null
  ) as terminal_without_persisted_stage,
  count(*) filter (
    where recovery_event_sequence > 0
  ) as turns_with_recovery_events,
  count(*) filter (
    where recovery_terminal_event is not null
  ) as turns_with_terminal_snapshot
from observed;
```

Check active-turn leaks independent of the 24-hour SLO window. This prevents an
older stuck turn from disappearing from the release gate:

```sql
select count(*) as expired_active_turns
from public.ai_chat_turns
where status in ('accepted', 'grounding', 'generating', 'validating')
  and lease_expires_at < now();
```

Inspect stable error codes without response content:

```sql
select error_code, count(*)
from public.ai_chat_turns
where accepted_at >= now() - interval '24 hours'
  and error_code is not null
group by error_code
order by count(*) desc, error_code;
```

## Expansion Gates

The measurable database gates are:

- at least 100 accepted Fast turns;
- successful complete outcomes divided by accepted Fast turns is at least
  0.99;
- first-delta samples equal accepted samples and first-delta P95 is at most
  8,000 ms;
- terminal samples equal accepted samples and total P95 is at most 30,000 ms;
- `terminal_without_persisted_stage = 0`;
- `expired_active_turns = 0`;
- tenant and capability security suites pass with zero escapes.

Three planned gates are not currently computable from persisted Product data:
duplicate submit count is not yet persisted, recovery endpoint P95 is not yet
persisted, and production tenant/capability violation count is not yet
persisted. Do not widen beyond the one-user canary until those values are
captured by production observability or an additive telemetry change. The
local submit-once, browser recovery, and tenant/capability security suites are
regression evidence, not production counts.

## Rollback

Rollback on any tenant mismatch, secret exposure, duplicate tool/prompt
execution, terminal persistence failure, active-turn leak, or sustained SLO
breach. First remove Gateway traffic, then decide whether code rollback is
required:

```sh
sudoedit /etc/jingying-cabin/production.env
# Set:
# XINGYAO_HERMES_GATEWAY_ENABLED=false
# XINGYAO_HERMES_GATEWAY_ALLOWLIST=

set -a
source /etc/jingying-cabin/production.env
set +a
timeout --signal=TERM --kill-after=5s 30s pm2 restart jingying-cabin --update-env
timeout --signal=TERM --kill-after=5s 30s pm2 save
curl -fsS http://127.0.0.1:3000/api/health
```

Verify health reports `legacy_ready`. If Product code must also be rolled back,
use the reviewed immutable rollback package described in
`docs/runbooks/xingyao-hermes-gateway.md`. Preserve all database state and
release evidence for diagnosis.
