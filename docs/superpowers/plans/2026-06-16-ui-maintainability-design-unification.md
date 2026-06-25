# UI Maintainability And Design Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve frontend maintainability and design consistency without changing the current UI layout, interactions, visual hierarchy, copy, routes, API behavior, or operation logic.

**Architecture:** Treat the current reference UI as the visual source of truth and extract stable primitives around it. First add guardrails that prove no user-facing behavior changed, then move repeated design tokens, small primitives, and domain sections into focused files while preserving the rendered DOM shape and props.

**Tech Stack:** Next.js App Router, React 19, JavaScript/TypeScript, Vitest, Testing Library, Prettier, ESLint.

---

## Non-Negotiable Constraints

- Do not redesign screens.
- Do not change navigation, button order, table columns, form fields, modal behavior, status labels, copy, colors, spacing, route paths, API payloads, or keyboard/mouse operation logic.
- Do not introduce a new UI library.
- Do not convert large JSX files to TypeScript in the same pass as extraction.
- Do not delete existing smoke tests until replacement tests prove equivalent behavior.
- Preserve `components/reference-ui/ops-reference.jsx` as the source of truth during the first extraction phase.

---

## Current Maintainability Diagnosis

- `components/reference-ui/ops-reference.jsx` is about 19,906 lines and contains shared primitives, constants, hooks, navigation, domain screens, actions, tables, modals, and rendering state in one file.
- `components/reference-ui/streamer-desktop-reference.jsx` and `components/reference-ui/streamer-mobile-reference.jsx` are smaller but still large enough to make local reasoning expensive.
- `components/ui` currently contains only small `button.tsx` and `badge.tsx` primitives, so most visual consistency is enforced by copy-pasted classes and inline component patterns.
- Existing tests provide useful regression protection, but the largest tests are coupled to the largest components, which makes refactoring safe but slow.

---

## File Structure

### New Design Foundation

- Create: `components/reference-ui/design-tokens.js`
  - Owns extracted color, spacing, radius, shadow, typography, and status tone maps copied from current reference UI.
- Create: `components/reference-ui/primitives/badge.jsx`
  - Extracts the current `Badge` behavior and styling without changing rendered labels.
- Create: `components/reference-ui/primitives/status-pill.jsx`
  - Extracts the current `StatusPill` behavior and tone mapping.
- Create: `components/reference-ui/primitives/button.jsx`
  - Extracts the current reference UI `Button` behavior, sizes, variants, disabled/loading affordances, and class output.
- Create: `components/reference-ui/primitives/card.jsx`
  - Extracts the current `Card`, `SectionTitle`, and `KV` patterns.
- Create: `components/reference-ui/primitives/data-table.jsx`
  - Extracts the current `DataTable` with identical empty, loading, header, row, and cell behavior.
- Create: `components/reference-ui/primitives/tabs.jsx`
  - Extracts the current `Tabs` implementation.
- Create: `components/reference-ui/primitives/search-input.jsx`
  - Extracts the current `SearchInput` implementation.
- Create: `components/reference-ui/primitives/index.js`
  - Re-exports primitives for reference UI only.

### New Domain Modules

- Create: `components/reference-ui/ops/navigation.jsx`
  - Owns `NAV` and route rendering helpers currently embedded in `ops-reference.jsx`.
- Create: `components/reference-ui/ops/projects-section.jsx`
  - Owns projects list/detail presentation only.
- Create: `components/reference-ui/ops/live-section.jsx`
  - Owns live tasks and reports presentation only.
- Create: `components/reference-ui/ops/settlement-section.jsx`
  - Owns settlement batches, settlement detail, and settlement pool UI only.
- Create: `components/reference-ui/ops/organization-section.jsx`
  - Owns organization members, permissions, and organization settings UI only.

### Tests

- Create: `components/reference-ui/primitives/reference-primitives.test.jsx`
  - Locks extracted primitive output against existing visible behavior.
- Create: `components/reference-ui/ops/settlement-section.test.jsx`
  - Locks settlement UI behavior after extraction.
- Modify: `components/reference-ui/ops-reference.test.jsx`
  - Keep existing smoke tests, then move only the tests that directly target extracted modules after those modules exist.
- Modify: `components/reference-ui/ops-reference-org-members.test.jsx`
  - Keep organization member behavior coverage and later point focused cases at `organization-section.jsx`.

---

## Phase 0: Guardrails Before Extraction

### Task 1: Add A Reference UI Stability Harness

**Files:**

- Create: `components/reference-ui/reference-ui-stability.test.jsx`
- Modify: none

- [ ] **Step 1: Add route-level smoke snapshots for critical entry states**

Create `components/reference-ui/reference-ui-stability.test.jsx`:

```jsx
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import OpsReferenceApp from "./ops-reference";
import StreamerDesktopReferenceApp from "./streamer-desktop-reference";
import StreamerMobileReferenceApp from "./streamer-mobile-reference";

describe("reference UI stability", () => {
  it("keeps ops project navigation entry stable", () => {
    render(<OpsReferenceApp initialRoute="projects" projectCards={[]} />);

    expect(screen.getByText("项目")).toBeInTheDocument();
    expect(screen.getByText("暂无项目")).toBeInTheDocument();
  });

  it("keeps ops settlement navigation entry stable", () => {
    render(<OpsReferenceApp initialRoute="settlement" liveBatches={[]} />);

    expect(screen.getByText("结算")).toBeInTheDocument();
  });

  it("keeps streamer desktop entry stable", () => {
    render(<StreamerDesktopReferenceApp />);

    expect(screen.getByText("主播工作台")).toBeInTheDocument();
  });

  it("keeps streamer mobile task entry stable", () => {
    render(<StreamerMobileReferenceApp initialRoute="tasks" />);

    expect(screen.getByText("任务")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the stability test**

Run:

```powershell
pnpm exec vitest run "components/reference-ui/reference-ui-stability.test.jsx"
```

Expected: pass before any refactor. If text differs because the current UI uses mojibake output in tests, update assertions to match the current rendered output exactly instead of changing UI copy.

- [ ] **Step 3: Commit the guardrail**

Run:

```powershell
git add components/reference-ui/reference-ui-stability.test.jsx
git commit -m "test: lock reference ui stability"
```

---

## Phase 1: Extract Design Tokens Without Changing Components

### Task 2: Move Shared Tone Maps And Visual Constants

**Files:**

- Create: `components/reference-ui/design-tokens.js`
- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/streamer-desktop-reference.jsx`
- Modify: `components/reference-ui/streamer-mobile-reference.jsx`
- Test: `components/reference-ui/reference-ui-stability.test.jsx`

- [ ] **Step 1: Create token module by copying existing values**

Create `components/reference-ui/design-tokens.js`:

```js
export const referenceRadius = {
  card: 8,
  control: 6,
  pill: 999,
};

export const referenceShadows = {
  card: "0 1px 2px rgba(15, 23, 42, 0.06)",
  modal: "0 20px 40px rgba(15, 23, 42, 0.18)",
};

export const referenceToneClasses = {
  neutral: "bg-slate-100 text-slate-700 border-slate-200",
  blue: "bg-blue-50 text-blue-700 border-blue-200",
  green: "bg-emerald-50 text-emerald-700 border-emerald-200",
  yellow: "bg-amber-50 text-amber-700 border-amber-200",
  red: "bg-red-50 text-red-700 border-red-200",
};

export const referenceStatusText = {
  generated: "已生成",
  locked: "已锁定",
  paid: "已支付",
  reopened: "已重开",
};
```

- [ ] **Step 2: Replace duplicated local maps one at a time**

In `components/reference-ui/ops-reference.jsx`, import:

```js
import {
  referenceRadius,
  referenceShadows,
  referenceStatusText,
  referenceToneClasses,
} from "./design-tokens";
```

Replace only identical local constants. If a local constant is not byte-for-byte equivalent in behavior, leave it in place for a later task.

- [ ] **Step 3: Run focused reference UI tests**

Run:

```powershell
pnpm exec vitest run "components/reference-ui/ops-reference.test.jsx" "components/reference-ui/reference-ui-stability.test.jsx"
```

Expected: all pass.

- [ ] **Step 4: Commit token extraction**

Run:

```powershell
git add components/reference-ui/design-tokens.js components/reference-ui/ops-reference.jsx components/reference-ui/reference-ui-stability.test.jsx
git commit -m "refactor: extract reference ui design tokens"
```

---

## Phase 2: Extract Primitive Components

### Task 3: Extract Badge And StatusPill

**Files:**

- Create: `components/reference-ui/primitives/badge.jsx`
- Create: `components/reference-ui/primitives/status-pill.jsx`
- Create: `components/reference-ui/primitives/index.js`
- Create: `components/reference-ui/primitives/reference-primitives.test.jsx`
- Modify: `components/reference-ui/ops-reference.jsx`

- [ ] **Step 1: Write primitive behavior tests**

Create `components/reference-ui/primitives/reference-primitives.test.jsx`:

```jsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Badge, StatusPill } from "./index";

describe("reference primitives", () => {
  it("renders badge text with current tone classes", () => {
    render(<Badge tone="green">正常</Badge>);

    expect(screen.getByText("正常")).toHaveClass("bg-emerald-50");
  });

  it("renders status pill without changing status text", () => {
    render(<StatusPill tone="red">异常</StatusPill>);

    expect(screen.getByText("异常")).toHaveClass("text-red-700");
  });
});
```

- [ ] **Step 2: Copy existing Badge implementation**

Create `components/reference-ui/primitives/badge.jsx` by moving the current `Badge` function from `ops-reference.jsx` without changing its props, classes, or fallback tone behavior.

- [ ] **Step 3: Copy existing StatusPill implementation**

Create `components/reference-ui/primitives/status-pill.jsx` by moving the current `StatusPill` function from `ops-reference.jsx` without changing its props, classes, or fallback tone behavior.

- [ ] **Step 4: Export primitives**

Create `components/reference-ui/primitives/index.js`:

```js
export { Badge } from "./badge";
export { StatusPill } from "./status-pill";
```

- [ ] **Step 5: Replace local definitions with imports**

In `components/reference-ui/ops-reference.jsx`, remove the local `Badge` and `StatusPill` definitions and import:

```js
import { Badge, StatusPill } from "./primitives";
```

- [ ] **Step 6: Run tests**

Run:

```powershell
pnpm exec vitest run "components/reference-ui/primitives/reference-primitives.test.jsx" "components/reference-ui/ops-reference.test.jsx" "components/reference-ui/reference-ui-stability.test.jsx"
```

Expected: all pass.

- [ ] **Step 7: Commit primitive extraction**

Run:

```powershell
git add components/reference-ui/primitives components/reference-ui/ops-reference.jsx components/reference-ui/reference-ui-stability.test.jsx
git commit -m "refactor: extract reference ui badges"
```

### Task 4: Extract Button, Card, DataTable, Tabs, And SearchInput

**Files:**

- Create: `components/reference-ui/primitives/button.jsx`
- Create: `components/reference-ui/primitives/card.jsx`
- Create: `components/reference-ui/primitives/data-table.jsx`
- Create: `components/reference-ui/primitives/tabs.jsx`
- Create: `components/reference-ui/primitives/search-input.jsx`
- Modify: `components/reference-ui/primitives/index.js`
- Modify: `components/reference-ui/primitives/reference-primitives.test.jsx`
- Modify: `components/reference-ui/ops-reference.jsx`

- [ ] **Step 1: Add primitive tests before extraction**

Append to `components/reference-ui/primitives/reference-primitives.test.jsx`:

```jsx
import { Button, Card, DataTable, SearchInput, Tabs } from "./index";

it("renders button children and disabled state unchanged", () => {
  render(<Button disabled>保存</Button>);

  expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
});

it("renders card title and content unchanged", () => {
  render(<Card title="标题">内容</Card>);

  expect(screen.getByText("标题")).toBeInTheDocument();
  expect(screen.getByText("内容")).toBeInTheDocument();
});

it("renders data table empty text unchanged", () => {
  render(<DataTable columns={[{ key: "name", title: "名称" }]} rows={[]} />);

  expect(screen.getByText("暂无数据")).toBeInTheDocument();
});

it("renders tabs and calls selection handler", async () => {
  const onChange = vi.fn();
  render(
    <Tabs
      value="a"
      onChange={onChange}
      items={[
        { key: "a", label: "A" },
        { key: "b", label: "B" },
      ]}
    />,
  );

  await userEvent.click(screen.getByRole("button", { name: "B" }));
  expect(onChange).toHaveBeenCalledWith("b");
});

it("renders search input placeholder unchanged", () => {
  render(<SearchInput placeholder="搜索项目" value="" onChange={() => {}} />);

  expect(screen.getByPlaceholderText("搜索项目")).toBeInTheDocument();
});
```

- [ ] **Step 2: Move each primitive one at a time**

Move exactly one local implementation at a time from `components/reference-ui/ops-reference.jsx` into its matching primitive file. After each move, import it from `./primitives` and run:

```powershell
pnpm exec vitest run "components/reference-ui/primitives/reference-primitives.test.jsx" "components/reference-ui/ops-reference.test.jsx"
```

Expected: pass after each primitive.

- [ ] **Step 3: Commit primitives as one bounded change**

Run:

```powershell
git add components/reference-ui/primitives components/reference-ui/ops-reference.jsx
git commit -m "refactor: extract reference ui primitives"
```

---

## Phase 3: Split OpsReferenceApp By Domain Without Behavior Changes

### Task 5: Extract Navigation And Route Metadata

**Files:**

- Create: `components/reference-ui/ops/navigation.jsx`
- Modify: `components/reference-ui/ops-reference.jsx`
- Test: `components/reference-ui/ops-reference.test.jsx`

- [ ] **Step 1: Copy `NAV` and navigation helpers**

Create `components/reference-ui/ops/navigation.jsx`:

```jsx
export const NAV = [
  // Copy the current NAV array from ops-reference.jsx exactly.
];

export function findNavItem(routeKey) {
  return NAV.find((item) => item.route === routeKey) ?? NAV[0];
}
```

Replace the placeholder comment with the exact current `NAV` array. Do not rename keys.

- [ ] **Step 2: Import navigation from the new file**

In `components/reference-ui/ops-reference.jsx`, replace the local `NAV` declaration with:

```js
import { NAV, findNavItem } from "./ops/navigation";
```

- [ ] **Step 3: Run route smoke tests**

Run:

```powershell
pnpm exec vitest run "components/reference-ui/ops-reference.test.jsx" "components/reference-ui/reference-ui-stability.test.jsx"
```

Expected: all route smoke tests pass.

- [ ] **Step 4: Commit navigation extraction**

Run:

```powershell
git add components/reference-ui/ops/navigation.jsx components/reference-ui/ops-reference.jsx
git commit -m "refactor: extract ops reference navigation"
```

### Task 6: Extract Settlement Section First

**Files:**

- Create: `components/reference-ui/ops/settlement-section.jsx`
- Create: `components/reference-ui/ops/settlement-section.test.jsx`
- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`

- [ ] **Step 1: Add focused settlement section test**

Create `components/reference-ui/ops/settlement-section.test.jsx`:

```jsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SettlementSection } from "./settlement-section";

describe("SettlementSection", () => {
  it("renders existing settlement empty state", () => {
    render(
      <SettlementSection
        liveBatches={[]}
        liveBatchDetails={{}}
        liveSettlementPool={[]}
        settlementScope={null}
      />,
    );

    expect(screen.getByText("结算")).toBeInTheDocument();
  });
});
```

If the current rendered text differs, update the assertion to the exact current text instead of changing the UI.

- [ ] **Step 2: Move only settlement rendering code**

Create `components/reference-ui/ops/settlement-section.jsx` by moving the current settlement rendering functions and their directly required helpers from `ops-reference.jsx`.

Export:

```jsx
export function SettlementSection({
  liveBatches,
  liveBatchDetails,
  liveSettlementPool,
  settlementScope,
  onGenerateBatch,
  onLockBatch,
  onReopenBatch,
  onAddManualItem,
}) {
  // Current settlement JSX moved here exactly.
}
```

- [ ] **Step 3: Pass existing props from OpsReferenceApp**

In `components/reference-ui/ops-reference.jsx`, replace only the settlement branch with:

```jsx
<SettlementSection
  liveBatches={liveBatches}
  liveBatchDetails={liveBatchDetails}
  liveSettlementPool={liveSettlementPool}
  settlementScope={settlementScope}
  onGenerateBatch={handleGenerateBatch}
  onLockBatch={handleLockBatch}
  onReopenBatch={handleReopenBatch}
  onAddManualItem={handleAddManualItem}
/>
```

Use the exact current handler names. If names differ, keep the current names and do not introduce adapters.

- [ ] **Step 4: Run settlement tests**

Run:

```powershell
pnpm exec vitest run "components/reference-ui/ops/settlement-section.test.jsx" "components/reference-ui/ops-reference.test.jsx"
```

Expected: all pass.

- [ ] **Step 5: Commit settlement extraction**

Run:

```powershell
git add components/reference-ui/ops/settlement-section.jsx components/reference-ui/ops/settlement-section.test.jsx components/reference-ui/ops-reference.jsx components/reference-ui/ops-reference.test.jsx
git commit -m "refactor: extract ops settlement ui section"
```

### Task 7: Extract Live, Projects, And Organization Sections

**Files:**

- Create: `components/reference-ui/ops/live-section.jsx`
- Create: `components/reference-ui/ops/projects-section.jsx`
- Create: `components/reference-ui/ops/organization-section.jsx`
- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: existing focused tests

- [ ] **Step 1: Extract one section per commit**

For each section, repeat the Task 6 pattern:

```powershell
pnpm exec vitest run "components/reference-ui/ops-reference.test.jsx" "components/reference-ui/ops-reference-org-members.test.jsx" "components/reference-ui/reference-ui-stability.test.jsx"
```

Expected: pass after each section.

- [ ] **Step 2: Commit each section separately**

Run after each section:

```powershell
git add components/reference-ui/ops components/reference-ui/ops-reference.jsx components/reference-ui/*.test.jsx
git commit -m "refactor: extract ops <domain> ui section"
```

Use one of:

- `refactor: extract ops live ui section`
- `refactor: extract ops projects ui section`
- `refactor: extract ops organization ui section`

---

## Phase 4: Apply The Same Pattern To Streamer UIs

### Task 8: Extract Streamer Mobile And Desktop Primitives

**Files:**

- Create: `components/reference-ui/streamer/mobile-shell.jsx`
- Create: `components/reference-ui/streamer/mobile-task-section.jsx`
- Create: `components/reference-ui/streamer/desktop-shell.jsx`
- Create: `components/reference-ui/streamer/desktop-task-section.jsx`
- Modify: `components/reference-ui/streamer-mobile-reference.jsx`
- Modify: `components/reference-ui/streamer-desktop-reference.jsx`
- Test: existing streamer reference tests

- [ ] **Step 1: Extract shells only**

Move only repeated page chrome, navigation, and layout wrappers into shell files. Do not move task or recording logic in the same commit.

- [ ] **Step 2: Run streamer tests**

Run:

```powershell
pnpm exec vitest run "components/reference-ui/streamer-mobile-reference.test.jsx" "components/reference-ui/streamer-desktop-reference.test.jsx"
```

Expected: pass.

- [ ] **Step 3: Extract task sections**

Move task-list rendering into `mobile-task-section.jsx` and `desktop-task-section.jsx`, preserving prop names and event handlers.

- [ ] **Step 4: Run full reference UI tests**

Run:

```powershell
pnpm exec vitest run components/reference-ui
```

Expected: all reference UI tests pass.

- [ ] **Step 5: Commit streamer extraction**

Run:

```powershell
git add components/reference-ui
git commit -m "refactor: extract streamer reference ui sections"
```

---

## Phase 5: Design Consistency Guardrails

### Task 9: Add A Lightweight Design Consistency Check

**Files:**

- Create: `scripts/check-reference-ui-size.mjs`
- Modify: `package.json`

- [ ] **Step 1: Create size budget script**

Create `scripts/check-reference-ui-size.mjs`:

```js
import { readFileSync } from "node:fs";

const budgets = [
  ["components/reference-ui/ops-reference.jsx", 12000],
  ["components/reference-ui/streamer-mobile-reference.jsx", 4500],
  ["components/reference-ui/streamer-desktop-reference.jsx", 4500],
];

let failed = false;

for (const [file, maxLines] of budgets) {
  const lineCount = readFileSync(file, "utf8").split("\n").length;
  if (lineCount > maxLines) {
    failed = true;
    console.error(`${file} has ${lineCount} lines; budget is ${maxLines}.`);
  }
}

if (failed) {
  process.exit(1);
}
```

- [ ] **Step 2: Add script**

In `package.json`, add:

```json
"check:reference-ui-size": "node scripts/check-reference-ui-size.mjs"
```

- [ ] **Step 3: Run size check**

Run:

```powershell
pnpm check:reference-ui-size
```

Expected: pass only after enough extraction has reduced file sizes below the budgets. Do not add this script to CI until it passes.

- [ ] **Step 4: Commit guardrail**

Run:

```powershell
git add scripts/check-reference-ui-size.mjs package.json
git commit -m "chore: add reference ui size budget"
```

---

## Final Verification

Run:

```powershell
git diff --check
pnpm exec prettier --check components/reference-ui
pnpm type-check
pnpm lint
pnpm test
pnpm build
```

Expected:

- No whitespace or conflict marker issues.
- Touched reference UI files pass Prettier.
- Type check passes.
- Lint exits 0. The known Babel deopt note for `components/reference-ui/ops-reference.jsx` is acceptable if exit code is 0.
- Tests pass.
- Build passes.

---

## Rollout Order

1. Phase 0 and Phase 1 first. These reduce risk without moving much code.
2. Phase 2 next. Primitive extraction improves design consistency fastest.
3. Phase 3 after primitives stabilize. Start with settlement because it is a bounded business area.
4. Phase 4 after ops extraction pattern is proven.
5. Phase 5 only after file sizes are below budgets.

---

## Success Metrics

- `components/reference-ui/ops-reference.jsx` reduced from about 19,906 lines to under 12,000 in the first pass.
- Shared primitives live outside the giant app file.
- New UI changes use `components/reference-ui/primitives` instead of defining local variants.
- Existing user-visible layout and interactions remain unchanged.
- Full verification chain remains green.
