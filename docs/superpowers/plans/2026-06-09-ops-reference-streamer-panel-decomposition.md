# Ops Reference Streamer Panel Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce `components/reference-ui/ops-reference.jsx` maintenance risk by extracting streamer profile editing code without changing runtime behavior.

**Architecture:** Extract pure draft helpers first, then extract the profile edit form behind prop-based dependencies. Keep the parent `StreamerPanel` responsible for data ownership and submission side effects.

**Tech Stack:** React, Vitest, Testing Library, existing reference UI components.

---

## File Structure

- Create `components/reference-ui/ops-streamer-profile-utils.js`
  - Owns `streamerProfileDraftFromCard`, `streamerSourceValue`, `editableListText`, `splitDraftList`, `draftNumber`, and `draftPercentToBps`.
- Create `components/reference-ui/ops-streamer-profile-utils.test.js`
  - Covers source mapping, list parsing, money number parsing, and percent-to-bps conversion.
- Modify `components/reference-ui/ops-reference.jsx`
  - Imports the extracted helper functions.
  - Keeps `StreamerPanel` state ownership unchanged.
- Create `components/reference-ui/OpsStreamerProfileForm.jsx`
  - Renders the profile-edit form.
  - Accepts `draft`, `error`, `submitting`, `onDraftChange`, `onSubmit`, and `onCancel` props.
- Modify `components/reference-ui/ops-reference.test.jsx`
  - Keep existing integration coverage for edit profile submission.
  - Add a narrow render test for the extracted form only if integration coverage becomes brittle.

---

### Task 1: Extract Pure Profile Helpers

**Files:**

- Create: `components/reference-ui/ops-streamer-profile-utils.js`
- Create: `components/reference-ui/ops-streamer-profile-utils.test.js`
- Modify: `components/reference-ui/ops-reference.jsx`

- [ ] **Step 1: Write failing utility tests**

```js
import {
  draftNumber,
  draftPercentToBps,
  editableListText,
  splitDraftList,
  streamerSourceValue,
} from "./ops-streamer-profile-utils";

test("maps streamer source labels to API values", () => {
  expect(streamerSourceValue("签约")).toBe("signed");
  expect(streamerSourceValue("supplier_recommended")).toBe(
    "supplier_recommended",
  );
  expect(streamerSourceValue("未知来源")).toBe("external");
});

test("round-trips editable list text", () => {
  expect(editableListText(["RPG", "", "未填写", "Card"])).toBe("RPG, Card");
  expect(splitDraftList("RPG, Card\nSLG")).toEqual(["RPG", "Card", "SLG"]);
});

test("normalizes money and CPS percent draft values", () => {
  expect(draftNumber("10.5")).toBe(10.5);
  expect(draftNumber(" ")).toBe(0);
  expect(draftPercentToBps("12.5")).toBe(1250);
});
```

- [ ] **Step 2: Verify tests fail**

Run:

```powershell
pnpm exec vitest run "components/reference-ui/ops-streamer-profile-utils.test.js"
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Move helpers without changing logic**

Move the exact helper implementations from `ops-reference.jsx` into `ops-streamer-profile-utils.js` and export them.

- [ ] **Step 4: Import helpers in `ops-reference.jsx`**

Replace local helper definitions with imports from `./ops-streamer-profile-utils`.

- [ ] **Step 5: Verify helper and integration tests**

Run:

```powershell
pnpm exec vitest run "components/reference-ui/ops-streamer-profile-utils.test.js" "components/reference-ui/ops-reference.test.jsx"
```

Expected: PASS.

---

### Task 2: Extract The Profile Edit Form

**Files:**

- Create: `components/reference-ui/OpsStreamerProfileForm.jsx`
- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`

- [ ] **Step 1: Add an integration guard before extraction**

Run:

```powershell
pnpm exec vitest run "components/reference-ui/ops-reference.test.jsx" -t "updates streamer profile"
```

Expected: PASS before refactor starts.

- [ ] **Step 2: Extract only presentational form JSX**

Move the `profileOpen ? <Card title="编辑主播档案" ...>` block into `OpsStreamerProfileForm.jsx`. The new component receives all state and callbacks from `StreamerPanel`; it must not fetch, mutate global state, or own business logic.

- [ ] **Step 3: Wire extracted form in `StreamerPanel`**

Render:

```jsx
{
  profileOpen ? (
    <OpsStreamerProfileForm
      draft={profileDraft}
      error={profileError}
      submitting={profileSubmitting}
      onDraftChange={updateProfileDraft}
      onSubmit={submitProfileUpdate}
      onCancel={closeProfileForm}
    />
  ) : null;
}
```

- [ ] **Step 4: Verify no behavior changed**

Run:

```powershell
pnpm exec vitest run "components/reference-ui/ops-reference.test.jsx"
pnpm lint
```

Expected: PASS. The known Babel deopt note may still appear until more of the file is split.

---

## Self-Review

This follow-up plan intentionally excludes API, service, and settlement changes. Its only purpose is to reduce `ops-reference.jsx` size after the upgrade-hardening work has already landed and passed the full quality gate.
