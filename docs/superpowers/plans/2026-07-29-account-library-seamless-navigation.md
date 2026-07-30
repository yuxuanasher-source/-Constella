# Account Library Seamless Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the account library a native, lazy-loaded ops-console scene so switching in either direction never reloads the document.

**Architecture:** A focused `AccountLibraryScreen` owns one-time lazy loading and keeps `AccountLibraryPanel` mounted after first entry. `OpsReferenceApp` owns navigation and permissions, while the legacy deep-link page preloads data into the same unified app shell.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, Testing Library

---

### Task 1: Add the lazy, persistent account-library scene

**Files:**
- Create: `components/account-library/account-library-screen.tsx`
- Create: `components/account-library/account-library-screen.test.tsx`

- [x] **Step 1: Write the failing lazy-load tests**

Cover these behaviors with Testing Library:

```tsx
const { rerender } = render(
  <AccountLibraryScreen active={false} canManage={true} />,
);
expect(fetch).not.toHaveBeenCalled();

rerender(<AccountLibraryScreen active canManage={true} />);
await screen.findByRole("heading", { name: "账号库" });
expect(fetch).toHaveBeenCalledTimes(1);

rerender(<AccountLibraryScreen active={false} canManage={true} />);
rerender(<AccountLibraryScreen active canManage={true} />);
expect(fetch).toHaveBeenCalledTimes(1);
```

Also assert that an opened create form remains visible after an inactive/active round trip and that an API error can be retried.

- [x] **Step 2: Run the test and verify RED**

Run:

```powershell
pnpm vitest run components/account-library/account-library-screen.test.tsx
```

Expected: FAIL because `account-library-screen.tsx` does not exist.

- [x] **Step 3: Implement the minimal screen**

Create a client component with this public contract:

```tsx
export function AccountLibraryScreen({
  active,
  initialAccounts,
  canManage,
}: {
  active: boolean;
  initialAccounts?: PlatformAccountDto[];
  canManage: boolean;
}) {
  // idle -> loading -> ready/error
  // fetch GET /api/account-library only after active becomes true
  // keep AccountLibraryPanel mounted inside a hidden wrapper after ready
}
```

Validate `payload.accounts` as an array, render a compact skeleton while loading, and expose a retry button on error.

- [x] **Step 4: Run the test and verify GREEN**

Run the focused test again and expect all cases to pass.

### Task 2: Move navigation and the deep link into the unified shell

**Files:**
- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`
- Modify: `app/(ops)/console/account-library/page.tsx`
- Create: `app/(ops)/console/account-library/page.test.tsx`
- Delete: `components/account-library/account-library-shell.tsx`

- [x] **Step 1: Write failing navigation and page tests**

Add a UI regression test that renders `OpsReferenceApp`, clicks the unique “账号库” side-nav button, observes the account-library heading, switches to “项目管理”, and switches back without a document navigation.

Add a page test that expects `/console/account-library` to call:

```tsx
<OpsReferenceApp
  initialRoute="account-library"
  accountLibraryAccounts={accounts}
  currentUser={currentUserFromAuth(auth)}
  organizationSettings={organizationSettingsFromAuth(auth)}
/>
```

- [x] **Step 2: Run both tests and verify RED**

Run:

```powershell
pnpm vitest run components/reference-ui/ops-reference.test.jsx app/(ops)/console/account-library/page.test.tsx
```

Expected: the navigation test cannot render the account-library scene, and the page test sees the legacy shell.

- [x] **Step 3: Implement unified routing**

In `ops-reference.jsx`:

```jsx
{ key: "account-library", label: "账号库", icon: "Settings" }
```

Remove the `href`/`window.location.assign()` branch, add account-library props through `OpsReferenceApp` and `OpsReferenceInner`, add `["资源", "账号库"]` breadcrumbs, and keep this component mounted:

```jsx
<AccountLibraryScreen
  active={route === "account-library"}
  initialAccounts={accountLibraryAccounts}
  canManage={canManageAccounts(currentUserState?.role)}
/>
```

In the deep-link page, use `requireConsoleStaffAuth()`, preload accounts, and render `OpsReferenceApp` with `initialRoute="account-library"`. Delete the unused legacy shell.

- [x] **Step 4: Run both tests and verify GREEN**

Re-run the focused tests and expect all cases to pass without the jsdom document-navigation warning.

### Task 3: Verify, commit, land, and deploy

**Files:**
- All files changed by Tasks 1-2

- [x] **Step 1: Run scoped and broad verification**

```powershell
git diff --check
pnpm vitest run components/account-library/account-library-screen.test.tsx app/(ops)/console/account-library/page.test.tsx components/reference-ui/ops-reference.test.jsx
pnpm type-check
pnpm lint
pnpm build
```

- [x] **Step 2: Audit the exact commit scope**

```powershell
git status --short
git diff --stat
git diff --name-status
```

Stage only the two docs, the account-library screen/tests, the ops-reference route/tests, the deep-link page/test, and the legacy shell deletion. Confirm `git diff --cached --name-status` contains nothing else.

- [ ] **Step 3: Commit and push**

Commit with:

```powershell
git commit -m "fix: unify account library navigation"
git push -u origin codex/account-library-seamless-navigation
```

- [ ] **Step 4: Merge into the real production branch**

Create a PR targeting `codex/full-project-ui`, wait for required checks, merge without force-push, and verify the merge commit contains only the audited files.

- [ ] **Step 5: Deploy and verify**

Use the repository’s production deployment path for `codex/full-project-ui`. Confirm the server pulled the merge commit, completed the build/restart, and returns a healthy `/api/health`; then verify the account-library navigation on the live site if authenticated access is available.
