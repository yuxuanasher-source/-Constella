# 2026-06-03 UI And Business Closure Gap Inventory

## Audit Method

- Reviewed route ownership in `features/ui-route-contracts/module-route-map.ts`.
- Compared `components/reference-ui/*` buttons, `onClick` handlers, static fallback arrays, and API bindings.
- Ran current focused checks:
  - `pnpm type-check`
  - `pnpm test:ui-smoke`
  - `pnpm vitest run features/ui-route-contracts/module-route-map.test.ts components/reference-ui/ops-reference.test.jsx components/reference-ui/streamer-mobile-reference.test.jsx`
- Used `docs/superpowers/plans/2026-06-02-qa-gap-closure-development-plan.md` as the current repair plan baseline.

## Current Closure Status

| Area                            | Status                   | Evidence                                                                                        | Remaining gap                                                                                                                   |
| ------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| M1 Project management           | Partial                  | Real project cards, draft creation, and draft publish are wired.                                | Filters, export, project settings, vendor delivery package, new schedule button, and broader status transitions remain UI-only. |
| M2 Streamer pool                | Partial                  | Real streamer rows can be injected from backend DTOs.                                           | New streamer profile, import, export, filters, risk update, and invite action buttons are not wired in the current UI shell.    |
| M3 Admission                    | Mostly live              | Queue display, recording review actions, confirm join, and streamer recording upload are wired. | Some secondary buttons such as filters and bulk actions remain presentation only.                                               |
| M4 Live tasks                   | Live for core flow       | Ops create/batch/cancel and streamer start/stop/report are covered by UI smoke.                 | Secondary calendar/filter/export/edit buttons remain UI-only.                                                                   |
| M5 Report review                | Live for core flow       | Report approve/reject/needs-changes actions call APIs and refresh state.                        | Bulk approval, export detail, date/project filters remain UI-only.                                                              |
| M6 Settlement                   | Live for core flow       | Create batch, manual item, lock, reopen are covered.                                            | Save draft, export PDF, audit navigation, and some preview actions remain UI-only.                                              |
| M7 Audit                        | Live read view           | Audit list and refresh are wired.                                                               | Invite/config/member editing controls in M0/M7-adjacent org screen are not wired.                                               |
| M8 Export                       | Live for governed export | Generate export calls `/api/exports`.                                                           | Export buttons scattered in other modules do not route to or prefill M8.                                                        |
| M9 Notifications                | Live                     | Notification status update and refresh are wired.                                               | Layout shell bell button only displays count; it does not open notification center.                                             |
| M10 War room                    | Partial/UI-only          | Pricing/matching/project-review APIs exist and are tested.                                      | ScreenWarRoom still uses static calculations/lists and buttons do not call `/api/war-room/*`.                                   |
| M11 Billing                     | Broken UI route          | Route map points M11 to `billing`; `/api/billing/status` exists.                                | `OpsReferenceApp` has no `billing` render branch, no billing status screen, and no write-route billing guard applied.           |
| Streamer mobile `/m/tasks`      | Live for core flow       | Start, stop, submit report are wired.                                                           | Report screenshot still uses a demo path instead of signed upload.                                                              |
| Streamer mobile `/m/recordings` | Live for upload          | Signed recording upload and application video submit are wired.                                 | "我的" page links to recording and settlement are empty handlers.                                                               |
| Streamer mobile `/m/diagnosis`  | Partial                  | AI chat UI has local responses.                                                                 | Diagnosis UI does not call `/api/ai/diagnosis`.                                                                                 |
| Streamer mobile `/m/me`         | Partial                  | Earnings summary can be injected from safe settlement query.                                    | Recording library, settlement bill, account binding, privacy, and operation log rows use `onClick={() => {}}`.                  |
| Streamer desktop `/desktop`     | UI-only                  | Desktop shell renders static `MY_TASKS`, `MY_VIDEOS`, `ME`.                                     | No server data props, no task/report/upload API actions, and many buttons have no handlers.                                     |

## Buttons With No Effective Business Action

### Highest Priority

- `components/reference-ui/ops-reference.jsx`: M10 buttons "导出当日简报", "立项 / 报价测算", "查看完整复盘", "历史简报", "处理", "导出厂家候选包", "查看画像", "发起邀约", "保存为草稿", "生成立项申请" are not connected to the existing war-room APIs.
- `components/reference-ui/ops-reference.jsx`: M11 route has no visible screen at all because `route === "billing"` is never rendered.
- `components/reference-ui/streamer-mobile-reference.jsx`: "AI 卡点诊断" navigates locally, but diagnosis still does not call the backend diagnosis API.
- `components/reference-ui/streamer-mobile-reference.jsx`: Task report screenshot submission should keep using signed private upload and must not fall back to hard-coded local paths.
- `components/reference-ui/streamer-desktop-reference.jsx`: `/desktop` uses static tasks, videos, profile, and earnings; task/report/upload buttons are not business actions.

### Medium Priority

- M1 project list/detail: "导出项目", "厂商", "负责人", "时间范围", "厂家交付包", "项目设置", "新建排班" are UI-only or local-only.
- M2 streamer pool: "导出主播表", "批量导入", "新增主播档案", "游戏品类", "来源", "合作状态", "风险", "设置风险", "邀请加入项目" are not wired as completed actions.
- M4 tasks: "导入排班", "日期/项目/主播/状态 filters", "编辑排班", "查看报数" are not wired as completed actions.
- M5 reports: "导出报数明细", "批量审核通过", date/project filters are not wired.
- M6 settlement: "查看审计", "导出 PDF", "保存为草稿" are not wired.
- M8 scattered exports: module-local export buttons do not open/prefill the governed export center.
- M9 top-bar bell in `components/layouts/ops-shell.tsx` displays unread count but does not navigate to `/console/stubs/m9`.

### Lower Priority / Product-Scope Dependent

- M0 organization screen: "权限变更日志", "邀请成员", "组织设置", member filters, "导出成员表", and "编辑角色" are UI-only. This needs a separate org-admin backend slice if in scope.
- Streamer mobile "我的": "我的录屏库", "结算账单", "账号与平台绑定", "隐私与权限", "操作记录" are empty handlers. Some can be fixed as navigation; account/privacy/log require product scope.
- Streamer desktop profile/security: password, 2FA, notification preference, login device, sign-out, platform add/manage are UI-only and need auth/profile scope.

## Repair Plan

### Phase 0: Inventory And Plan

- Write this inventory report.
- Commit the report separately.

### Phase 1: M10 War Room API Binding

- Add `features/war-room/war-room-ui-dto.ts` and focused tests for UI formatting.
- Add UI smoke covering pricing, matching, and project review API calls.
- Wire ScreenWarRoom actions to `/api/war-room/pricing`, `/api/war-room/matching`, and `/api/war-room/project-review`.
- Verify with `pnpm vitest run features/war-room/war-room-ui-dto.test.ts components/reference-ui/ops-reference.test.jsx` plus `pnpm test:p4-flywheel` and `pnpm test:ui-smoke`.
- Commit as `feat: bind war room UI to flywheel APIs`.

### Phase 2: M11 Billing Screen And Read-Only Guard

- Add billing status props, refresh action, and `ScreenBilling`.
- Add billing guard tests and route guard helper.
- Apply the guard to representative write routes listed in the current plan.
- Verify with `pnpm test:p5-commercialization`, `pnpm test:api-contracts`, and `pnpm test:ui-smoke`.
- Commit as `feat: enforce billing read-only guard on writes`.

### Phase 3: Streamer Mobile Diagnosis And Evidence Upload

- Wire `/m/diagnosis` to `/api/ai/diagnosis`.
- Replace demo report screenshot path with signed upload flow.
- Turn "我的录屏库" and "结算账单" empty handlers into real navigation.
- Verify with mobile UI smoke, API contracts, and P4 regression.
- Commit as `feat: wire streamer mobile diagnosis and evidence uploads`.

### Phase 4: Streamer Desktop Data Binding

- Add desktop DTO and tests.
- Load streamer tasks/applications/earnings into `/desktop`.
- Render injected rows and connect the most important task/report navigation actions.
- Verify with desktop UI smoke and existing mobile smoke.
- Commit as `feat: bind streamer desktop shell to live data`.

### Phase 5: Secondary Button Closure

- Triage module-local export/filter/action buttons into:
  - route-to-existing-center,
  - local state filter,
  - real API action,
  - disabled/out-of-scope with clear label.
- Start with M1/M2/M4/M5/M6 buttons because they sit on already-live business flows.
- Commit in small module slices.

### Phase 6: Final QA And Acceptance Report

- Add/update acceptance checklist.
- Run full verification: `pnpm lint`, `pnpm type-check`, `pnpm test`, `pnpm build`, and available smoke scripts.
- Write final closure report.
- Commit final docs.

## Hard Gates

Stop for confirmation only if a phase requires destructive database reset outside local test setup, irreversible data deletion, real payment provider integration, production deploy, new external service credentials, or scope expansion into full org-admin/auth-account management.
