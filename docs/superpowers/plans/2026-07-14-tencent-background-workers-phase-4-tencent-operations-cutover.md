# Tencent Background Workers Phase 4 Operations And Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install, supervise, monitor, deploy, canary, and safely cut production background tasks over to Tencent systemd services with no GitHub runtime dependency.

**Architecture:** Keep the existing PM2-managed Web service. Install Worker daemons and calendar jobs as version-controlled systemd units, generate host-specific resource drop-ins, extend deployment with drain/restart/health checks, and remove GitHub schedules only after 24–48 hours of recorded server evidence.

**Tech Stack:** Ubuntu systemd, Bash, Node 20, pnpm 10.12.1, PM2, PostgreSQL/Supabase, Tencent Cloud logs/monitoring, Vitest static contracts.

---

## Dependency And Safety Boundary

Requires Phases 1–3 complete and merged into the deployment branch. Production commands in this plan run only on the Tencent server.

Never include real tokens in commits, command output, screenshots, crontab, or GitHub Secrets. Preserve the current Web process and internal runner routes until the final cutover gate passes.

Failure injection is staging-only unless the user explicitly authorizes a production exercise. The script must refuse to run without `ALLOW_WORKER_FAILURE_INJECTION=true`.

## File Map

- Create: `ops/systemd/jingying-worker-ocr.service.in` — OCR daemon unit template.
- Create: `ops/systemd/jingying-worker-recording-ai.service.in` — recording daemon unit template.
- Create: `ops/systemd/jingying-worker-settlement-simulation.service.in` — large-sample deterministic simulation daemon.
- Create: `ops/systemd/jingying-maintenance@.service.in` — scheduled local CLI unit template.
- Create: `ops/systemd/jingying-worker-watchdog.service.in` and `.timer` — health/outbox watchdog.
- Create: `ops/systemd/jingying-anomaly-scan.timer`, `jingying-recording-intelligence.timer`, `jingying-account-metrics.timer`, `jingying-account-idle.timer` — calendar schedules.
- Create: `ops/systemd/worker.env.example` — non-secret environment names and defaults.
- Create: `lib/ops/systemd-contract.test.ts` — unit safety and schedule contract.
- Create: `scripts/install-background-workers.sh` — render/install units and resource drop-ins.
- Create: `scripts/check-background-workers.sh` — machine-readable health gate.
- Create: `scripts/background-worker-canary.sh` — queue and service canary.
- Create: `features/async-tasks/canary.ts`, `.test.ts`, and `scripts/workers/canary.ts` — fresh typed canary enqueue and claim evidence.
- Create: `scripts/background-worker-failure-injection.sh` — guarded staging recovery exercise.
- Create: `lib/ops/background-worker-scripts-contract.test.ts` — shell safety/static contract.
- Modify: `scripts/deploy.sh` — drain, migrate/build, restart, and health-check Workers.
- Create: `docs/runbooks/tencent-background-workers.md` — install, operate, alert, canary, rollback.
- Modify: `.github/workflows/scheduled-runners.yml` — remove schedules only at final cutover; keep manual diagnostics.
- Modify: `.env.example` — Worker runtime and resource variables.

### Task 1: Define Safe systemd Units And Timers

**Files:**
- Create: `ops/systemd/jingying-worker-ocr.service.in`
- Create: `ops/systemd/jingying-worker-recording-ai.service.in`
- Create: `ops/systemd/jingying-worker-settlement-simulation.service.in`
- Create: `ops/systemd/jingying-maintenance@.service.in`
- Create: `ops/systemd/jingying-worker-watchdog.service.in`
- Create: `ops/systemd/jingying-worker-watchdog.timer`
- Create: `ops/systemd/jingying-anomaly-scan.timer`
- Create: `ops/systemd/jingying-recording-intelligence.timer`
- Create: `ops/systemd/jingying-account-metrics.timer`
- Create: `ops/systemd/jingying-account-idle.timer`
- Create: `ops/systemd/worker.env.example`
- Create: `lib/ops/systemd-contract.test.ts`

- [ ] **Step 1: Write the failing static unit contract**

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (name: string) =>
  readFileSync(join(process.cwd(), "ops/systemd", name), "utf8");

describe("Tencent background worker units", () => {
  it.each([
    "jingying-worker-ocr.service.in",
    "jingying-worker-recording-ai.service.in",
    "jingying-worker-settlement-simulation.service.in",
  ])("keeps %s supervised and non-root", (name) => {
    const unit = read(name);
    expect(unit).toContain("Restart=always");
    expect(unit).toContain("User=__APP_USER__");
    expect(unit).toContain("EnvironmentFile=-/etc/jingying-cabin/worker.env");
    expect(unit).toContain("KillSignal=SIGTERM");
    expect(unit).toContain("NoNewPrivileges=true");
  });

  it("uses persistent Asia/Shanghai timers with the approved stagger", () => {
    expect(read("jingying-recording-intelligence.timer")).toContain("OnCalendar=*-*-* 10:00:00 Asia/Shanghai");
    expect(read("jingying-account-metrics.timer")).toContain("OnCalendar=*-*-* 10:10:00 Asia/Shanghai");
    expect(read("jingying-account-idle.timer")).toContain("OnCalendar=*-*-* 10:20:00 Asia/Shanghai");
    for (const name of ["jingying-recording-intelligence.timer", "jingying-account-metrics.timer", "jingying-account-idle.timer"]) {
      expect(read(name)).toContain("Persistent=true");
    }
  });

  it("passes a deterministic slot and retries only reclaimable maintenance failures", () => {
    const unit = read("jingying-maintenance@.service.in");
    expect(unit).toContain("worker:maintenance -- %i --scheduled-for auto");
    expect(unit).toContain("Restart=on-failure");
    expect(unit).toContain("RestartPreventExitStatus=2");
  });
});
```

- [ ] **Step 2: Run and verify missing-file failures**

Run: `pnpm vitest run lib/ops/systemd-contract.test.ts`

Expected: FAIL.

- [ ] **Step 3: Create daemon units**

OCR unit body:

```ini
[Unit]
Description=Jingying OCR background worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=__APP_USER__
Group=__APP_GROUP__
WorkingDirectory=__APP_DIR__
EnvironmentFile=-/etc/jingying-cabin/worker.env
Environment=NODE_ENV=production
ExecStart=__PNPM_BIN__ worker:ocr
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=180
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadOnlyPaths=__APP_DIR__
ReadWritePaths=/tmp/jingying-cabin

[Install]
WantedBy=multi-user.target
```

The recording unit uses `ExecStart=__PNPM_BIN__ worker:recording-ai`, `Nice=10`, and the same stop/security behavior. The settlement simulation unit uses `ExecStart=__PNPM_BIN__ worker:settlement-simulation`, `Nice=12`, default concurrency 1, and the same stop/security behavior. Resource limits live in generated drop-ins rather than these versioned templates.

- [ ] **Step 4: Create maintenance and timer units**

`jingying-maintenance@.service.in` is `Type=oneshot` and runs:

```ini
ExecStart=__PNPM_BIN__ worker:maintenance -- %i --scheduled-for auto
Restart=on-failure
RestartSec=60
RestartPreventExitStatus=2
```

The unit contract verifies the exact `--scheduled-for auto` handoff, a bounded start limit, and retry behavior. A process crash therefore reopens the same deterministic schedule slot, reclaims only stale organization items, and does not wait until the next calendar occurrence.

Timer mappings:

- every 30 minutes: `jingying-maintenance@anomaly-scan.service`;
- daily 10:00 Asia/Shanghai: `recording-intelligence-learn`;
- daily 10:10: `account-metrics-sync`;
- daily 10:20: `account-idle-scan`;
- every minute: `jingying-worker-watchdog.service`.

Every timer sets `Persistent=true`, `AccuracySec=1min`, and `RandomizedDelaySec=20` except watchdog, whose randomized delay is 0.

- [ ] **Step 5: Run and commit unit definitions**

Run: `pnpm vitest run lib/ops/systemd-contract.test.ts`

Expected: PASS.

```bash
git add ops/systemd lib/ops/systemd-contract.test.ts
git commit -m "ops: define Tencent background worker units"
```

### Task 2: Install Units And Resource Drop-Ins

**Files:**
- Create: `scripts/install-background-workers.sh`
- Create: `lib/ops/background-worker-scripts-contract.test.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write the failing installer contract**

Require strict shell mode, absolute path validation, non-root application user, token rendering, permissions, resource drop-ins, `systemd-analyze verify`, and daemon reload. Also require that the script never prints environment-file contents.

```ts
expect(script).toContain("set -euo pipefail");
expect(script).toContain("systemd-analyze verify");
expect(script).toContain("chmod 600");
expect(script).toContain("systemctl daemon-reload");
expect(script).toContain("MemoryHigh=");
expect(script).toContain("MemoryMax=");
expect(script).toContain("CPUQuota=");
expect(script).toContain("SETTLEMENT_CPU_QUOTA");
expect(script).toContain("jingying-worker-settlement-simulation.service.d");
expect(script).not.toMatch(/cat .*worker\.env/);
```

- [ ] **Step 2: Run and verify red state**

Run: `pnpm vitest run lib/ops/background-worker-scripts-contract.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement the installer**

Inputs and defaults:

```bash
APP_DIR=${APP_DIR:-/var/www/jingying-cabin}
APP_USER=${APP_USER:-jingying}
APP_GROUP=${APP_GROUP:-jingying}
OCR_CPU_QUOTA=${OCR_CPU_QUOTA:-25%}
OCR_MEMORY_HIGH=${OCR_MEMORY_HIGH:-192M}
OCR_MEMORY_MAX=${OCR_MEMORY_MAX:-256M}
RECORDING_CPU_QUOTA=${RECORDING_CPU_QUOTA:-75%}
RECORDING_MEMORY_HIGH=${RECORDING_MEMORY_HIGH:-768M}
RECORDING_MEMORY_MAX=${RECORDING_MEMORY_MAX:-1024M}
SETTLEMENT_CPU_QUOTA=${SETTLEMENT_CPU_QUOTA:-50%}
SETTLEMENT_MEMORY_HIGH=${SETTLEMENT_MEMORY_HIGH:-384M}
SETTLEMENT_MEMORY_MAX=${SETTLEMENT_MEMORY_MAX:-512M}
MAINTENANCE_CPU_QUOTA=${MAINTENANCE_CPU_QUOTA:-25%}
MAINTENANCE_MEMORY_HIGH=${MAINTENANCE_MEMORY_HIGH:-256M}
MAINTENANCE_MEMORY_MAX=${MAINTENANCE_MEMORY_MAX:-256M}
WATCHDOG_CPU_QUOTA=${WATCHDOG_CPU_QUOTA:-10%}
WATCHDOG_MEMORY_MAX=${WATCHDOG_MEMORY_MAX:-128M}
```

The script must:

1. Resolve and verify `APP_DIR` before any write.
2. Require an existing non-root `APP_USER` and group.
3. Resolve `pnpm` to an absolute path.
4. Render `__APP_DIR__`, `__APP_USER__`, `__APP_GROUP__`, and `__PNPM_BIN__` into `/etc/systemd/system` using a temporary directory.
5. Fail if any `__[A-Z_]+__` token remains.
6. Create `/etc/jingying-cabin/worker.env` from the example only when absent, run `chmod 600`, and stop with instructions to fill secrets before enabling.
7. Write per-service resource drop-ins for OCR, recording AI, settlement simulation, maintenance, and watchdog; every long-running or timer-started process has an explicit CPU quota and memory ceiling.
8. Read host CPU and memory and refuse installation when the worst-case simultaneous background quotas, including settlement simulation and exactly one globally leased maintenance run, leave less than one CPU execution capacity or 40% memory for Web. Static tests vary host capacity, prove the settlement quota participates in both calculations, and verify the global maintenance lease contract that makes a single maintenance quota valid.
9. Run `systemd-analyze verify` on every rendered unit.
10. Atomically move verified units into place and run `systemctl daemon-reload`.
11. Enable timers, but enable/start daemonWorkers only when `ENABLE_WORKERS=true`.

Add `.env.example` variables:

```dotenv
ASYNC_WORKERS_ENABLED=false
OCR_WORKER_ENABLED=true
RECORDING_AI_WORKER_ENABLED=true
OCR_WORKER_CONCURRENCY=1
RECORDING_AI_WORKER_CONCURRENCY=1
SETTLEMENT_SIMULATION_WORKER_CONCURRENCY=1
SETTLEMENT_SIMULATION_WORKER_ENABLED=false
SETTLEMENT_SIMULATION_QUEUE_ENABLED=false
MAINTENANCE_WORKER_ENABLED=true
ASYNC_WORKER_IDLE_MS=1000
ASYNC_WORKER_LEASE_SECONDS=120
ASYNC_WORKER_HEARTBEAT_MS=30000
ASYNC_TASK_SSE_ENABLED=true
```

- [ ] **Step 4: Run shell syntax and static tests**

Run:

```bash
bash -n scripts/install-background-workers.sh
pnpm vitest run lib/ops/background-worker-scripts-contract.test.ts lib/ops/systemd-contract.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit installer**

```bash
git add scripts/install-background-workers.sh lib/ops/background-worker-scripts-contract.test.ts .env.example
git commit -m "ops: install background worker services safely"
```

### Task 3: Extend Deployment With Drain, Restart, And Health Gates

**Files:**
- Modify: `scripts/deploy.sh`
- Create: `scripts/check-background-workers.sh`
- Modify: `lib/ops/background-worker-scripts-contract.test.ts`
- Create: `lib/ops/deploy-failure-recovery.test.ts`

- [ ] **Step 1: Add failing deployment contract cases**

Require this order in `deploy.sh`:

1. detect installed Worker units;
2. send SIGTERM/drain before migration/build;
3. apply migrations and build;
4. restart Web;
5. restart enabled Workers;
6. run the health script;
7. return nonzero if enabled Worker health fails.

Add a temp-directory harness with fake `git`, `pnpm`, `docker`, `systemctl`, and `pm2` executables. Inject failures at dependency install, migration, build, Web restart, and Worker health. Every case must prove the prior commit/source and `.next` artifact are restored when needed, exactly the previously active Worker set is restarted, and the original nonzero exit code is preserved. A successful case must prove the recovery trap does not roll back.

Also require the health script to use `systemctl is-active`, query Worker heartbeats without printing secrets, and return JSON plus a meaningful exit code.

- [ ] **Step 2: Run and verify contract failure**

Run: `pnpm vitest run lib/ops/background-worker-scripts-contract.test.ts lib/ops/deploy-failure-recovery.test.ts`

Expected: FAIL on missing drain/health behavior.

- [ ] **Step 3: Implement graceful deployment**

Add:

```bash
WORKER_UNITS=(jingying-worker-ocr.service jingying-worker-recording-ai.service jingying-worker-settlement-simulation.service)
installed_worker_units=()
for unit in "${WORKER_UNITS[@]}"; do
  if systemctl list-unit-files "$unit" --no-legend 2>/dev/null | grep -q "$unit"; then
    installed_worker_units+=("$unit")
  fi
done
```

Before any repository change, record the current commit and exactly which installed Worker units are active. Preserve the current `.next` artifact in a verified sibling backup path. Install an `ERR INT TERM EXIT` recovery trap before stopping Workers. On failure, the trap restores the prior commit from the local Git object database, restores the prior dependency lock installation and `.next` artifact, restarts exactly the previously active Workers, and leaves the already-running old Web process untouched unless Web had been restarted. If Web was restarted before the failure, restart it again after restoring the old artifact. Additive database migrations remain applied and must stay backward-compatible.

Before migrations, stop installed active Workers with `systemctl stop`; their SIGTERM handler drains and systemd honors `TimeoutStopSec`. After Web restart, restart only units that were active before deployment. Run `scripts/check-background-workers.sh --require-enabled` after a 30-second startup window. Only after all health checks pass may the script disarm the trap and remove the verified backup artifact.

Do not alter or remove the current migration ledger behavior. Do not log `.env.production` or `/etc/jingying-cabin/worker.env`.

- [ ] **Step 4: Implement the health script**

The script returns JSON fields:

```json
{
  "ok": true,
  "services": {
    "ocr": "active",
    "recordingAi": "active",
    "settlementSimulation": "active"
  },
  "heartbeats": {
    "ocrAgeSeconds": 12,
    "recordingAiAgeSeconds": 18,
    "settlementSimulationAgeSeconds": 9
  }
}
```

The shell script gets heartbeat JSON from `pnpm worker:watchdog -- --health-json`; it does not parse environment files or run raw SQL itself. Exit 1 when a required service is inactive or its newest heartbeat is older than 60 seconds. Exit 2 for health-query/configuration failure so monitoring can distinguish unknown from unhealthy.

- [ ] **Step 5: Run and commit deployment changes**

Run:

```bash
bash -n scripts/deploy.sh
bash -n scripts/check-background-workers.sh
pnpm vitest run lib/ops/background-worker-scripts-contract.test.ts lib/ops/deploy-failure-recovery.test.ts
```

Expected: PASS.

```bash
git add scripts/deploy.sh scripts/check-background-workers.sh lib/ops/background-worker-scripts-contract.test.ts lib/ops/deploy-failure-recovery.test.ts
git commit -m "ops: deploy workers with health gates"
```

### Task 4: Add Canary And Guarded Failure Exercises

**Files:**
- Create: `scripts/background-worker-canary.sh`
- Create: `scripts/background-worker-failure-injection.sh`
- Create: `features/async-tasks/canary.ts`
- Create: `features/async-tasks/canary.test.ts`
- Create: `scripts/workers/canary.ts`
- Modify: `features/ai/ocr-jobs.ts`
- Modify: `features/ai/ocr-jobs.test.ts`
- Modify: `package.json`
- Modify: `lib/ops/background-worker-scripts-contract.test.ts`

- [ ] **Step 1: Write failing safety contracts**

Require the canary to be read-only except for a tagged test task in a configured canary organization. Require failure injection to stop before any process action unless all are true:

```bash
ALLOW_WORKER_FAILURE_INJECTION=true
ENVIRONMENT=staging
CANARY_ORGANIZATION_ID=<valid UUID supplied through environment>
```

The script must reject `ENVIRONMENT=production` unconditionally.

The TypeScript canary test requires a new random `canaryRunId` and idempotency key on every invocation, fixture ownership checks, and post-completion evidence that `attempt >= 1`, a real Worker ID claimed the task, and both running and terminal events belong to this run. Extend the typed OCR enqueue module with a canary-only path that is unreachable from public/user routes and requires `ALLOW_BACKGROUND_WORKER_CANARY=true` plus the dedicated organization/report IDs. Normal `createOcrJob` keeps stable live-report deduplication. The canary path uses `canary:ocr:<liveReportId>:<canaryRunId>`: the same run ID is idempotent, a new run ID creates a new task even for the fixed fixture report, and an unauthorized organization fails closed. Tests cover all four cases and prove no production caller can select canary mode.

- [ ] **Step 2: Run and verify red state**

Run: `pnpm vitest run lib/ops/background-worker-scripts-contract.test.ts features/async-tasks/canary.test.ts features/ai/ocr-jobs.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement the canary**

The canary performs:

1. Worker service and heartbeat check.
2. Invoke `pnpm worker:canary -- ocr` locally. Its TypeScript service validates the configured canary organization/fixture, calls the guarded typed canary enqueue path with a fresh random run identity, and records the run tag in allowed metadata.
3. Poll by task ID for up to 60 seconds.
4. Verify event order and exactly one terminal result.
5. Delete only an explicitly deletable tagged OCR fixture result and retain the event/audit record; never delete append-only settlement simulations.

6. Invoke the same typed canary CLI for a deterministic large-sample settlement simulation with no provider call and verify the persisted result returns to its source draft.
7. In an explicitly enabled concurrency subtest, enqueue more than each per-organization cap for one canary organization plus one task for a second organization, race at least two claimers, and prove valid leases never exceed OCR 3 / recording AI 1 / settlement simulation 1 while the second organization is served before the first organization's excess work.

Settlement canaries live in a dedicated canary project and are retained under the normal audit retention policy. Add `"worker:canary": "tsx scripts/workers/canary.ts"` to `package.json`. The local CLI requires `ALLOW_BACKGROUND_WORKER_CANARY=true`, validates every fixture against `CANARY_ORGANIZATION_ID`, and accesses the service role only inside the Tencent host process. It prints IDs and durations, never signed URLs or tokens. Provider-backed recording canaries use a short fixed fixture and require an explicit cost opt-in; the default daily canary does not spend ASR/LLM quota.

- [ ] **Step 4: Implement staging failure injection**

The exercise:

1. enqueue a canary job;
2. wait until `running`;
3. `systemctl kill --kill-who=main -s SIGKILL` only the selected staging Worker;
4. verify offline detection within 60 seconds;
5. start the Worker;
6. verify lease recovery and one terminal result within 180 seconds.
7. start a maintenance canary with two organization items, kill it after the first item succeeds, wait for lease expiry, restart the same schedule slot, and verify the completed item is not rerun while the remaining item finishes.

Do not use broad process-name kills.

- [ ] **Step 5: Run syntax/static tests and commit**

```bash
bash -n scripts/background-worker-canary.sh
bash -n scripts/background-worker-failure-injection.sh
pnpm vitest run lib/ops/background-worker-scripts-contract.test.ts
pnpm vitest run features/async-tasks/canary.test.ts features/ai/ocr-jobs.test.ts
git add scripts/background-worker-canary.sh scripts/background-worker-failure-injection.sh features/async-tasks/canary.ts features/async-tasks/canary.test.ts features/ai/ocr-jobs.ts features/ai/ocr-jobs.test.ts scripts/workers/canary.ts lib/ops/background-worker-scripts-contract.test.ts package.json
git commit -m "ops: add background worker canary exercises"
```

### Task 5: Write The Tencent Operations Runbook

**Files:**
- Create: `docs/runbooks/tencent-background-workers.md`

- [ ] **Step 1: Write the runbook with exact commands**

It must include:

- prerequisites and capacity rule: reserve one CPU execution capacity and 40% memory for Web;
- install command and environment-file permissions;
- `systemctl enable/start/status` commands;
- `journalctl` commands per unit;
- health and canary commands;
- queue pause/resume and concurrency changes;
- global/per-workload enable flag changes, including the required targeted `systemctl restart` because runtime configuration is loaded once at process start;
- Tencent Cloud log/monitor alert thresholds from the design;
- deployment sequence;
- PostgreSQL full-database backup scope explicitly covering `background_jobs`, `recording_ai_analyses`, `settlement_formula_simulations`, `async_task_events`, `async_task_notification_dispatches`, `async_task_queue_controls`, `worker_instances`, both scheduled-run tables, `maintenance_execution_leases`, and `provider_circuit_breakers`;
- restore procedure that preserves task IDs, idempotency keys, attempts, leases, and event ordering;
- a quarterly restore drill into an isolated database followed by read-only queue consistency checks;
- 24–48 hour cutover observation checklist;
- rollback commands in fail-safe order: close/restart/verify the Web enqueue gate, drain or retain queued simulations, close/restart/verify Worker claim gates, then stop units;
- how to add a second Tencent Worker host without changing the Web app;
- explicit statement that GitHub outage does not stop deployed runtime tasks.

Use commands like:

```bash
cd /var/www/jingying-cabin
sudo APP_DIR=/var/www/jingying-cabin APP_USER=jingying APP_GROUP=jingying ENABLE_WORKERS=false bash scripts/install-background-workers.sh
sudoedit /etc/jingying-cabin/worker.env
sudo systemctl enable --now jingying-worker-ocr.service jingying-worker-recording-ai.service jingying-worker-settlement-simulation.service
sudo systemctl enable --now jingying-worker-watchdog.timer jingying-anomaly-scan.timer jingying-recording-intelligence.timer jingying-account-metrics.timer jingying-account-idle.timer
bash scripts/check-background-workers.sh --require-enabled
```

The backup section must use the deployment's existing PostgreSQL backup mechanism and name the required tables explicitly. It must not suggest table-only restore into a live database. Restore into an isolated database first, validate foreign keys and idempotency uniqueness, then follow the documented full-database disaster-recovery decision. Queue rows are durable business state, not disposable cache.

- [ ] **Step 2: Self-check the runbook**

Search for real-looking tokens, unbounded deletes, recursive filesystem operations, `curl` to public production runner endpoints, and commands that print environment files. Remove any occurrence.

- [ ] **Step 3: Commit the runbook**

```bash
git add docs/runbooks/tencent-background-workers.md
git commit -m "docs: add Tencent worker operations runbook"
```

### Task 6: Execute Production Canary And Record The Cutover Gate

**Files:** no repository change until evidence is collected. Do not store secrets or full logs in Git.

- [ ] **Step 1: Deploy with Workers disabled**

On Tencent:

```bash
cd /var/www/jingying-cabin
BRANCH=codex/full-project-ui bash scripts/deploy.sh
sudo ENABLE_WORKERS=false APP_DIR=/var/www/jingying-cabin APP_USER=jingying APP_GROUP=jingying bash scripts/install-background-workers.sh
sudo systemctl daemon-reload
```

Expected: migration/build/Web restart succeed; Worker units are installed but not active.

- [ ] **Step 2: Enable OCR canary at concurrency 1**

Set `ASYNC_WORKERS_ENABLED=true`, `OCR_WORKER_CONCURRENCY=1`, `RECORDING_AI_WORKER_CONCURRENCY=1`, `SETTLEMENT_SIMULATION_WORKER_CONCURRENCY=1`, and `SETTLEMENT_SIMULATION_WORKER_ENABLED=false` in root-only `/etc/jingying-cabin/worker.env`. Keep Web's separate `.env.production` value `SETTLEMENT_SIMULATION_QUEUE_ENABLED=false`, then:

```bash
sudo systemctl enable --now jingying-worker-ocr.service
bash scripts/check-background-workers.sh --require-enabled
```

Expected: OCR service active, heartbeat younger than 60 seconds, canary succeeds.

- [ ] **Step 3: Enable recording, settlement simulation, and timers**

```bash
sudo systemctl enable --now jingying-worker-recording-ai.service
sudo systemctl enable --now jingying-worker-settlement-simulation.service
sudo systemctl enable --now jingying-worker-watchdog.timer jingying-anomaly-scan.timer jingying-recording-intelligence.timer jingying-account-metrics.timer jingying-account-idle.timer
bash scripts/check-background-workers.sh --require-enabled
systemctl list-timers 'jingying-*'
```

Expected: all three daemons are active and all timers list their next run. Set `SETTLEMENT_SIMULATION_WORKER_ENABLED=true` in `worker.env` and restart `jingying-worker-settlement-simulation.service`; run a guarded direct queue canary and require a fresh real claim/terminal event. Only after that passes, set `SETTLEMENT_SIMULATION_QUEUE_ENABLED=true` in Web's `.env.production`, restart PM2 with `--update-env`, submit through the user route, and confirm it returns a durable task that completes into the same rule workspace. If either restart or canary fails, keep the Web queue flag false.

After 24 hours of healthy independent Worker execution, set `OCR_INLINE_KICK_LIMIT=0` and `RECORDING_AI_INLINE_KICK_LIMIT=0`, restart Web, and rerun the canary. Do not disable inline kicks before this observation gate.

- [ ] **Step 4: Observe 24–48 hours**

The gate passes only when:

- no Worker heartbeat gap exceeds60 seconds except a documented restart;
- OCR oldest queued stays below1 minute under normal capacity;
- recording oldest queued stays below10 minutes under normal capacity;
- final failure rate stays below 20% in every 10-minute window;
- no duplicate terminal result or duplicate notification is observed;
- Web latency and memory remain within the existing production baseline;
- every scheduled job has one `scheduled_job_runs` row per schedule identity;
- a restart exercise proves queue recovery.

Record timestamps, task IDs, aggregate counts, and commit version in the deployment ticket or private operations record, not in a public repository.

### Task 7: Remove GitHub Production Schedules After The Gate Passes

**Files:**
- Modify: `.github/workflows/scheduled-runners.yml`
- Modify: `docs/runbooks/tencent-background-workers.md`

- [ ] **Step 1: Verify the gate evidence exists**

Do not edit the workflow if Task6 evidence is incomplete. This is a hard stop, not an optional review.

- [ ] **Step 2: Write the failing workflow contract**

Add to `lib/ops/systemd-contract.test.ts`:

```ts
const workflow = readFileSync(join(process.cwd(), ".github/workflows/scheduled-runners.yml"), "utf8");
expect(workflow).not.toMatch(/^\s*schedule:/m);
expect(workflow).toContain("workflow_dispatch:");
expect(workflow).toContain("Manual Runner Diagnostics");
```

- [ ] **Step 3: Convert the workflow to manual diagnostics**

Rename it to `Manual Runner Diagnostics`, remove the `schedule` event, and keep `workflow_dispatch` inputs for selecting one diagnostic job. Remove schedule-expression conditions. Add a top comment that production scheduling is owned by Tencent systemd and link the runbook.

Do not delete internal runner routes in this phase; they remain an authenticated rollback tool.

- [ ] **Step 4: Run and commit cutover**

Run:

```bash
pnpm vitest run lib/ops/systemd-contract.test.ts
git diff --check
```

Expected: PASS and no `schedule:` trigger remains.

```bash
git add .github/workflows/scheduled-runners.yml docs/runbooks/tencent-background-workers.md lib/ops/systemd-contract.test.ts
git commit -m "ci: move production scheduling to Tencent"
```

### Task 8: Final Verification And Rollback Drill

**Files:** no new files unless a verification defect requires a scoped fix.

- [ ] **Step 1: Run the complete repository verification**

```bash
pnpm test:async-tasks
pnpm test:ai-system
pnpm test:api-contracts
pnpm test:ui-smoke
pnpm type-check
pnpm lint
pnpm build
pnpm vitest run lib/ops
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 2: Run Tencent health and canary checks**

```bash
bash scripts/check-background-workers.sh --require-enabled
bash scripts/background-worker-canary.sh
sudo systemctl --failed --no-legend
```

Expected: health and canary exit 0; no Jingying unit is failed.

- [ ] **Step 3: Drill rollback without losing queued data**

On staging or in an approved production window:

```bash
sudoedit /var/www/jingying-cabin/.env.production
cd /var/www/jingying-cabin
pm2 restart jingying-cabin --update-env
sudoedit /etc/jingying-cabin/worker.env
sudo systemctl stop jingying-worker-ocr.service jingying-worker-recording-ai.service jingying-worker-settlement-simulation.service
sudo systemctl disable --now jingying-worker-watchdog.timer jingying-anomaly-scan.timer jingying-recording-intelligence.timer jingying-account-metrics.timer jingying-account-idle.timer
```

Rollback order is mandatory:

1. Set Web's `.env.production` `SETTLEMENT_SIMULATION_QUEUE_ENABLED=false`, restore OCR/recording inline runner flags, and restart PM2 with `--update-env`.
2. Submit a guarded route canary and prove it creates no new settlement background job; record the queue count before/after.
3. Keep the settlement Worker enabled until already queued frozen simulations reach terminal state, or explicitly accept that they remain durably queued for later re-enable.
4. Set `/etc/jingying-cabin/worker.env` `ASYNC_WORKERS_ENABLED=false`, restart the daemon units once to prove their claim counters stay unchanged, then stop/disable them and the timers.
5. Confirm all intentionally remaining queued rows stay in PostgreSQL. Restore the local authenticated runner fallback or re-enable Workers, then confirm the same task IDs complete.

The rollback drill records this order and fails if any task is enqueued after the Web gate closes or any Worker claims after the global gate closes. There is no unsafe synchronous takeover of an already frozen task. Do not clear or rewrite queue tables.

- [ ] **Step 4: Commit only scoped fixes**

```bash
git commit -m "fix: close Tencent worker cutover gaps"
```

## Phase 4 Exit Gate

- Tencent systemd owns all continuous and calendar production jobs.
- Web remains PM2-managed and healthy during Worker load.
- Resource drop-ins reserve Web capacity and stop new background claims under pressure.
- Canary, restart recovery, timer idempotency, alerts, and rollback have real server evidence.
- GitHub workflow has no schedule trigger and is manual diagnostics only.
- GitHub Actions and self-hosted runners can remain fully offline without affecting production task execution.
