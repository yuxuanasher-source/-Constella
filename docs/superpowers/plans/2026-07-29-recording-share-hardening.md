# Recording Share Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the admission recording share route load the authoritative original upload, protect access codes without URL leakage, expose only required public data, recover cleanly from failures, and remain polished on desktop and mobile.

**Architecture:** Keep the existing project-first admission/share-board state machine. Add a narrow public-access session and database-backed attempt limiter around the current token gate, make the public DTO an explicit whitelist, and harden the existing React page rather than introducing a second vendor portal.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase/PostgreSQL, Vitest, Testing Library, Tailwind CSS.

---

## File map

- `features/applications/admission-share-board.ts`: authoritative source selection, public DTO whitelist, typed public-share errors, access-code hashing/verification and authentication service.
- `features/applications/admission-share-board.test.ts`: service regression tests.
- `features/applications/admission-share-access-store.ts`: Supabase adapter for access-attempt limiting and opaque access sessions.
- `lib/http/admission-share-access-session.ts`: token-scoped HttpOnly Cookie read/write helpers.
- `app/api/public/admission-share/public-route-utils.ts`: public error serialization and access-code extraction.
- `app/api/public/admission-share/[token]/access/route.ts`: access-code exchange endpoint.
- `app/api/public/admission-share/[token]/{route,reviews/route,recordings/.../route}.ts`: Cookie-based gate and sanitized errors.
- `app/share/admission/[token]/{page,admission-share-page-client}.tsx`: access prompt, retry, progress, localization, media fallback and touch sizing.
- `supabase/migrations/20260729193000_admission_share_access_rate_limit.sql`: persistent, atomic limiter.
- `lib/db/admission-share-access-rate-limit-contract.test.ts`: migration contract.

### Task 1: Lock authoritative media and public DTO privacy

**Files:**
- Modify: `features/applications/admission-share-board.test.ts`
- Modify: `features/applications/admission-share-board.ts`
- Modify: `app/api/public/admission-share/[token]/route.test.ts`

- [ ] **Step 1: Write failing service tests**

Add a snapshot item with both sources and assert:

```ts
expect(dto.items[0]).toMatchObject({
  recordingUrl: "https://video.example/external.mp4",
  playbackUrl:
    "/api/public/admission-share/plain-token/recordings/rec-both?accessCode=2468",
  hasPrivateStorage: true,
});
expect(dto.items[0].vendorReview).toEqual({
  decision: "backup",
  remark: "可作为备选。",
  submittedAt: "2026-07-29T10:00:00.000Z",
});
```

Also assert serialized public output does not contain `reviewerName` or `reviewerContact`.

- [ ] **Step 2: Verify RED**

Run:

```powershell
corepack pnpm vitest run features/applications/admission-share-board.test.ts app/api/public/admission-share/[token]/route.test.ts
```

Expected: failure because `playbackUrl` is the external URL, `hasPrivateStorage` is false, and reviewer identity is present.

- [ ] **Step 3: Implement the minimum DTO change**

Use private storage as the playback authority:

```ts
playbackUrl: item.storagePath
  ? publicAdmissionRecordingPlaybackUrl({
      token: input.token,
      accessCode: input.accessCode,
      recordingSubmissionId: item.recordingSubmissionId,
    })
  : item.recordingUrl,
hasPrivateStorage: Boolean(item.storagePath),
vendorReview: item.vendorReview
  ? {
      decision: item.vendorReview.decision,
      remark: item.vendorReview.remark,
      submittedAt: item.vendorReview.submittedAt,
    }
  : null,
```

- [ ] **Step 4: Verify GREEN**

Run the Task 1 command and expect both files to pass.

- [ ] **Step 5: Commit**

```powershell
git add -- features/applications/admission-share-board.ts features/applications/admission-share-board.test.ts app/api/public/admission-share/[token]/route.test.ts
git commit -m "fix: prefer original recordings in public shares"
```

### Task 2: Harden access-code storage and share creation constraints

**Files:**
- Modify: `features/applications/admission-share-board.test.ts`
- Modify: `features/applications/admission-share-board.ts`
- Modify: `app/api/projects/[projectId]/admission-share-boards/route.test.ts`

- [ ] **Step 1: Write failing hashing and validation tests**

Cover:

```ts
const first = hashAdmissionShareAccessCode("246810");
const second = hashAdmissionShareAccessCode("246810");
expect(first).toMatch(/^scrypt\$[a-f0-9]+\$[a-f0-9]+$/);
expect(first).not.toBe(second);
expect(verifyAdmissionShareAccessCode("246810", first)).toBe(true);
expect(verifyAdmissionShareAccessCode("wrong", first)).toBe(false);
expect(
  verifyAdmissionShareAccessCode("2468", hashShareSecret("2468")),
).toBe(true);
```

Add create-board cases that reject access codes shorter than six characters, expiries in the past, and expiries more than 30 days away.

- [ ] **Step 2: Verify RED**

Run:

```powershell
corepack pnpm vitest run features/applications/admission-share-board.test.ts app/api/projects/[projectId]/admission-share-boards/route.test.ts
```

Expected: missing hashing functions and validation failures.

- [ ] **Step 3: Implement salted hashing and bounded inputs**

Use `scryptSync`, `randomBytes`, and `timingSafeEqual`, while retaining legacy SHA-256 verification:

```ts
export function hashAdmissionShareAccessCode(value: string) {
  const salt = randomBytes(16).toString("hex");
  const digest = scryptSync(value, salt, 32).toString("hex");
  return `scrypt$${salt}$${digest}`;
}
```

Validate trimmed access codes at 6–64 characters and expiry in `(now, now + 30 days]`.

- [ ] **Step 4: Verify GREEN**

Run the Task 2 command and expect both files to pass.

- [ ] **Step 5: Commit**

```powershell
git add -- features/applications/admission-share-board.ts features/applications/admission-share-board.test.ts app/api/projects/[projectId]/admission-share-boards/route.test.ts
git commit -m "fix: harden admission share access codes"
```

### Task 3: Add persistent access-attempt limiting and opaque sessions

**Files:**
- Create: `supabase/migrations/20260729193000_admission_share_access_rate_limit.sql`
- Create: `lib/db/admission-share-access-rate-limit-contract.test.ts`
- Create: `features/applications/admission-share-access-store.ts`
- Create: `features/applications/admission-share-access-store.test.ts`

- [ ] **Step 1: Write failing schema and adapter tests**

The schema contract must assert the migration contains:

```ts
expect(sql).toContain("project_recording_share_access_attempts");
expect(sql).toContain("consume_admission_share_access_attempt");
expect(sql).toContain("security definer");
expect(sql).toContain("revoke all");
```

The adapter test must assert `.rpc("consume_admission_share_access_attempt", ...)` maps `{ allowed, retry_after_seconds }`, and that session creation/lookup hashes the opaque token before persistence.

- [ ] **Step 2: Verify RED**

Run:

```powershell
corepack pnpm vitest run lib/db/admission-share-access-rate-limit-contract.test.ts features/applications/admission-share-access-store.test.ts
```

Expected: missing migration and adapter.

- [ ] **Step 3: Implement migration and adapter**

Create an attempts table keyed by `(share_board_id, client_fingerprint)`, a session table containing only `session_token_hash`, and an atomic security-definer function with:

```sql
p_window_seconds integer default 900,
p_max_failures integer default 5,
p_block_seconds integer default 900
```

The function must support `p_succeeded is null` as a read-only block check, increment failures atomically, block at the threshold, and reset on success. Session rows must expire no later than the share board. Revoke both tables and the function from `public`, `anon`, and `authenticated`; grant function execution only to `service_role`.

- [ ] **Step 4: Verify GREEN**

Run the Task 3 command and expect both files to pass.

- [ ] **Step 5: Commit**

```powershell
git add -- supabase/migrations/20260729193000_admission_share_access_rate_limit.sql lib/db/admission-share-access-rate-limit-contract.test.ts features/applications/admission-share-access-store.ts features/applications/admission-share-access-store.test.ts
git commit -m "feat: rate limit admission share access"
```

### Task 4: Exchange access codes for a scoped HttpOnly session

**Files:**
- Create: `lib/http/admission-share-access-session.ts`
- Create: `lib/http/admission-share-access-session.test.ts`
- Create: `app/api/public/admission-share/[token]/access/route.ts`
- Create: `app/api/public/admission-share/[token]/access/route.test.ts`
- Modify: `features/applications/admission-share-board.ts`
- Modify: `features/applications/admission-share-board.test.ts`

- [ ] **Step 1: Write failing session and authentication tests**

Assert successful access returns a Cookie with:

```ts
expect(response.headers.get("set-cookie")).toContain("HttpOnly");
expect(response.headers.get("set-cookie")).toContain("SameSite=Lax");
expect(response.headers.get("set-cookie")).not.toContain("246810");
```

Assert five failed attempts produce `ACCESS_RATE_LIMITED` and successful validation resets the limiter.

- [ ] **Step 2: Verify RED**

Run:

```powershell
corepack pnpm vitest run lib/http/admission-share-access-session.test.ts app/api/public/admission-share/[token]/access/route.test.ts features/applications/admission-share-board.test.ts
```

Expected: missing route/session/authentication service.

- [ ] **Step 3: Implement authentication and Cookie helpers**

Generate a 32-byte opaque session token, persist only its SHA-256 digest, place the opaque token in a token-specific Cookie, and restrict its path to:

```ts
`/api/public/admission-share/${encodeURIComponent(token)}`
```

Set expiry to the earlier of the board expiry or seven days.

- [ ] **Step 4: Verify GREEN**

Run the Task 4 command and expect all files to pass.

- [ ] **Step 5: Commit**

```powershell
git add -- lib/http/admission-share-access-session.ts lib/http/admission-share-access-session.test.ts app/api/public/admission-share/[token]/access/route.ts app/api/public/admission-share/[token]/access/route.test.ts features/applications/admission-share-board.ts features/applications/admission-share-board.test.ts
git commit -m "feat: add scoped admission share access session"
```

### Task 5: Sanitize public route errors and remove query-string credentials

**Files:**
- Create: `app/api/public/admission-share/public-route-utils.ts`
- Create: `app/api/public/admission-share/public-route-utils.test.ts`
- Modify: `app/api/public/admission-share/[token]/route.ts`
- Modify: `app/api/public/admission-share/[token]/reviews/route.ts`
- Modify: `app/api/public/admission-share/[token]/recordings/[recordingSubmissionId]/route.ts`
- Modify: matching three route test files.

- [ ] **Step 1: Write failing public-error tests**

Assert typed errors map to stable codes/statuses and an unknown `TypeError("fetch failed")` maps to:

```ts
expect(response.status).toBe(503);
expect(await response.json()).toEqual({
  code: "SHARE_SERVICE_UNAVAILABLE",
  error: "分享服务暂时不可用，请稍后重试。",
});
```

Update read/review/playback tests to use the Cookie and assert generated playback URLs contain no `accessCode`.

- [ ] **Step 2: Verify RED**

Run:

```powershell
corepack pnpm vitest run app/api/public/admission-share/public-route-utils.test.ts app/api/public/admission-share/[token]/route.test.ts app/api/public/admission-share/[token]/reviews/route.test.ts app/api/public/admission-share/[token]/recordings/[recordingSubmissionId]/route.test.ts
```

Expected: raw errors and query-string access assertions fail.

- [ ] **Step 3: Implement shared serialization and Cookie access**

Replace `jsonError` in all public routes with the public serializer. Read access codes through `admission-share-access-session.ts`; keep query parsing only inside the page migration flow, never in media/review URLs.

- [ ] **Step 4: Verify GREEN**

Run the Task 5 command and expect all files to pass.

- [ ] **Step 5: Commit**

```powershell
git add -- app/api/public/admission-share features/applications/admission-share-board.ts lib/http/admission-share-access-session.ts
git commit -m "fix: sanitize public admission share routes"
```

### Task 6: Harden the public page UX and media behavior

**Files:**
- Modify: `app/share/admission/[token]/page.tsx`
- Modify: `app/share/admission/[token]/admission-share-page-client.tsx`
- Modify: `app/share/admission/[token]/admission-share-page-client.test.tsx`

- [ ] **Step 1: Write failing component tests**

Cover:

- access-required response renders a labeled password input and “验证并继续” button;
- successful access POST reloads the board and strips `accessCode` from browser history;
- transient service failure displays Chinese copy and “重新加载”;
- historical `backup` renders “备选”;
- dual-source item renders the protected player and a separate external link;
- video `error` event replaces the player with a recovery panel;
- YouTube watch, short, live, embed and `youtu.be` variants use the embed player;
- source links and selects include a 44px minimum touch target;
- decision progress displays `已判断 X / N`.

- [ ] **Step 2: Verify RED**

Run:

```powershell
corepack pnpm vitest run app/share/admission/[token]/admission-share-page-client.test.tsx
```

Expected: new access/retry/media/localization assertions fail.

- [ ] **Step 3: Implement the minimum page changes**

Use a dedicated `decisionLabels` map, a structured request error, an inline access form, `role="alert"`/`aria-live`, and a media error state. Remove access-code query builders from board/review/playback requests.

Use familiar product controls:

```tsx
className="inline-flex min-h-11 items-center ..."
className="min-h-11 w-full ..."
```

Keep Bilibili short links as explicit external fallbacks; do not fabricate an embed ID.

- [ ] **Step 4: Verify GREEN**

Run the Task 6 command and expect the component file to pass.

- [ ] **Step 5: Commit**

```powershell
git add -- app/share/admission/[token]/page.tsx app/share/admission/[token]/admission-share-page-client.tsx app/share/admission/[token]/admission-share-page-client.test.tsx
git commit -m "fix: harden admission share review experience"
```

### Task 7: Full verification and browser regression

**Files:**
- Modify only if verification finds an in-scope defect.

- [ ] **Step 1: Run focused regression**

```powershell
corepack pnpm vitest run features/applications/admission-share-board.test.ts features/applications/admission-share-access-store.test.ts lib/http/admission-share-access-session.test.ts lib/db/admission-share-access-rate-limit-contract.test.ts app/api/public/admission-share/public-route-utils.test.ts app/api/public/admission-share/[token]/access/route.test.ts app/api/public/admission-share/[token]/route.test.ts app/api/public/admission-share/[token]/reviews/route.test.ts app/api/public/admission-share/[token]/recordings/[recordingSubmissionId]/route.test.ts app/share/admission/[token]/admission-share-page-client.test.tsx
```

- [ ] **Step 2: Run repository gates**

```powershell
corepack pnpm test
corepack pnpm type-check
corepack pnpm lint
corepack pnpm build
git diff --check
```

Record unrelated baseline failures separately; do not claim those gates pass unless their commands exit zero.

- [ ] **Step 3: Run browser checks**

Verify at 1280×720 and 375×812:

- token-only board;
- access-code prompt and successful session;
- direct external video;
- platform embed and unsupported-link fallback;
- private original upload;
- dual-source original-first behavior;
- media failure fallback;
- no horizontal overflow;
- 44px primary touch targets;
- retry after forced 503.

- [ ] **Step 4: Review scope**

```powershell
git status --short
git diff HEAD^ --stat
git log --oneline --decorate -8
```

Confirm only the recording-share hardening slice is present.
