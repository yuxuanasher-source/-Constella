# Streamer Default Settlement Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add streamer-level default CPT, CPS, and base-salary settlement rules, freeze those rules when a streamer joins a project, and carry the frozen values into settlement previews and batches.

**Architecture:** Extend the existing `streamers` default settlement fields with CPS basis points, extend `project_streamers` snapshots with the same CPS basis points, and keep settlement batches reading frozen project-streamer rules. CPS remains manual/import-backed in this iteration because there is no trusted sales amount source yet.

**Tech Stack:** Next.js App Router route handlers, Supabase/Postgres migrations and RLS, TypeScript service/repository layers, Vitest, Testing Library React, existing reference UI.

---

## File Structure

- Modify: `supabase/migrations/20260607150000_streamer_default_settlement_rules.sql`
  - Adds `default_cps_rate_bps` and `cps_rate_bps` with range constraints.
- Modify: `lib/db/schema-contract.test.ts`
  - Pins the new schema fields and constraints.
- Modify: `features/streamers/streamer-service.ts`
  - Adds settlement default input validation, update service, high-risk permission and audit rules.
- Modify: `features/streamers/streamer-service.test.ts`
  - Covers creation, validation, update permissions, reason requirement, and audit fields.
- Modify: `features/streamers/streamer-repository.ts`
  - Persists settlement default fields and updates them.
- Modify: `features/streamers/streamer-queries.ts`
  - Selects settlement price fields in list/profile queries.
- Modify: `features/streamers/streamer-ui-dto.ts`
  - Returns safe settlement labels and structured fields for ops and streamer profile UI.
- Modify: `features/streamers/streamer-ui-dto.test.ts`
  - Covers `CPT`, `CPS`, `base_salary`, and `base_salary_cpt` labels without sensitive data.
- Modify: `app/api/streamers/route.ts`
  - Parses settlement price fields on create.
- Modify: `app/api/streamers/streamers-route.test.ts`
  - Covers create payload parsing and invalid numeric input.
- Create: `app/api/streamers/[streamerId]/settlement-rule/route.ts`
  - Adds high-risk update route.
- Modify: `app/api/streamers/streamers-route.test.ts`
  - Also imports and tests the new route.
- Modify: `features/applications/application-service.ts`
  - Resolves and freezes streamer default settlement rules during final join.
- Modify: `features/applications/application-repository.ts`
  - Reads streamer default settlement fields and writes `cps_rate_bps` into `project_streamers`.
- Modify: `features/applications/application-service.test.ts`
  - Covers streamer-default snapshot and project-default fallback.
- Modify: `features/settlements/settlement-engine.ts`
  - Adds CPS basis points to `SettlementRule` and exports `calculateCpsManualAmount`.
- Modify: `features/settlements/settlement-engine.test.ts`
  - Covers CPS helper and confirms CPS still does not auto-compute from live reports.
- Modify: `features/settlements/settlement-service.ts`
  - Accepts optional `salesAmount` for CPS manual rows and calculates manual amount from frozen rate when needed.
- Modify: `features/settlements/settlement-repository.ts`
  - Reads/writes `cps_rate_bps` in settlement rules.
- Modify: `features/settlements/settlement-queries.ts`
  - Shows frozen CPS rate in pool preview details.
- Modify: `app/api/settlement-batches/[batchId]/manual-items/route.ts`
  - Parses optional `salesAmount` for CPS imports.
- Modify: `features/settlements/settlement-service.test.ts`
  - Covers CPS import snapshots and base salary still applying once.
- Modify: `features/regression/settlement-golden-path.ts`
  - Adds frozen streamer default rule fields to the in-memory repository.
- Modify: `features/regression/settlement-golden-path.test.ts`
  - Covers default CPT frozen at join and safe bill continuity.
- Modify: `components/reference-ui/ops-reference.jsx`
  - Adds resource-pool settlement inputs, labels, detail panel fields, and CPS import fields.
- Modify: `components/reference-ui/ops-reference.test.jsx`
  - Covers UI payloads and compact rule display.
- Modify: `components/reference-ui/streamer-desktop-reference.jsx`
  - Displays CPS share in the safe streamer profile settlement card.
- Modify: `components/reference-ui/streamer-desktop-reference.test.jsx`
  - Covers safe CPS display.

---

### Task 1: Schema Contract and Migration

**Files:**

- Create: `supabase/migrations/20260607150000_streamer_default_settlement_rules.sql`
- Modify: `lib/db/schema-contract.test.ts`

- [ ] **Step 1: Write failing schema contract test**

Add this test to `lib/db/schema-contract.test.ts` inside `describe("P0 database contract", ...)`:

```ts
it("declares streamer default settlement cps snapshot fields", () => {
  expect(allMigrations).toContain(
    "default_cps_rate_bps integer not null default 0",
  );
  expect(allMigrations).toContain("streamers_default_cps_rate_bps_range");
  expect(allMigrations).toContain("cps_rate_bps integer not null default 0");
  expect(allMigrations).toContain("project_streamers_cps_rate_bps_range");
  expect(allMigrations).toContain(
    "default_cps_rate_bps >= 0 and default_cps_rate_bps <= 10000",
  );
  expect(allMigrations).toContain(
    "cps_rate_bps >= 0 and cps_rate_bps <= 10000",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm test lib/db/schema-contract.test.ts
```

Expected: FAIL because the new CPS fields and constraints are not present.

- [ ] **Step 3: Add migration**

Create `supabase/migrations/20260607150000_streamer_default_settlement_rules.sql`:

```sql
alter table public.streamers
  add column if not exists default_cps_rate_bps integer not null default 0;

alter table public.streamers
  drop constraint if exists streamers_default_cps_rate_bps_range,
  add constraint streamers_default_cps_rate_bps_range
    check (default_cps_rate_bps >= 0 and default_cps_rate_bps <= 10000);

alter table public.project_streamers
  add column if not exists cps_rate_bps integer not null default 0;

alter table public.project_streamers
  drop constraint if exists project_streamers_cps_rate_bps_range,
  add constraint project_streamers_cps_rate_bps_range
    check (cps_rate_bps >= 0 and cps_rate_bps <= 10000);
```

- [ ] **Step 4: Run schema contract test**

Run:

```bash
pnpm test lib/db/schema-contract.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/db/schema-contract.test.ts supabase/migrations/20260607150000_streamer_default_settlement_rules.sql
git commit -m "feat: add streamer settlement cps schema"
```

---

### Task 2: Streamer Service Settlement Defaults

**Files:**

- Modify: `features/streamers/streamer-service.test.ts`
- Modify: `features/streamers/streamer-service.ts`

- [ ] **Step 1: Write failing creation and validation tests**

In `features/streamers/streamer-service.test.ts`, add `updateStreamerSettlementRule` to the import:

```ts
import {
  assertStreamerCanBeInvited,
  createStreamerProfile,
  updateStreamerRisk,
  updateStreamerSettlementRule,
} from "./streamer-service";
```

Add tests:

```ts
it("creates streamer profiles with default settlement pricing", async () => {
  const repo = {
    createProfile: vi.fn().mockResolvedValue({
      id: "S-price",
      displayName: "Price Streamer",
      userId: null,
      riskLevel: "low",
      cooperationStatus: "not_started",
    }),
    getById: vi.fn(),
    updateRisk: vi.fn(),
    updateSettlementRule: vi.fn(),
  };
  const audit = vi.fn().mockResolvedValue(undefined);

  await createStreamerProfile({
    repo,
    audit,
    actor,
    input: {
      displayName: " Price Streamer ",
      defaultSettlementMethod: "base_salary_cpt",
      defaultHourlyRate: 80,
      defaultBaseSalary: 6000,
      defaultCpsRateBps: 1500,
    },
  });

  expect(repo.createProfile).toHaveBeenCalledWith(
    expect.objectContaining({
      displayName: "Price Streamer",
      defaultSettlementMethod: "base_salary_cpt",
      defaultHourlyRate: 80,
      defaultBaseSalary: 6000,
      defaultCpsRateBps: 1500,
    }),
  );
  expect(audit).toHaveBeenCalledWith(
    expect.objectContaining({
      changedFields: expect.arrayContaining([
        "default_settlement_method",
        "default_price",
        "default_base_salary",
        "default_cps_rate_bps",
      ]),
    }),
  );
});

it("rejects invalid streamer default settlement numbers", async () => {
  const repo = {
    createProfile: vi.fn(),
    getById: vi.fn(),
    updateRisk: vi.fn(),
    updateSettlementRule: vi.fn(),
  };
  const audit = vi.fn();

  await expect(
    createStreamerProfile({
      repo,
      audit,
      actor,
      input: { displayName: "Bad", defaultHourlyRate: -1 },
    }),
  ).rejects.toThrow("defaultHourlyRate must be non-negative");

  await expect(
    createStreamerProfile({
      repo,
      audit,
      actor,
      input: { displayName: "Bad", defaultBaseSalary: -1 },
    }),
  ).rejects.toThrow("defaultBaseSalary must be non-negative");

  await expect(
    createStreamerProfile({
      repo,
      audit,
      actor,
      input: { displayName: "Bad", defaultCpsRateBps: 10001 },
    }),
  ).rejects.toThrow("defaultCpsRateBps must be between 0 and 10000");
});
```

- [ ] **Step 2: Write failing update service tests**

Add:

```ts
it("updates streamer settlement defaults with high-risk audit", async () => {
  const before = {
    id: "S-price",
    displayName: "Price Streamer",
    userId: null,
    riskLevel: "low" as const,
    cooperationStatus: "active" as const,
  };
  const after = { ...before };
  const repo = {
    createProfile: vi.fn(),
    getById: vi.fn().mockResolvedValue(before),
    updateRisk: vi.fn(),
    updateSettlementRule: vi.fn().mockResolvedValue(after),
  };
  const audit = vi.fn().mockResolvedValue(undefined);

  await updateStreamerSettlementRule({
    repo,
    audit,
    actor: { ...actor, role: "owner" },
    streamerId: before.id,
    input: {
      defaultSettlementMethod: "cps",
      defaultHourlyRate: 0,
      defaultBaseSalary: 0,
      defaultCpsRateBps: 1500,
    },
    reason: "signed cps update",
  });

  expect(repo.updateSettlementRule).toHaveBeenCalledWith(before.id, {
    default_settlement_method: "cps",
    default_price: 0,
    default_base_salary: 0,
    default_cps_rate_bps: 1500,
  });
  expect(audit).toHaveBeenCalledWith(
    expect.objectContaining({
      action: "update",
      module: "streamer",
      objectType: "streamer",
      isHighRisk: true,
      reason: "signed cps update",
      changedFields: [
        "default_settlement_method",
        "default_price",
        "default_base_salary",
        "default_cps_rate_bps",
      ],
    }),
  );
});

it("requires owner or ops_manager and reason for settlement default updates", async () => {
  const repo = {
    createProfile: vi.fn(),
    getById: vi.fn().mockResolvedValue({
      id: "S-price",
      displayName: "Price Streamer",
      riskLevel: "low",
      cooperationStatus: "active",
    }),
    updateRisk: vi.fn(),
    updateSettlementRule: vi.fn(),
  };

  await expect(
    updateStreamerSettlementRule({
      repo,
      audit: vi.fn(),
      actor,
      streamerId: "S-price",
      input: { defaultCpsRateBps: 1500 },
      reason: "update",
    }),
  ).rejects.toThrow(
    "Only owner and ops_manager can update streamer settlement rules",
  );

  await expect(
    updateStreamerSettlementRule({
      repo,
      audit: vi.fn(),
      actor: { ...actor, role: "ops_manager" },
      streamerId: "S-price",
      input: { defaultCpsRateBps: 1500 },
      reason: " ",
    }),
  ).rejects.toThrow("Streamer settlement rule changes require a reason");
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
pnpm test features/streamers/streamer-service.test.ts
```

Expected: FAIL because settlement fields and update service do not exist.

- [ ] **Step 4: Implement service types and validation**

In `features/streamers/streamer-service.ts`, update `StreamerRecord`:

```ts
export type StreamerRecord = {
  id: string;
  displayName: string;
  userId?: string | null;
  riskLevel: StreamerRiskLevel;
  riskReason?: string | null;
  blacklistReason?: string | null;
  cooperationStatus: StreamerCooperationStatus;
};
```

Leave `StreamerRecord` as-is for now because existing callers do not need price values on the write return. Extend input types:

```ts
export type CreateStreamerProfileInput = {
  displayName: string;
  userId?: string | null;
  realName?: string | null;
  gender?: string | null;
  sourceType?: StreamerSourceType;
  categories?: string[];
  platforms?: string[];
  styles?: string[];
  defaultSettlementMethod?: StreamerSettlementMethod;
  defaultHourlyRate?: number | null;
  defaultBaseSalary?: number | null;
  defaultCpsRateBps?: number | null;
};

export type CreateStreamerProfileRepositoryInput = {
  organizationId: string;
  actorUserId: string;
  displayName: string;
  userId?: string | null;
  realName?: string | null;
  gender?: string | null;
  sourceType?: StreamerSourceType;
  categories?: string[];
  platforms?: string[];
  styles?: string[];
  defaultSettlementMethod?: StreamerSettlementMethod;
  defaultHourlyRate?: number;
  defaultBaseSalary?: number;
  defaultCpsRateBps?: number;
};

export type UpdateStreamerSettlementRuleInput = {
  defaultSettlementMethod?: StreamerSettlementMethod;
  defaultHourlyRate?: number | null;
  defaultBaseSalary?: number | null;
  defaultCpsRateBps?: number | null;
};
```

Extend `StreamerRepository`:

```ts
  updateSettlementRule(
    streamerId: string,
    input: {
      default_settlement_method?: StreamerSettlementMethod;
      default_price?: number;
      default_base_salary?: number;
      default_cps_rate_bps?: number;
    },
  ): Promise<StreamerRecord>;
```

Add numeric validation helpers near `normalizeTextList`:

```ts
function normalizeNonNegativeNumber(
  value: number | null | undefined,
  fieldName: string,
) {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${fieldName} must be non-negative`);
  }
  return value;
}

function normalizeCpsRateBps(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value < 0 || value > 10000) {
    throw new Error("defaultCpsRateBps must be between 0 and 10000");
  }
  return value;
}
```

Update `normalizeCreateStreamerInput` return:

```ts
    defaultSettlementMethod: input.defaultSettlementMethod,
    defaultHourlyRate: normalizeNonNegativeNumber(
      input.defaultHourlyRate,
      "defaultHourlyRate",
    ),
    defaultBaseSalary: normalizeNonNegativeNumber(
      input.defaultBaseSalary,
      "defaultBaseSalary",
    ),
    defaultCpsRateBps: normalizeCpsRateBps(input.defaultCpsRateBps),
```

Pass fields into `createInput`:

```ts
if (normalizedInput.defaultHourlyRate !== undefined) {
  createInput.defaultHourlyRate = normalizedInput.defaultHourlyRate;
}
if (normalizedInput.defaultBaseSalary !== undefined) {
  createInput.defaultBaseSalary = normalizedInput.defaultBaseSalary;
}
if (normalizedInput.defaultCpsRateBps !== undefined) {
  createInput.defaultCpsRateBps = normalizedInput.defaultCpsRateBps;
}
```

Extend changed fields:

```ts
if (input.defaultHourlyRate !== undefined) fields.push("default_price");
if (input.defaultBaseSalary !== undefined) {
  fields.push("default_base_salary");
}
if (input.defaultCpsRateBps !== undefined) {
  fields.push("default_cps_rate_bps");
}
```

- [ ] **Step 5: Implement update service**

Add after `updateStreamerRisk`:

```ts
export async function updateStreamerSettlementRule({
  repo,
  audit,
  actor,
  streamerId,
  input,
  reason,
}: {
  repo: StreamerRepository;
  audit: StreamerAuditWriter;
  actor: StreamerActor;
  streamerId: string;
  input: UpdateStreamerSettlementRuleInput;
  reason: string;
}): Promise<StreamerRecord> {
  if (!canEditStreamerSettlementRule(actor.role)) {
    throw new Error(
      "Only owner and ops_manager can update streamer settlement rules",
    );
  }
  if (!reason.trim()) {
    throw new Error("Streamer settlement rule changes require a reason");
  }

  const before = await repo.getById(streamerId);
  if (!before) {
    throw new Error("Streamer not found");
  }

  const normalized = normalizeSettlementRuleInput(input);
  const patch = removeUndefined({
    default_settlement_method: normalized.defaultSettlementMethod,
    default_price: normalized.defaultHourlyRate,
    default_base_salary: normalized.defaultBaseSalary,
    default_cps_rate_bps: normalized.defaultCpsRateBps,
  });
  const streamer = await repo.updateSettlementRule(streamerId, patch);

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "update",
    module: "streamer",
    objectType: "streamer",
    objectId: streamer.id,
    objectName: streamer.displayName,
    before,
    after: streamer,
    changedFields: Object.keys(patch),
    isHighRisk: true,
    reason: reason.trim(),
  });

  return streamer;
}

function normalizeSettlementRuleInput(
  input: UpdateStreamerSettlementRuleInput,
) {
  return {
    defaultSettlementMethod: input.defaultSettlementMethod,
    defaultHourlyRate: normalizeNonNegativeNumber(
      input.defaultHourlyRate,
      "defaultHourlyRate",
    ),
    defaultBaseSalary: normalizeNonNegativeNumber(
      input.defaultBaseSalary,
      "defaultBaseSalary",
    ),
    defaultCpsRateBps: normalizeCpsRateBps(input.defaultCpsRateBps),
  };
}

function canEditStreamerSettlementRule(role: AppRole): boolean {
  return role === "owner" || role === "ops_manager";
}
```

- [ ] **Step 6: Run service tests**

Run:

```bash
pnpm test features/streamers/streamer-service.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add features/streamers/streamer-service.ts features/streamers/streamer-service.test.ts
git commit -m "feat: validate streamer settlement defaults"
```

---

### Task 3: Streamer Repository, Queries, DTOs, and Routes

**Files:**

- Modify: `features/streamers/streamer-repository.ts`
- Modify: `features/streamers/streamer-queries.ts`
- Modify: `features/streamers/streamer-ui-dto.ts`
- Modify: `features/streamers/streamer-ui-dto.test.ts`
- Modify: `app/api/streamers/route.ts`
- Modify: `app/api/streamers/streamers-route.test.ts`
- Create: `app/api/streamers/[streamerId]/settlement-rule/route.ts`

- [ ] **Step 1: Write failing DTO tests**

In `features/streamers/streamer-ui-dto.test.ts`, add:

```ts
it("formats default settlement labels with cpt cps and base salary details", () => {
  expect(
    toStreamerCardDto({
      id: "s-cpt",
      display_name: "CPT Streamer",
      real_name: null,
      gender: null,
      source_type: "external",
      cooperation_status: "active",
      categories: [],
      platforms: [],
      styles: [],
      default_settlement_method: "cpt",
      default_price: 80,
      default_base_salary: 0,
      default_cps_rate_bps: 0,
      risk_level: "low",
      clean_report_count: 0,
      created_at: "2026-06-01T00:00:00.000Z",
    }).defaultRule,
  ).toBe("CPT ¥80/h");

  expect(
    toStreamerCardDto({
      id: "s-cps",
      display_name: "CPS Streamer",
      real_name: null,
      gender: null,
      source_type: "external",
      cooperation_status: "active",
      categories: [],
      platforms: [],
      styles: [],
      default_settlement_method: "cps",
      default_price: 0,
      default_base_salary: 0,
      default_cps_rate_bps: 1500,
      risk_level: "low",
      clean_report_count: 0,
      created_at: "2026-06-01T00:00:00.000Z",
    }).defaultRule,
  ).toBe("CPS 15%");
});
```

Add to the desktop profile test row:

```ts
        default_cps_rate_bps: 1500,
```

Add expectation:

```ts
expect(dto.settlement.cpsShare).toContain("15%");
```

- [ ] **Step 2: Run DTO tests to verify failure**

Run:

```bash
pnpm test features/streamers/streamer-ui-dto.test.ts
```

Expected: FAIL because DTO type and labels do not include CPS.

- [ ] **Step 3: Update query row types and selects**

In `features/streamers/streamer-queries.ts`, add to `StreamerListRow`:

```ts
  default_cps_rate_bps?: number | null;
```

Add `default_price, default_base_salary, default_cps_rate_bps` to the `listStreamerPool` select string so list cards can show full labels.

Add `default_cps_rate_bps` to `getStreamerProfileRow` select string.

- [ ] **Step 4: Update DTO types and formatting**

In `features/streamers/streamer-ui-dto.ts`, extend `StreamerCardDto`:

```ts
settlement: {
  method: string;
  cptHourlyRate: number;
  baseSalary: number;
  cpsRateBps: number;
  label: string;
}
```

Extend `StreamerDesktopProfileDto["settlement"]`:

```ts
cpsShare: string;
```

In `toStreamerCardDto`, calculate:

```ts
const settlement = settlementSummary(row);
```

Return:

```ts
    defaultRule: settlement.label,
    settlement,
```

In `toStreamerDesktopProfileDto`, read:

```ts
const cpsRateBps = Number(row.default_cps_rate_bps ?? 0);
```

Return:

```ts
      cpsShare: cpsRateBps > 0 ? `${formatPercentBps(cpsRateBps)}%` : "未配置",
```

Add helper:

```ts
function settlementSummary(row: StreamerListRow) {
  const method = row.default_settlement_method || "manual";
  const cptHourlyRate = Number(row.default_price ?? 0);
  const baseSalary = Number(row.default_base_salary ?? 0);
  const cpsRateBps = Number(row.default_cps_rate_bps ?? 0);
  return {
    method,
    cptHourlyRate,
    baseSalary,
    cpsRateBps,
    label: settlementRuleLabel(method, baseSalary, cptHourlyRate, cpsRateBps),
  };
}

function formatPercentBps(value: number) {
  const percent = value / 100;
  return Number.isInteger(percent) ? String(percent) : percent.toFixed(2);
}
```

Replace `settlementRuleLabel(method, baseSalary, cpt)` with:

```ts
function settlementRuleLabel(
  method: string,
  baseSalary: number,
  cpt: number,
  cpsRateBps = 0,
) {
  const baseText = baseSalary > 0 ? `底薪 ¥${formatNumber(baseSalary)}` : "";
  const cptText = cpt > 0 ? `CPT ¥${formatNumber(cpt)}/h` : "";
  const cpsText = cpsRateBps > 0 ? `CPS ${formatPercentBps(cpsRateBps)}%` : "";

  if (method === "base_salary_cpt") {
    return [baseText || "底薪未配置", cptText || "CPT 未配置"].join(" + ");
  }
  if (method === "base_salary") {
    return baseText || "底薪未配置";
  }
  if (method === "cpt") {
    return cptText || "CPT 未配置";
  }
  if (method === "cps") {
    return cpsText || "CPS 未配置";
  }
  return method ? method.toUpperCase() : "未配置";
}
```

- [ ] **Step 5: Update repository persistence**

In `features/streamers/streamer-repository.ts`, add `updateSettlementRule` implementation:

```ts
  async updateSettlementRule(
    streamerId: string,
    input: {
      default_settlement_method?: StreamerSettlementMethod;
      default_price?: number;
      default_base_salary?: number;
      default_cps_rate_bps?: number;
    },
  ): Promise<StreamerRecord> {
    const { data, error } = await this.client
      .from("streamers")
      .update(input)
      .eq("id", streamerId)
      .select(streamerSelect)
      .single<StreamerRow>();

    if (error) {
      throw error;
    }

    return toStreamerRecord(data);
  }
```

Also map create inputs:

```ts
if (input.defaultHourlyRate !== undefined) {
  insertPayload.default_price = input.defaultHourlyRate;
}
if (input.defaultBaseSalary !== undefined) {
  insertPayload.default_base_salary = input.defaultBaseSalary;
}
if (input.defaultCpsRateBps !== undefined) {
  insertPayload.default_cps_rate_bps = input.defaultCpsRateBps;
}
```

Import `StreamerSettlementMethod` from `streamer-service` in this file.

- [ ] **Step 6: Write failing route tests for create payload**

In `app/api/streamers/streamers-route.test.ts`, update the existing POST test payload with:

```ts
        defaultHourlyRate: 80,
        defaultBaseSalary: 6000,
        defaultCpsRateBps: 1500,
```

Update expected `input`:

```ts
          defaultHourlyRate: 80,
          defaultBaseSalary: 6000,
          defaultCpsRateBps: 1500,
```

Add invalid number test:

```ts
it("POST /api/streamers rejects invalid settlement numbers", async () => {
  const { POST } = await import("./route");
  const response = await POST(
    jsonRequest({
      displayName: "Bad Streamer",
      defaultHourlyRate: -1,
    }),
  );

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({
    error: "defaultHourlyRate must be non-negative",
  });
  expect(createStreamerProfile).not.toHaveBeenCalled();
});
```

- [ ] **Step 7: Update streamers create route parser**

In `app/api/streamers/route.ts`, add to `StreamerPostBody`:

```ts
  defaultHourlyRate?: unknown;
  defaultBaseSalary?: unknown;
  defaultCpsRateBps?: unknown;
```

Add helpers:

```ts
function optionalNumber(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldName} must be a number`);
  }
  return parsed;
}

function optionalInteger(value: unknown, fieldName: string) {
  const parsed = optionalNumber(value, fieldName);
  if (parsed === undefined) {
    return undefined;
  }
  if (!Number.isInteger(parsed)) {
    throw new Error(`${fieldName} must be an integer`);
  }
  return parsed;
}
```

Pass into service:

```ts
        defaultHourlyRate: optionalNumber(
          body.defaultHourlyRate,
          "defaultHourlyRate",
        ),
        defaultBaseSalary: optionalNumber(
          body.defaultBaseSalary,
          "defaultBaseSalary",
        ),
        defaultCpsRateBps: optionalInteger(
          body.defaultCpsRateBps,
          "defaultCpsRateBps",
        ),
```

- [ ] **Step 8: Add route test for settlement-rule update**

In `app/api/streamers/streamers-route.test.ts`, add `updateStreamerSettlementRule` to the imports and to the mocked service export. Add a mock for the billing guard near the existing mocks:

```ts
vi.mock("@/features/billing/route-guard", () => ({
  assertBillingWriteAllowed: vi.fn(),
}));
```

Add:

```ts
it("PATCH /api/streamers/[streamerId]/settlement-rule updates high-risk settlement defaults", async () => {
  vi.mocked(updateStreamerSettlementRule).mockResolvedValue({
    id: "s1",
    displayName: "Price Streamer",
    riskLevel: "low",
    cooperationStatus: "active",
  } as never);

  const { PATCH } = await import("./[streamerId]/settlement-rule/route");
  const response = await PATCH(
    jsonRequest(
      {
        defaultSettlementMethod: "cps",
        defaultHourlyRate: 0,
        defaultBaseSalary: 0,
        defaultCpsRateBps: 1500,
        reason: "signed cps update",
      },
      "PATCH",
    ),
    { params: Promise.resolve({ streamerId: "s1" }) },
  );

  expect(response.status).toBe(200);
  expect(updateStreamerSettlementRule).toHaveBeenCalledWith(
    expect.objectContaining({
      audit: expect.any(Function),
      actor: auth,
      streamerId: "s1",
      reason: "signed cps update",
      input: {
        defaultSettlementMethod: "cps",
        defaultHourlyRate: 0,
        defaultBaseSalary: 0,
        defaultCpsRateBps: 1500,
      },
    }),
  );
});
```

- [ ] **Step 9: Create settlement-rule route**

Create `app/api/streamers/[streamerId]/settlement-rule/route.ts`:

```ts
import { NextResponse } from "next/server";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import { SupabaseStreamerRepository } from "@/features/streamers/streamer-repository";
import {
  STREAMER_SETTLEMENT_METHODS,
  updateStreamerSettlementRule,
  type StreamerSettlementMethod,
} from "@/features/streamers/streamer-service";
import { writeAuditLog } from "@/lib/audit/audit";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ streamerId: string }> },
) {
  try {
    const { streamerId } = await params;
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await assertBillingWriteAllowed({
      client: supabase,
      organizationId: auth.organizationId,
      featureKey: "settlement",
    });

    const body = (await request
      .json()
      .catch(() => ({}))) as StreamerSettlementPatchBody;
    const defaultSettlementMethod = normalizeEnum(
      body.defaultSettlementMethod,
      STREAMER_SETTLEMENT_METHODS,
      "defaultSettlementMethod",
    );
    if (defaultSettlementMethod instanceof Response) {
      return defaultSettlementMethod;
    }

    const streamer = await updateStreamerSettlementRule({
      repo: new SupabaseStreamerRepository(supabase),
      audit: (input) => writeAuditLog(supabase, input),
      actor: auth,
      streamerId,
      input: {
        defaultSettlementMethod: defaultSettlementMethod as
          | StreamerSettlementMethod
          | undefined,
        defaultHourlyRate: optionalNumber(
          body.defaultHourlyRate,
          "defaultHourlyRate",
        ),
        defaultBaseSalary: optionalNumber(
          body.defaultBaseSalary,
          "defaultBaseSalary",
        ),
        defaultCpsRateBps: optionalInteger(
          body.defaultCpsRateBps,
          "defaultCpsRateBps",
        ),
      },
      reason: normalizeOptionalText(body.reason) ?? "",
    });

    return NextResponse.json({ streamer });
  } catch (error) {
    return jsonServiceError(error);
  }
}

type StreamerSettlementPatchBody = {
  defaultSettlementMethod?: unknown;
  defaultHourlyRate?: unknown;
  defaultBaseSalary?: unknown;
  defaultCpsRateBps?: unknown;
  reason?: unknown;
};

function normalizeOptionalText(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function optionalNumber(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldName} must be a number`);
  }
  return parsed;
}

function optionalInteger(value: unknown, fieldName: string) {
  const parsed = optionalNumber(value, fieldName);
  if (parsed === undefined) {
    return undefined;
  }
  if (!Number.isInteger(parsed)) {
    throw new Error(`${fieldName} must be an integer`);
  }
  return parsed;
}

function normalizeEnum<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  fieldName: string,
) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return undefined;
  }
  if (allowedValues.includes(normalized as T)) {
    return normalized as T;
  }
  return NextResponse.json(
    { error: `${fieldName} is invalid` },
    { status: 400 },
  );
}

function jsonServiceError(error: unknown) {
  if (error instanceof Error) {
    return NextResponse.json(
      { error: error.message },
      { status: statusForServiceError(error) },
    );
  }
  return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
}
```

- [ ] **Step 10: Run streamer query, DTO, and route tests**

Run:

```bash
pnpm test features/streamers/streamer-ui-dto.test.ts app/api/streamers/streamers-route.test.ts
```

Expected: PASS.

- [ ] **Step 11: Run streamers API route tests after the new route**

Run:

```bash
pnpm test app/api/streamers/streamers-route.test.ts
```

Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add features/streamers app/api/streamers
git commit -m "feat: expose streamer settlement defaults"
```

---

### Task 4: Project Join Settlement Snapshot

**Files:**

- Modify: `features/applications/application-service.test.ts`
- Modify: `features/applications/application-service.ts`
- Modify: `features/applications/application-repository.ts`

- [ ] **Step 1: Write failing service tests**

In `features/applications/application-service.test.ts`, update `makeRepo().getStreamerForAdmission` default to include:

```ts
      defaultSettlementMethod: "base_salary_cpt",
      defaultHourlyRate: 80,
      defaultBaseSalary: 6000,
      defaultCpsRateBps: 0,
```

Add tests:

```ts
it("freezes the streamer default settlement rule when joining", async () => {
  const repo = makeRepo({
    getApplicationById: vi.fn().mockResolvedValue({
      ...baseApplication,
      status: "recording_approved",
    }),
    getStreamerForAdmission: vi.fn().mockResolvedValue({
      id: "streamer-1",
      displayName: "Streamer One",
      userId: streamerActor.userId,
      riskLevel: "low",
      defaultSettlementMethod: "base_salary_cpt",
      defaultHourlyRate: 80,
      defaultBaseSalary: 6000,
      defaultCpsRateBps: 0,
    }),
  });

  await confirmApplicationJoin({
    repo,
    audit: vi.fn().mockResolvedValue(undefined),
    notify: vi.fn().mockResolvedValue(undefined),
    actor: staffActor,
    input: { applicationId: "app-1" },
  });

  expect(repo.createProjectStreamer).toHaveBeenCalledWith(
    expect.objectContaining({
      settlementMethod: "base_salary_cpt",
      hourlyRate: 80,
      baseSalary: 6000,
      cpsRateBps: 0,
      settlementRule: expect.objectContaining({
        source: "streamer_default",
        settlementMethod: "base_salary_cpt",
        cptHourlyRate: 80,
        baseSalary: 6000,
        cpsRateBps: 0,
      }),
    }),
  );
});

it("falls back to project settlement rule when streamer default is unconfigured", async () => {
  const repo = makeRepo({
    getApplicationById: vi.fn().mockResolvedValue({
      ...baseApplication,
      status: "recording_approved",
    }),
    getStreamerForAdmission: vi.fn().mockResolvedValue({
      id: "streamer-1",
      displayName: "Streamer One",
      userId: streamerActor.userId,
      riskLevel: "low",
      defaultSettlementMethod: "manual",
      defaultHourlyRate: 0,
      defaultBaseSalary: 0,
      defaultCpsRateBps: 0,
    }),
  });

  await confirmApplicationJoin({
    repo,
    audit: vi.fn().mockResolvedValue(undefined),
    notify: vi.fn().mockResolvedValue(undefined),
    actor: staffActor,
    input: { applicationId: "app-1" },
  });

  expect(repo.createProjectStreamer).toHaveBeenCalledWith(
    expect.objectContaining({
      settlementMethod: "cpt",
      hourlyRate: 80,
      baseSalary: 0,
      cpsRateBps: 0,
      settlementRule: expect.objectContaining({
        source: "project_default",
      }),
    }),
  );
});
```

Update the existing "copies the project settlement snapshot when joining" test to expect `cpsRateBps: 0` and either rename it or keep it focused on fallback.

- [ ] **Step 2: Run application tests to verify failure**

Run:

```bash
pnpm test features/applications/application-service.test.ts
```

Expected: FAIL because streamer defaults are not read or passed to createProjectStreamer.

- [ ] **Step 3: Extend application service types**

In `features/applications/application-service.ts`, extend `StreamerAdmissionRecord`:

```ts
  defaultSettlementMethod?: string | null;
  defaultHourlyRate?: number | null;
  defaultBaseSalary?: number | null;
  defaultCpsRateBps?: number | null;
```

Extend `createProjectStreamer` input:

```ts
cpsRateBps: number;
```

- [ ] **Step 4: Add snapshot resolver**

Add helper near `canConfirmJoin`:

```ts
function resolveProjectStreamerSettlementSnapshot({
  project,
  streamer,
  now,
}: {
  project: ProjectAdmissionConfig;
  streamer: StreamerAdmissionRecord;
  now: string;
}) {
  if (streamerHasConfiguredSettlement(streamer)) {
    const method = streamer.defaultSettlementMethod ?? "manual";
    const hourlyRate = streamer.defaultHourlyRate ?? 0;
    const baseSalary = streamer.defaultBaseSalary ?? 0;
    const cpsRateBps = streamer.defaultCpsRateBps ?? 0;
    return {
      settlementMethod: method,
      hourlyRate,
      baseSalary,
      cpsRateBps,
      settlementRule: {
        source: "streamer_default",
        settlementMethod: method,
        cptHourlyRate: hourlyRate,
        baseSalary,
        cpsRateBps,
        snapshotAt: now,
      },
    };
  }

  return {
    settlementMethod: project.defaultSettlementMethod,
    hourlyRate: project.defaultHourlyRate,
    baseSalary: project.defaultBaseSalary,
    cpsRateBps: 0,
    settlementRule: {
      ...project.defaultSettlementRule,
      source: "project_default",
      settlementMethod: project.defaultSettlementMethod,
      cptHourlyRate: project.defaultHourlyRate,
      baseSalary: project.defaultBaseSalary,
      cpsRateBps: 0,
      snapshotAt: now,
    },
  };
}

function streamerHasConfiguredSettlement(streamer: StreamerAdmissionRecord) {
  const method = streamer.defaultSettlementMethod ?? "manual";
  return (
    (["cpt", "base_salary_cpt"].includes(method) &&
      (streamer.defaultHourlyRate ?? 0) > 0) ||
    (["base_salary", "base_salary_cpt"].includes(method) &&
      (streamer.defaultBaseSalary ?? 0) > 0) ||
    (method === "cps" && (streamer.defaultCpsRateBps ?? 0) > 0)
  );
}
```

- [ ] **Step 5: Use resolver in confirmApplicationJoin**

In `confirmApplicationJoin`, load streamer before snapshot:

```ts
const streamer = await requireStreamer(repo, application.streamerId);
const now = new Date().toISOString();
const settlementSnapshot = resolveProjectStreamerSettlementSnapshot({
  project,
  streamer,
  now,
});
```

Replace create call fields:

```ts
    settlementMethod: settlementSnapshot.settlementMethod,
    hourlyRate: settlementSnapshot.hourlyRate,
    baseSalary: settlementSnapshot.baseSalary,
    cpsRateBps: settlementSnapshot.cpsRateBps,
    settlementRule: settlementSnapshot.settlementRule,
```

Use the same `now` for `decidedAt`:

```ts
    decidedAt: now,
```

- [ ] **Step 6: Update Supabase application repository**

In `features/applications/application-repository.ts`, extend `StreamerAdmissionRow`:

```ts
default_settlement_method: string;
default_price: number;
default_base_salary: number;
default_cps_rate_bps: number;
```

Update select in `getStreamerForAdmission`:

```ts
"id, display_name, user_id, risk_level, cooperation_status, default_settlement_method, default_price, default_base_salary, default_cps_rate_bps";
```

Extend `createProjectStreamer` input with `cpsRateBps: number`, and add insert field:

```ts
          cps_rate_bps: input.cpsRateBps,
```

Update `toStreamerAdmissionRecord`:

```ts
    defaultSettlementMethod: row.default_settlement_method,
    defaultHourlyRate: Number(row.default_price ?? 0),
    defaultBaseSalary: Number(row.default_base_salary ?? 0),
    defaultCpsRateBps: Number(row.default_cps_rate_bps ?? 0),
```

- [ ] **Step 7: Run application tests**

Run:

```bash
pnpm test features/applications/application-service.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add features/applications/application-service.ts features/applications/application-service.test.ts features/applications/application-repository.ts
git commit -m "feat: freeze streamer settlement defaults on join"
```

---

### Task 5: Settlement CPS Helper and Manual Import

**Files:**

- Modify: `features/settlements/settlement-engine.test.ts`
- Modify: `features/settlements/settlement-engine.ts`
- Modify: `features/settlements/settlement-service.test.ts`
- Modify: `features/settlements/settlement-service.ts`
- Modify: `features/settlements/settlement-repository.ts`
- Modify: `features/settlements/settlement-queries.ts`
- Modify: `app/api/settlement-batches/[batchId]/manual-items/route.ts`

- [ ] **Step 1: Write failing engine tests**

In `features/settlements/settlement-engine.test.ts`, add import:

```ts
  calculateCpsManualAmount,
```

Add:

```ts
it("calculates CPS manual amount from sales amount and basis points", () => {
  expect(
    calculateCpsManualAmount({ salesAmount: 12000, cpsRateBps: 1500 }),
  ).toBe(1800);
  expect(
    calculateCpsManualAmount({ salesAmount: 999.99, cpsRateBps: 250 }),
  ).toBe(25);
});
```

- [ ] **Step 2: Run engine tests to verify failure**

Run:

```bash
pnpm test features/settlements/settlement-engine.test.ts
```

Expected: FAIL because `calculateCpsManualAmount` does not exist.

- [ ] **Step 3: Implement CPS helper**

In `features/settlements/settlement-engine.ts`, extend `SettlementRule`:

```ts
  cpsRateBps?: number | null;
```

Export helper above `summarizeEvidence`:

```ts
export function calculateCpsManualAmount({
  salesAmount,
  cpsRateBps,
}: {
  salesAmount: number;
  cpsRateBps: number;
}): number {
  if (!Number.isFinite(salesAmount) || salesAmount < 0) {
    throw new Error("salesAmount must be non-negative");
  }
  if (!Number.isInteger(cpsRateBps) || cpsRateBps < 0 || cpsRateBps > 10000) {
    throw new Error("cpsRateBps must be between 0 and 10000");
  }
  return roundCurrency((salesAmount * cpsRateBps) / 10000);
}
```

- [ ] **Step 4: Write failing settlement service CPS import test**

In `features/settlements/settlement-service.test.ts`, change `settlementRule` to include:

```ts
  cpsRateBps: 1500,
```

Add:

```ts
it("calculates CPS manual rows from sales amount and frozen rate", async () => {
  const item = await addManualSettlementItem({
    repo,
    audit,
    notify,
    actor: opsActor,
    batchId: "batch-1",
    input: {
      itemType: "cps",
      projectId: "project-1",
      streamerId: "streamer-1",
      salesAmount: 12000,
      evidenceLevel: "yellow",
      reason: "Imported CPS sales sheet",
    },
  });

  expect(item).toMatchObject({
    itemType: "cps",
    manualAmount: 1800,
    computedAmount: 0,
    evidenceSnapshot: expect.objectContaining({
      source: "manual_cps_import",
      salesAmount: 12000,
      cpsRateBps: 1500,
      settlementRuleSource: "project_streamer_snapshot",
    }),
  });
});
```

- [ ] **Step 5: Run settlement service test to verify failure**

Run:

```bash
pnpm test features/settlements/settlement-service.test.ts
```

Expected: FAIL because `salesAmount` is not accepted and rules do not expose CPS rate.

- [ ] **Step 6: Extend settlement repository rule types**

In `features/settlements/settlement-service.ts`, extend:

```ts
export type SettlementRuleRecord = {
  projectId: string;
  streamerId: string;
} & SettlementRule;
```

No type line change is needed if `SettlementRule` now has `cpsRateBps`.

In `features/settlements/settlement-repository.ts`, add `cps_rate_bps` to:

- `SettlementRuleRow`
- `getSettlementRules` select
- `toSettlementRuleRecord`

Code:

```ts
type SettlementRuleRow = {
  project_id: string;
  streamer_id: string;
  settlement_method: SettlementMethod | null;
  hourly_rate: number | null;
  base_salary: number | null;
  cps_rate_bps: number | null;
};
```

Select:

```ts
"project_id, streamer_id, settlement_method, hourly_rate, base_salary, cps_rate_bps";
```

Mapper:

```ts
    cpsRateBps: Number(row.cps_rate_bps ?? 0),
```

In `features/settlements/settlement-queries.ts`, add `cps_rate_bps` to `ProjectStreamerRuleRow`, rule selects, and pool item conversion. Add optional `cpsRateBps` to `OpsSettlementPoolItem` if useful for UI.

- [ ] **Step 7: Extend addManualSettlementItem for CPS sales amount**

In `features/settlements/settlement-service.ts`, import:

```ts
  calculateCpsManualAmount,
```

Extend input type:

```ts
    manualAmount?: number;
    salesAmount?: number;
```

Before creating item, derive manual amount:

```ts
const manualAmount = await resolveManualSettlementAmount({
  repo,
  batch: before,
  input,
});
```

Replace `assertManualAmount(input.manualAmount);` with:

```ts
assertManualAmount(manualAmount);
```

Replace created item amount:

```ts
    manualAmount,
```

Add helper:

```ts
async function resolveManualSettlementAmount({
  repo,
  batch,
  input,
}: {
  repo: Pick<SettlementRepository, "getSettlementRules">;
  batch: SettlementBatchRecord;
  input: {
    itemType: ManualSettlementItemType;
    streamerId?: string | null;
    manualAmount?: number;
    salesAmount?: number;
  };
}) {
  if (
    input.itemType === "cps" &&
    input.manualAmount === undefined &&
    input.salesAmount !== undefined &&
    input.streamerId
  ) {
    const [rule] = await repo.getSettlementRules({
      projectId: batch.projectId,
      streamerIds: [input.streamerId],
    });
    return calculateCpsManualAmount({
      salesAmount: input.salesAmount,
      cpsRateBps: rule?.cpsRateBps ?? 0,
    });
  }

  return input.manualAmount ?? 0;
}
```

Add `getSettlementRules` to the `repo` Pick in `addManualSettlementItem`.

Change evidence snapshot for CPS:

```ts
    evidenceSnapshot:
      input.itemType === "cps" && input.salesAmount !== undefined
        ? {
            source: "manual_cps_import",
            itemType: input.itemType,
            reason: input.reason,
            note: input.note,
            salesAmount: input.salesAmount,
            cpsRateBps: await getCpsRateBpsForSnapshot(...),
            settlementRuleSource: "project_streamer_snapshot",
          }
        : {
            source: "manual",
            itemType: input.itemType,
            reason: input.reason,
            note: input.note,
          },
```

Keep this DRY in implementation by letting `resolveManualSettlementAmount` return both `manualAmount` and `cpsRateBps`.

- [ ] **Step 8: Update manual-items route**

In `app/api/settlement-batches/[batchId]/manual-items/route.ts`, change:

```ts
        manualAmount: requiredNumber(body, "manualAmount"),
```

to:

```ts
        manualAmount:
          body.manualAmount === undefined
            ? undefined
            : requiredNumber(body, "manualAmount"),
        salesAmount: optionalNumber(body, "salesAmount"),
```

Keep `manualAmount` required for non-CPS by adding route validation:

```ts
if (itemType !== "cps" && body.manualAmount === undefined) {
  throw new RouteError("manualAmount is required", 400);
}
```

- [ ] **Step 9: Run settlement tests**

Run:

```bash
pnpm test features/settlements/settlement-engine.test.ts features/settlements/settlement-service.test.ts features/settlements/settlement-queries.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add features/settlements app/api/settlement-batches/[batchId]/manual-items/route.ts
git commit -m "feat: support cps settlement import amounts"
```

---

### Task 6: Regression Golden Path

**Files:**

- Modify: `features/regression/settlement-golden-path.ts`
- Modify: `features/regression/settlement-golden-path.test.ts`

- [ ] **Step 1: Write failing regression assertion**

In `features/regression/settlement-golden-path.test.ts`, add expectations to the golden path result test:

```ts
expect(result.batchItems[0].evidenceSnapshot).toMatchObject({
  settlementDuration: 120,
  timeSource: "system",
  evidenceLevel: "green",
});
expect(result.batchItems[0].computedAmount).toBe(160);
```

If there is already an amount assertion, add a second streamer-default assertion by extending the in-memory repository test fixture:

```ts
expect(result.batchItems[0]).toMatchObject({
  computedAmount: 160,
  streamerId: "streamer-1",
});
```

- [ ] **Step 2: Update in-memory repository for new type**

In `features/regression/settlement-golden-path.ts`, add `cpsRateBps: 0` to `getSettlementRules` return:

```ts
      cpsRateBps: 0,
```

Add `cpsRateBps: 0` to `getProjectSettlementRule` return.

- [ ] **Step 3: Run golden path**

Run:

```bash
pnpm test features/regression/settlement-golden-path.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add features/regression/settlement-golden-path.ts features/regression/settlement-golden-path.test.ts
git commit -m "test: cover streamer settlement default golden path"
```

---

### Task 7: Ops Reference UI

**Files:**

- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`

- [ ] **Step 1: Write failing UI create payload test**

In `components/reference-ui/ops-reference.test.jsx`, update the "creates a streamer profile through the backend API and refreshes the pool" test:

After selecting default settlement method `cps`, add:

```ts
fireEvent.change(screen.getByLabelText("CPS 分成比例"), {
  target: { value: "15" },
});
```

Update expected POST body:

```ts
      defaultHourlyRate: 0,
      defaultBaseSalary: 0,
      defaultCpsRateBps: 1500,
```

Add a second UI test for `base_salary_cpt`:

```ts
  it("submits CPT and base salary fields from the streamer create form", async () => {
    const fetchMock = vi.fn(async (url, init) => {
      if (String(url) === "/api/organization/members") {
        return {
          ok: true,
          json: async () => ({
            members: [],
            permissions: {
              canViewMembers: true,
              canCreateMembers: true,
              creatableRoles: ["streamer"],
            },
          }),
        };
      }
      if (String(url) === "/api/streamers" && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({ streamer: { id: "streamer-priced" } }),
        };
      }
      return { ok: true, json: async () => ({ streamers: [] }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<OpsReferenceApp initialRoute="streamers" streamerCards={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "新增主播档案" }));
    fireEvent.change(screen.getByLabelText("主播昵称"), {
      target: { value: "Priced Streamer" },
    });
    fireEvent.change(screen.getByLabelText("默认结算"), {
      target: { value: "base_salary_cpt" },
    });
    fireEvent.change(screen.getByLabelText("CPT 小时单价"), {
      target: { value: "80" },
    });
    fireEvent.change(screen.getByLabelText("底薪"), {
      target: { value: "6000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建档案" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url) === "/api/streamers" && init?.method === "POST",
        ),
      ).toBe(true),
    );
    const streamerPostCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url) === "/api/streamers" && init?.method === "POST",
    );
    expect(JSON.parse(streamerPostCall[1].body)).toEqual(
      expect.objectContaining({
        defaultSettlementMethod: "base_salary_cpt",
        defaultHourlyRate: 80,
        defaultBaseSalary: 6000,
        defaultCpsRateBps: 0,
      }),
    );
  });
```

- [ ] **Step 2: Run UI test to verify failure**

Run:

```bash
pnpm test components/reference-ui/ops-reference.test.jsx -- --runInBand
```

Expected: FAIL because inputs are missing.

- [ ] **Step 3: Add draft fields and payload**

In `components/reference-ui/ops-reference.jsx`, extend `emptyDraft`:

```js
    defaultHourlyRate: "",
    defaultBaseSalary: "",
    defaultCpsRatePercent: "",
```

Add helpers near `splitDraftList`:

```js
function draftNumber(value) {
  const trimmed = String(value || "").trim();
  return trimmed ? Number(trimmed) : 0;
}

function draftPercentToBps(value) {
  const trimmed = String(value || "").trim();
  return trimmed ? Math.round(Number(trimmed) * 100) : 0;
}
```

Update create payload:

```js
        defaultHourlyRate: draftNumber(draft.defaultHourlyRate),
        defaultBaseSalary: draftNumber(draft.defaultBaseSalary),
        defaultCpsRateBps: draftPercentToBps(draft.defaultCpsRatePercent),
```

- [ ] **Step 4: Add conditional form inputs**

After the default settlement select, add:

```jsx
{
  ["cpt", "base_salary_cpt"].includes(draft.defaultSettlementMethod) ? (
    <label style={draftLabelStyle}>
      CPT 小时单价
      <input
        type="number"
        min="0"
        step="0.01"
        value={draft.defaultHourlyRate}
        onChange={updateDraft("defaultHourlyRate")}
        placeholder="80"
        style={draftFieldStyle}
      />
    </label>
  ) : null;
}
{
  draft.defaultSettlementMethod === "cps" ? (
    <label style={draftLabelStyle}>
      CPS 分成比例
      <input
        type="number"
        min="0"
        max="100"
        step="0.01"
        value={draft.defaultCpsRatePercent}
        onChange={updateDraft("defaultCpsRatePercent")}
        placeholder="15"
        style={draftFieldStyle}
      />
    </label>
  ) : null;
}
{
  ["base_salary", "base_salary_cpt"].includes(draft.defaultSettlementMethod) ? (
    <label style={draftLabelStyle}>
      底薪
      <input
        type="number"
        min="0"
        step="0.01"
        value={draft.defaultBaseSalary}
        onChange={updateDraft("defaultBaseSalary")}
        placeholder="6000"
        style={draftFieldStyle}
      />
    </label>
  ) : null;
}
```

- [ ] **Step 5: Show structured settlement fields in detail panel**

In `StreamerPanel`, after default settlement KV, add:

```jsx
{
  s.settlement ? (
    <>
      <KV label="CPT 单价">
        {s.settlement.cptHourlyRate > 0
          ? `¥${s.settlement.cptHourlyRate}/h`
          : "未配置"}
      </KV>
      <KV label="CPS 分成">
        {s.settlement.cpsRateBps > 0
          ? `${s.settlement.cpsRateBps / 100}%`
          : "未配置"}
      </KV>
      <KV label="底薪">
        {s.settlement.baseSalary > 0 ? `¥${s.settlement.baseSalary}` : "未配置"}
      </KV>
    </>
  ) : null;
}
```

Add a small note below the KVs:

```jsx
<div style={{ marginTop: 8, fontSize: 12, color: "var(--ink-400)" }}>
  适用于未来入项，已入项项目以项目内快照为准。
</div>
```

- [ ] **Step 6: Run UI smoke subset**

Run:

```bash
pnpm test components/reference-ui/ops-reference.test.jsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/reference-ui/ops-reference.jsx components/reference-ui/ops-reference.test.jsx
git commit -m "feat: add streamer settlement fields to ops ui"
```

---

### Task 8: Streamer Desktop Safe Display

**Files:**

- Modify: `components/reference-ui/streamer-desktop-reference.jsx`
- Modify: `components/reference-ui/streamer-desktop-reference.test.jsx`

- [ ] **Step 1: Write failing safe display test**

In `components/reference-ui/streamer-desktop-reference.test.jsx`, add `cpsShare: "15%"` to the fixture `profile.settlement` and assert:

```ts
expect(screen.getByText("15%")).toBeInTheDocument();
```

Use the existing test's import/render shape and current label encoding.

- [ ] **Step 2: Add CPS KV**

In `components/reference-ui/streamer-desktop-reference.jsx`, add under the CPT row:

```jsx
<KV label="CPS 分成">{profile.settlement.cpsShare}</KV>
```

- [ ] **Step 3: Run streamer desktop tests**

Run:

```bash
pnpm test components/reference-ui/streamer-desktop-reference.test.jsx
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/reference-ui/streamer-desktop-reference.jsx components/reference-ui/streamer-desktop-reference.test.jsx
git commit -m "feat: show safe streamer cps settlement share"
```

---

### Task 9: Final Verification and Cleanup

**Files:**

- Review all touched files.

- [ ] **Step 1: Run focused backend tests**

```bash
pnpm test lib/db/schema-contract.test.ts features/streamers/streamer-service.test.ts features/streamers/streamer-ui-dto.test.ts app/api/streamers/streamers-route.test.ts features/applications/application-service.test.ts features/settlements/settlement-engine.test.ts features/settlements/settlement-service.test.ts features/regression/settlement-golden-path.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run UI smoke tests**

```bash
pnpm test:ui-smoke
```

Expected: PASS. Existing expected Babel deopt warning from the large reference UI may appear; test result must pass.

- [ ] **Step 3: Run full verification chain**

```bash
pnpm format:check
pnpm type-check
pnpm lint
pnpm test
pnpm build
```

Expected: all commands PASS.

- [ ] **Step 4: Inspect diff**

```bash
git status --short
git diff --stat
git diff --check
```

Expected: only files related to streamer default settlement rules are modified, and `git diff --check` has no output.

- [ ] **Step 5: Confirm feature work is committed**

```bash
git status --short
```

Expected: working tree may still contain unrelated pre-existing user changes, but no uncommitted files from this streamer settlement feature remain.
