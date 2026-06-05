# P6 Commercialization Launch Design

## Goal

在现有 P5 商业化底座之上，补齐正式收费上线需要的自助订阅、在线支付、用量包、发票申请、订阅生命周期、财务运营后台和全量 Billing Guard。第一版面向中国大陆 MCN / 直播工作室，使用人民币计价，通过聚合支付服务商统一接微信支付和支付宝。

P6 的目标不是把所有财税自动化一次做完，而是让客户可以自助试用、选套餐、在线付款、续费、升级、购买用量包、申请发票；系统可以可靠处理支付回调、欠费宽限期、只读降级、对账差异和人工开票状态。

## Approved Product Decisions

- 首发市场：中国大陆。
- 支付方式：聚合支付服务商，统一支持微信支付和支付宝。
- 计费模型：基础套餐 + 用量包。
- 定价策略：业务价值型。
  - 基础版：599 元 / 月。
  - 专业版：1999 元 / 月。
  - 企业版：5999 元 / 月起。
  - 年付：9 折或赠 2 个月，第一版以 9 折实现，赠月作为销售配置项预留。
- 免费试用：14 天专业版试用，无需绑定支付方式。
- 发票：支付后自助申请，后台人工开票。
- 欠费策略：到期后进入 7 天宽限期；宽限期结束仍未续费则进入只读保护。

## Current Baseline

仓库已有 P5 v1 底座：

- `features/billing/billing-gates.ts`：free/basic/pro/enterprise 权益门控与 read-only 判断。
- `features/billing/usage-metering.ts`：活跃主播、席位、OCR、AI、存储、导出等用量计量。
- `features/billing/billing-status.ts`：安全账单状态输出。
- `app/api/billing/status/route.ts`：经营侧安全读取账单状态。
- `supabase/migrations/20260602203000_p5_billing.sql`：套餐、订阅、用量事件、月度计数、加量包、功能加购等基础表。
- `docs/checklists/P5-commercialization.md`：明确 P5 v1 已覆盖底座，真实支付、发票税务仍在 scope out。

P6 在此基础上新增正式商业化上线能力。P5 的既有回归必须继续通过。

## Scope

### In Scope

- 在线套餐页和当前订阅页。
- 14 天专业版试用开通和到期处理。
- 聚合支付订单创建、支付二维码/跳转、支付回调、幂等确认。
- 微信支付 / 支付宝由聚合支付服务商统一抽象。
- 订阅生命周期：`trialing`、`active`、`grace_period`、`past_due`、`readonly`、`cancelled`。
- 套餐升级、续费、取消自动续费、购买用量包。
- 支付后发票申请、后台人工开票、发票状态流。
- 财务运营后台：订单、支付、订阅、退款申请、发票、对账、人工调整。
- Billing Guard 全量落地：关键写操作必须经过服务端套餐权益、订阅状态和用量余额校验。
- 沙箱支付、回调重放、对账差异、欠费降级和发票流程的自动化测试。

### Out Of Scope

- 自动电子发票服务商接入。
- 复杂税率和跨境税务。
- 海外支付、Stripe、多币种。
- 企业 SSO、私有化部署交付。
- 销售合同、法务审批和线下盖章流程。
- 全自动退款到账；第一版支持后台发起退款申请和状态追踪，实际退款可由聚合支付后台或财务人工处理。

## Package And Pricing Design

### Plan Matrix

| Plan | Price | Target Customer | Included |
| --- | --- | --- | --- |
| Free | 0 元 / 月 | 体验、很小团队 | 基础项目管理，有限项目和主播额度，不含结算、AI、导出中心 |
| Basic | 599 元 / 月 | 小型工作室 | 项目、主播、排班、基础结算，少量导出额度 |
| Pro | 1999 元 / 月 | 成长型 MCN | 完整结算、导出、作战台、AI 诊断、自动审核 shadow |
| Enterprise | 5999 元 / 月起 | 成熟机构 | 高额度、供应商协作、active 自动审核门禁、专属支持预留 |

### Included Quotas

| Metric | Free | Basic | Pro | Enterprise |
| --- | ---: | ---: | ---: | ---: |
| Seats | 2 | 5 | 20 | 100 |
| Active streamers / month | 5 | 30 | 150 | 1000 |
| Projects / month | 3 | 30 | 200 | 2000 |
| AI calls / month | 0 | 100 | 2000 | 20000 |
| OCR jobs / month | 0 | 300 | 5000 | 50000 |
| Exports / month | 0 | 20 | 500 | 5000 |
| Storage | 1 GB | 20 GB | 200 GB | 2 TB |

Enterprise 的具体额度可以由销售配置覆盖，但必须落入结构化 add-on / quota override，不允许只写在备注里。

### Add-On Packs

| Add-on | Unit | First Price |
| --- | --- | ---: |
| Active streamer pack | 50 active streamers / month | 299 元 |
| AI pack | 1000 AI calls | 199 元 |
| OCR pack | 5000 OCR jobs | 299 元 |
| Export pack | 500 exports | 99 元 |
| Storage pack | 100 GB / month | 99 元 |

Add-on 在当月生效，默认月底失效。企业客户可购买 recurring add-on，按订阅周期续费。

## Subscription Lifecycle

```text
trialing
  -> active                 payment succeeds before trial ends
  -> grace_period           trial expires without payment

active
  -> active                 renewal succeeds
  -> grace_period           renewal payment fails or period expires unpaid
  -> cancelled              user cancels future renewal, current period remains usable

grace_period
  -> active                 payment succeeds within 7 days
  -> readonly               no payment after 7 days

readonly
  -> active                 payment succeeds or admin restores subscription
  -> cancelled              user or admin closes subscription

cancelled
  -> active                 user buys a new plan
```

Rules:

- Trial is Pro-equivalent for feature access, but trial usage caps are lower than paid Pro to control AI/OCR cost.
- Trial does not require payment method.
- Grace period lasts 7 calendar days from `period_end`.
- During grace period, writes remain allowed, but all staff users see renewal warnings.
- During readonly, reads remain allowed; writes that create or mutate business data are blocked.
- Audit writes must never be blocked by billing state.
- Settlement and audit records must never be hidden or deleted because of billing downgrade.

## Payment Architecture

### Provider Boundary

All provider-specific logic stays behind `PaymentProviderAdapter`.

```typescript
export type PaymentProviderAdapter = {
  name: "aggregated_cn";
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  verifyWebhook(input: VerifyWebhookInput): Promise<VerifiedPaymentEvent>;
  queryPayment(input: QueryPaymentInput): Promise<PaymentQueryResult>;
  createRefundRequest(input: CreateRefundInput): Promise<RefundRequestResult>;
  parseReconciliationFile(input: ReconciliationInput): Promise<ReconciliationResult>;
};
```

Business code cannot call the provider SDK directly. API routes call payment service functions, and services call the adapter.

### Payment Flow

```text
User selects plan or add-on
-> create billing order
-> create provider payment
-> show QR code / redirect URL
-> provider sends webhook
-> verify signature
-> insert idempotency record
-> mark payment succeeded
-> activate subscription or add-on
-> write audit log
-> send notification
```

### Idempotency

Every provider webhook must use a provider event id or computed event hash as an idempotency key.

Webhook handling must be safe when:

- The same webhook is replayed.
- Webhooks arrive out of order.
- User manually refreshes payment status before webhook arrives.
- Provider returns paid in query API but webhook has not arrived.
- Internal activation succeeds after payment but notification fails.

The source of truth for money movement is the provider transaction id plus verified webhook / reconciliation result. UI polling is not enough to mark payment as paid.

## Data Model Additions

P6 should add a new migration instead of editing existing P5 migration.

### `billing_orders`

Represents a user-created purchase intent.

Fields:

- `id`
- `organization_id`
- `created_by`
- `order_no`
- `order_type`: `subscription_new`, `subscription_renewal`, `plan_upgrade`, `addon_purchase`
- `target_plan_id`
- `target_addon_id`
- `amount_cents`
- `currency`: `CNY`
- `status`: `pending`, `paying`, `paid`, `closed`, `cancelled`, `expired`, `refunding`, `refunded`, `failed`
- `provider_name`
- `provider_payment_id`
- `provider_payment_url`
- `provider_qr_code_url`
- `expires_at`
- `paid_at`
- `metadata`
- `created_at`, `updated_at`

### `payment_transactions`

Stores verified payment provider events.

Fields:

- `id`
- `organization_id`
- `billing_order_id`
- `provider_name`
- `provider_transaction_id`
- `channel`: `wechat`, `alipay`
- `amount_cents`
- `currency`
- `status`: `pending`, `succeeded`, `failed`, `refunded`, `partially_refunded`
- `paid_at`
- `raw_event_hash`
- `created_at`

Raw provider payloads should not be exposed to UI. If retained, store them in a restricted JSON field and only expose summarized safe fields.

### `payment_webhook_events`

Stores webhook idempotency and processing status.

Fields:

- `id`
- `provider_name`
- `event_key`
- `event_type`
- `signature_valid`
- `processing_status`: `received`, `processed`, `ignored`, `failed`
- `error_message`
- `received_at`
- `processed_at`

`provider_name + event_key` must be unique.

### `subscription_periods`

Tracks billing periods independently from the latest subscription row.

Fields:

- `id`
- `organization_id`
- `subscription_id`
- `plan_id`
- `period_start`
- `period_end`
- `status`: `trialing`, `active`, `grace_period`, `readonly`, `cancelled`
- `billing_order_id`
- `created_at`

### `invoice_requests`

Stores self-service invoice requests.

Fields:

- `id`
- `organization_id`
- `billing_order_id`
- `requested_by`
- `invoice_type`: `vat_general`, `vat_special`
- `title`
- `tax_id`
- `email`
- `phone`
- `address`
- `bank_name`
- `bank_account`
- `amount_cents`
- `status`: `requested`, `reviewing`, `issued`, `rejected`, `voided`
- `reject_reason`
- `issued_invoice_no`
- `issued_at`
- `created_at`, `updated_at`

### `billing_reconciliation_runs`

Tracks daily reconciliation imports.

Fields:

- `id`
- `provider_name`
- `business_date`
- `status`: `uploaded`, `matched`, `mismatch_found`, `resolved`, `failed`
- `matched_count`
- `mismatch_count`
- `total_amount_cents`
- `created_by`
- `created_at`

### `billing_reconciliation_items`

Stores per-transaction reconciliation result.

Fields:

- `id`
- `run_id`
- `provider_transaction_id`
- `billing_order_id`
- `provider_amount_cents`
- `local_amount_cents`
- `match_status`: `matched`, `provider_only`, `local_only`, `amount_mismatch`, `status_mismatch`
- `resolution_status`: `open`, `resolved`, `ignored`
- `resolution_note`

## Billing Guard Design

P6 must introduce a single service-side guard for write routes.

```typescript
export async function assertBillingWriteAllowed(input: {
  organizationId: string;
  featureKey: BillingFeatureKey;
  usageMetric?: BillingUsageMetric;
  requestedUnits?: number;
  client: SupabaseLikeClient;
}): Promise<BillingGuardResult>;
```

Rules:

- All mutating business routes call the guard after auth and organization resolution, before domain mutation.
- GET routes do not call write guard.
- Audit writes do not call write guard.
- Readonly subscriptions block writes but allow reads.
- Feature entitlement failures return a clear upgrade-required error.
- Usage quota failures return an overage / add-on-required error.
- UI may hide or disable buttons, but UI is never the security boundary.

Representative routes that must be guarded before P6 launch:

- Project create/update/publish.
- Application review and confirm join.
- Live task create/batch/start/stop/cancel.
- Live report submit/review.
- Settlement batch create/manual item/lock/reopen.
- Export create.
- Delivery package create.
- AI diagnosis / brief / script / copilot routes.
- OCR job create/run.
- Auto-review active actions.

## API Surface

### Public Authenticated MCN APIs

- `GET /api/billing/status`
  - Existing endpoint; extend with current plan, trial, grace period, usage, add-on summary, renewal warnings.
- `GET /api/billing/plans`
  - Returns safe public plan matrix and add-on pack list.
- `POST /api/billing/trials`
  - Starts 14-day Pro trial if organization has not used a trial.
- `POST /api/billing/orders`
  - Creates subscription or add-on order.
- `GET /api/billing/orders/:orderId`
  - Polls order status and safe payment display fields.
- `POST /api/billing/subscription/cancel-renewal`
  - Cancels future renewal, current paid period remains active.
- `POST /api/billing/invoices`
  - Creates invoice request for a paid order.
- `GET /api/billing/invoices`
  - Lists invoice requests for the current organization.

### Provider Webhook APIs

- `POST /api/billing/webhooks/aggregated-cn`
  - Verifies provider signature, records idempotency, updates payment and subscription state.

Webhook route must not rely on user session. It must authenticate by provider signature and configured webhook secret.

### Finance Operations APIs

Finance / owner / ops manager roles may access:

- `GET /api/billing/admin/orders`
- `GET /api/billing/admin/payments`
- `GET /api/billing/admin/invoices`
- `PATCH /api/billing/admin/invoices/:invoiceId`
- `POST /api/billing/admin/reconciliation-runs`
- `GET /api/billing/admin/reconciliation-runs/:runId`
- `PATCH /api/billing/admin/reconciliation-items/:itemId`
- `POST /api/billing/admin/subscriptions/:subscriptionId/adjust`

All admin mutation APIs require audit reason.

## UI Design

### Customer Billing Center

Route: `/console/stubs/m11` or future `/console/billing`.

Sections:

- Current plan card: plan, renewal date, status, trial/grace countdown.
- Usage panel: active streamers, seats, AI, OCR, exports, storage.
- Plan comparison: Free / Basic / Pro / Enterprise.
- Add-on packs: AI, OCR, exports, storage, active streamers.
- Payment orders: pending and paid orders.
- Invoice requests: request invoice and track status.
- Warnings:
  - Trial ending soon.
  - Payment failed.
  - Grace period countdown.
  - Readonly state.

### Checkout

First version can use a modal or dedicated page:

- Confirm plan or add-on.
- Show amount, billing cycle, invoice note, and provider channels.
- Display QR code / provider payment URL.
- Poll order status.
- Show success state and updated subscription.

### Finance Operations

Route can live under M11 billing admin screen:

- Orders table.
- Payments table.
- Invoice request queue.
- Reconciliation import and mismatch table.
- Subscription adjustment panel.

Finance UI must not expose raw provider payloads by default.

## Error Handling

### Payment Failure

- If create payment fails, order remains `pending` or `failed` with a user-safe error.
- User can retry and create a new provider payment attempt.
- Failed attempts must not activate subscription.

### Webhook Replay

- Duplicate event key returns 200 after confirming prior processing status.
- Duplicate webhook must not double-extend subscription or double-credit add-on.

### Reconciliation Mismatch

- Mismatch remains visible in finance operations.
- It does not automatically revoke paid access.
- Finance user resolves with a reason and audit log.

### Invoice Rejection

- Finance can reject invoice request with reason.
- Customer can submit a new invoice request for the same paid order if remaining invoiceable amount is available.

### Grace Period Expiry

- Scheduled job transitions expired grace subscriptions to readonly.
- User can still view historical business, settlement, audit, invoices, and orders.
- Writes return upgrade / renewal required errors.

## Security And Compliance Boundaries

- Provider secrets only live in environment variables.
- Payment webhook verifies provider signature before state mutation.
- Streamers cannot read organization billing status or economics.
- Billing admin endpoints require MCN staff roles; sensitive finance operations require owner or finance role.
- Audit logs are required for plan overrides, subscription adjustments, invoice status changes, reconciliation resolution, and refund requests.
- Raw provider payloads are not returned from public APIs.
- Amounts are stored in cents as integers.
- Currency is `CNY` in P6.

## Background Jobs

P6 needs background or scheduled tasks:

- Trial expiry scanner.
- Subscription renewal scanner.
- Grace period expiry scanner.
- Payment timeout scanner.
- Daily reconciliation import / reminder.
- Monthly usage counter reset.

In local/test environments these can run through explicit scripts or route handlers. Production can later move them to cron / queue workers, but the domain services must be independent of the scheduler.

## Testing Strategy

### Unit Tests

- Plan matrix and entitlement resolution.
- Add-on credit application.
- Usage quota calculation.
- Subscription state transitions.
- Payment adapter signature verification abstraction.
- Webhook idempotency.
- Invoice request validation.
- Reconciliation matching.

### Route Contract Tests

- Create trial.
- Create order.
- Poll order.
- Webhook success.
- Webhook replay.
- Payment failure.
- Invoice request.
- Admin invoice status update.
- Reconciliation import.
- Billing guard on representative write routes.

### Regression Tests

Extend `pnpm test:p5-commercialization` to cover:

- Trial to active.
- Active renewal success.
- Active to grace period.
- Grace period to readonly.
- Readonly blocks writes and allows reads.
- Paid add-on increases quota.
- Streamer cannot read billing status.
- Public APIs never expose provider raw payload or internal economics.

### Manual Acceptance

Add P6 acceptance cases:

- New organization starts 14-day trial.
- Trial user upgrades to Pro by QR payment.
- Webhook activates subscription.
- Replayed webhook is ignored safely.
- User buys AI add-on and quota increases.
- Renewal fails, user enters 7-day grace period.
- Grace period expires and organization becomes readonly.
- User pays after readonly and access restores.
- User requests invoice; finance issues it.
- Reconciliation mismatch is detected and resolved with audit reason.

## Rollout Plan

1. Build data model and provider adapter boundary with fake provider.
2. Implement trial, plan, order, payment webhook, subscription state services.
3. Implement Billing Guard and apply to representative write routes first.
4. Build customer billing center and checkout.
5. Build invoice request and finance operations.
6. Add reconciliation import and mismatch resolution.
7. Apply Billing Guard across all mutating business routes.
8. Run P1-P6 regression and manual acceptance.
9. Enable sandbox payment provider.
10. Enable production provider for first controlled customer cohort.

## Launch Gates

P6 can be considered ready for commercial launch only when:

- `pnpm test:p5-commercialization` includes P6 lifecycle coverage and passes.
- `pnpm lint`, `pnpm type-check`, `pnpm test`, and `pnpm build` pass.
- Payment sandbox covers success, failure, callback replay, timeout, refund request, and reconciliation mismatch.
- Every critical write route has service-side Billing Guard.
- Readonly downgrade preserves reads for project, settlement, audit, order, payment, and invoice data.
- Finance operations can resolve invoice and reconciliation states with audit reasons.
- Production provider secrets are configured outside source control.

## Open Decisions

The following are implementation-time decisions, not blockers for the design:

- Exact聚合支付服务商 vendor. The adapter boundary allows Ping++, 汇付, 拉卡拉, 易宝 or another provider without changing business services.
- Whether annual payment uses 9折 or赠 2 个月 for each plan. P6 implements 9折 by default and leaves赠月 as an admin override.
- Whether Enterprise payment is self-service or quote-first. First version can show Enterprise as "联系销售" while preserving admin-created Enterprise subscriptions.

## Self-Review

- No placeholder requirements remain; open items are explicitly implementation-time choices with defaults.
- P6 scope does not contradict P5 v1: P5 remains the底座, P6 adds formal commercial launch capability.
- The design keeps payment, billing, invoice, reconciliation, and business write guards separated by clear service boundaries.
- The plan avoids automatic invoice provider integration and overseas payment scope, matching the approved China-first direction.
