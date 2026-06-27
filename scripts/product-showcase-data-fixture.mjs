import { createHash } from "node:crypto";

export const DATASET = Object.freeze({
  code: "product_showcase_v1",
  source: "product_showcase_seed",
  now: "2026-06-28T02:00:00.000Z",
  periodStart: "2026-06-01",
  periodEnd: "2026-06-30",
  periodMonth: "2026-06-01",
  requiredUsageMetrics: Object.freeze([
    "active_streamer",
    "seat",
    "ocr",
    "ai",
    "storage_mb",
    "export",
  ]),
});

const SHOWCASE_VOLUME = Object.freeze({
  projects: 20,
  streamers: 75,
  projectStreamers: 75,
  liveTasks: 180,
  liveReports: 120,
  settlementBatches: 20,
  settlementBatchItems: 60,
  projectApplications: 60,
  recordingSubmissions: 20,
  notifications: 50,
});

const BASE_SETTLEMENT_BATCH_ITEM_COUNT = 3;

export function normalizeAccountIdentifier(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    throw new Error("Account is required");
  }

  if (isUuid(trimmed)) {
    return trimmed.toLowerCase();
  }

  const compactPhone = trimmed.replace(/[\s-]/g, "");
  if (/^\+?\d{6,}$/.test(compactPhone)) {
    return compactPhone;
  }

  return trimmed.toLowerCase();
}

export function buildAccountLookupPlan(value) {
  const account = normalizeAccountIdentifier(value);
  if (isUuid(account)) {
    return [{ column: "id", value: account }];
  }

  if (account.includes("@")) {
    return [
      { column: "email", value: account },
      { column: "login_account", value: account },
    ];
  }

  if (/^\+?\d{6,}$/.test(account)) {
    return [
      { column: "phone", value: account },
      { column: "login_account", value: account },
    ];
  }

  return [{ column: "login_account", value: account }];
}

export function assertShowcaseExecutionAllowed(env) {
  if (env.ALLOW_PRODUCT_SHOWCASE_DATA !== "1") {
    throw new Error(
      "Refusing to run product showcase data command. Set ALLOW_PRODUCT_SHOWCASE_DATA=1 when you intentionally target this server.",
    );
  }
}

export function createStableUuidFactory(accountId, organizationId) {
  const namespace = `${DATASET.code}:${accountId}:${organizationId}`;
  return (key) => stableUuid(`${namespace}:${key}`);
}

export function buildShowcaseManifest({ accountId, organizationId }) {
  const uuidFor = createStableUuidFactory(accountId, organizationId);
  const suffix = shortHash(`${accountId}:${organizationId}`);

  return {
    datasetCode: DATASET.code,
    source: DATASET.source,
    organizationId,
    targetAccountId: accountId,
    partnerOrganizationId: uuidFor("partner-organization"),
    partnerOrganizationCode: `product-showcase-${suffix}`,
    supplierIds: [uuidFor("supplier-primary")],
    projectIds: extendStableIds(
      [uuidFor("project-live-growth"), uuidFor("project-settlement-drill")],
      SHOWCASE_VOLUME.projects,
      (index) => uuidFor(`project-bulk-${index}`),
    ),
    streamerIds: extendStableIds(
      [
        uuidFor("streamer-bound"),
        uuidFor("streamer-audit"),
        uuidFor("streamer-trial"),
      ],
      SHOWCASE_VOLUME.streamers,
      (index) => uuidFor(`streamer-bulk-${index}`),
    ),
    streamerAccountIds: range(0, SHOWCASE_VOLUME.streamers).map((index) =>
      uuidFor(`streamer-account-${index}-douyin`),
    ),
    streamerSupplierIds: range(0, SHOWCASE_VOLUME.streamers).map((index) =>
      uuidFor(`streamer-supplier-${index}`),
    ),
    projectStreamerIds: extendStableIds(
      [
        uuidFor("project-streamer-bound"),
        uuidFor("project-streamer-audit"),
        uuidFor("project-streamer-trial"),
      ],
      SHOWCASE_VOLUME.projectStreamers,
      (index) => uuidFor(`project-streamer-bulk-${index}`),
    ),
    liveTaskIds: extendStableIds(
      [
        uuidFor("task-bound-upcoming"),
        uuidFor("task-bound-review"),
        uuidFor("task-bound-approved"),
        uuidFor("task-audit-live"),
        uuidFor("task-audit-completed"),
      ],
      SHOWCASE_VOLUME.liveTasks,
      (index) => uuidFor(`task-bulk-${index}`),
    ),
    liveReportIds: extendStableIds(
      [
        uuidFor("report-bound-review"),
        uuidFor("report-bound-approved"),
        uuidFor("report-audit-approved"),
        uuidFor("report-audit-need-more"),
      ],
      SHOWCASE_VOLUME.liveReports,
      (index) => uuidFor(`report-bulk-${index}`),
    ),
    settlementBatchIds: extendStableIds(
      [uuidFor("settlement-payable"), uuidFor("settlement-receivable")],
      SHOWCASE_VOLUME.settlementBatches,
      (index) => uuidFor(`settlement-batch-bulk-${index}`),
    ),
    settlementBatchItemIds: extendStableIds(
      [
        uuidFor("settlement-item-bound"),
        uuidFor("settlement-item-audit"),
        uuidFor("settlement-item-manual"),
      ],
      SHOWCASE_VOLUME.settlementBatchItems,
      (index) => uuidFor(`settlement-item-bulk-${index}`),
    ),
    projectApplicationIds: extendStableIds(
      [
        uuidFor("application-recording"),
        uuidFor("application-confirmed"),
        uuidFor("application-rejected"),
      ],
      SHOWCASE_VOLUME.projectApplications,
      (index) => uuidFor(`application-bulk-${index}`),
    ),
    recordingSubmissionIds: extendStableIds(
      [uuidFor("recording-reviewing"), uuidFor("recording-approved")],
      SHOWCASE_VOLUME.recordingSubmissions,
      (index) => uuidFor(`recording-bulk-${index}`),
    ),
    collaborationShareIds: [uuidFor("collaboration-share")],
    collaborationApplicationIds: [uuidFor("collaboration-application")],
    collaborationAgreementIds: [uuidFor("collaboration-agreement")],
    collaborationRevenueRecordIds: [
      uuidFor("collaboration-revenue-1"),
      uuidFor("collaboration-revenue-2"),
    ],
    collaborationSettlementBatchIds: [
      uuidFor("collaboration-settlement-batch"),
    ],
    collaborationSettlementItemIds: [
      uuidFor("collaboration-settlement-item-1"),
      uuidFor("collaboration-settlement-item-2"),
    ],
    screenshotIds: extendStableIds(
      [
        uuidFor("screenshot-review"),
        uuidFor("screenshot-bound"),
        uuidFor("screenshot-audit"),
        uuidFor("screenshot-need-more"),
      ],
      SHOWCASE_VOLUME.liveReports,
      (index) => uuidFor(`screenshot-bulk-${index}`),
    ),
    ocrResultIds: extendStableIds(
      [
        uuidFor("ocr-review"),
        uuidFor("ocr-bound"),
        uuidFor("ocr-audit"),
        uuidFor("ocr-need-more"),
      ],
      SHOWCASE_VOLUME.liveReports,
      (index) => uuidFor(`ocr-bulk-${index}`),
    ),
    notificationIds: extendStableIds(
      [
        uuidFor("notification-task"),
        uuidFor("notification-review"),
        uuidFor("notification-risk"),
        uuidFor("notification-settlement"),
      ],
      SHOWCASE_VOLUME.notifications,
      (index) => uuidFor(`notification-bulk-${index}`),
    ),
    autoReviewRuleIds: [uuidFor("auto-review-rule")],
    reviewSampleIds: [uuidFor("review-sample")],
    reportChangeLogIds: [uuidFor("report-change-log")],
    billingPlanId: uuidFor("billing-plan"),
    organizationSubscriptionId: uuidFor("organization-subscription"),
    usageEventIds: DATASET.requiredUsageMetrics.map((metric) =>
      uuidFor(`usage-event-${metric}`),
    ),
    usageCounterIds: DATASET.requiredUsageMetrics.map((metric) =>
      uuidFor(`usage-counter-${metric}`),
    ),
    usageAddonIds: [uuidFor("usage-addon-ocr")],
  };
}

export function buildShowcaseRows({ account, organization }) {
  const manifest = buildShowcaseManifest({
    accountId: account.id,
    organizationId: organization.id,
  });
  const suffix = shortHash(`${account.id}:${organization.id}`);
  const [primaryProjectId, settlementProjectId] = manifest.projectIds;
  const [boundStreamerId, auditStreamerId, trialStreamerId] =
    manifest.streamerIds;
  const [
    taskUpcomingId,
    taskReviewId,
    taskApprovedId,
    taskLiveId,
    taskCompletedId,
  ] = manifest.liveTaskIds;
  const [
    reportReviewId,
    reportBoundApprovedId,
    reportAuditApprovedId,
    reportNeedMoreId,
  ] = manifest.liveReportIds;
  const [
    applicationRecordingId,
    applicationConfirmedId,
    applicationRejectedId,
  ] = manifest.projectApplicationIds;
  const [recordingReviewingId, recordingApprovedId] =
    manifest.recordingSubmissionIds;
  const [payableBatchId, receivableBatchId] = manifest.settlementBatchIds;
  const [payableBoundItemId, payableAuditItemId, receivableManualItemId] =
    manifest.settlementBatchItemIds;
  const [collaborationShareId] = manifest.collaborationShareIds;
  const [collaborationApplicationId] = manifest.collaborationApplicationIds;
  const [collaborationAgreementId] = manifest.collaborationAgreementIds;
  const [revenueRecordAId, revenueRecordBId] =
    manifest.collaborationRevenueRecordIds;
  const [collaborationSettlementBatchId] =
    manifest.collaborationSettlementBatchIds;
  const [collaborationSettlementItemAId, collaborationSettlementItemBId] =
    manifest.collaborationSettlementItemIds;
  const [
    screenshotReviewId,
    screenshotBoundId,
    screenshotAuditId,
    screenshotNeedMoreId,
  ] = manifest.screenshotIds;
  const [ocrReviewId, ocrBoundId, ocrAuditId, ocrNeedMoreId] =
    manifest.ocrResultIds;
  const [
    notificationTaskId,
    notificationReviewId,
    notificationRiskId,
    notificationSettlementId,
  ] = manifest.notificationIds;
  const [supplierId] = manifest.supplierIds;

  const projects = [
    {
      id: primaryProjectId,
      organization_id: organization.id,
      code: `SHOWCASE-LIVE-${suffix.slice(0, 6).toUpperCase()}`,
      name: "云途新品增长战役",
      status: "active",
      sensitivity: "normal",
      supplier_id: supplierId,
      created_by: account.id,
      owner_id: account.id,
      ops_manager_id: account.id,
      starts_at: "2026-06-20T10:00:00.000Z",
      ends_at: "2026-07-05T10:00:00.000Z",
      recruiting_deadline: "2026-06-25",
      open_signup: true,
      allow_direct_invite: true,
      force_recording: true,
      force_system_timing: true,
      default_settlement_method: "base_salary_cpt",
      default_hourly_rate: 110,
      default_base_salary: 1800,
      default_settlement_rule: {
        dataset: DATASET.code,
        baseSalary: 1800,
        cptHourlyRate: 110,
      },
      published_at: "2026-06-18T09:00:00.000Z",
      vendor_name: "云途互娱",
      product_name: "云途纪元",
      agent_name: "经营舱演示运营组",
      supplier_name: "北辰内容供应",
      description:
        "覆盖项目发布、主播报名、录屏审核、直播执行和结算的展示项目。",
      is_public_to_streamers: true,
      public_summary: "高曝光新品首发，适合剧情向和攻略向主播。",
      game_download_url: "https://example.cn/download/yuntu",
      is_open_to_mcn_collaboration: true,
      mcn_collaboration_summary: "开放外部 MCN 协作，按项目收入分成结算。",
      mcn_collaboration_terms: {
        dataset: DATASET.code,
        revenueShareBps: 2200,
        settlementBasis: "project_revenue",
      },
    },
    {
      id: settlementProjectId,
      organization_id: organization.id,
      code: `SHOWCASE-SETTLE-${suffix.slice(0, 6).toUpperCase()}`,
      name: "光塔长线结算复盘",
      status: "settling",
      sensitivity: "high",
      supplier_id: supplierId,
      created_by: account.id,
      owner_id: account.id,
      ops_manager_id: account.id,
      starts_at: "2026-06-01T10:00:00.000Z",
      ends_at: "2026-06-27T10:00:00.000Z",
      recruiting_deadline: "2026-05-29",
      open_signup: false,
      allow_direct_invite: true,
      force_recording: true,
      force_system_timing: true,
      default_settlement_method: "cpt",
      default_hourly_rate: 96,
      default_base_salary: 0,
      default_settlement_rule: {
        dataset: DATASET.code,
        cptHourlyRate: 96,
      },
      published_at: "2026-05-28T09:00:00.000Z",
      vendor_name: "光塔科技",
      product_name: "光塔边境",
      agent_name: "经营舱演示运营组",
      supplier_name: "北辰内容供应",
      description: "用于展示已审核报告进入结算池、批次生成和争议金额处理。",
      is_public_to_streamers: true,
      public_summary: "长线直播专项，重点观察留存和结算证据。",
      game_download_url: "https://example.cn/download/lighttower",
      is_open_to_mcn_collaboration: false,
      mcn_collaboration_summary: "",
      mcn_collaboration_terms: {},
    },
  ];

  const streamers = [
    {
      id: boundStreamerId,
      organization_id: organization.id,
      user_id: account.id,
      display_name: "云栈晨光",
      real_name: "周晨",
      gender: "female",
      phone: "13900001001",
      wechat: `showcase_${suffix.slice(0, 6)}_a`,
      note: "绑定目标账号，可用于移动端任务演示。",
      source_type: "signed",
      primary_supplier_id: supplierId,
      referrer: "内容运营",
      cooperation_status: "active",
      categories: ["新品首发", "剧情攻略"],
      platforms: ["douyin", "kuaishou"],
      styles: ["稳态讲解", "高互动"],
      skills: ["首日拉新", "直播转化"],
      availability: { weekday: "evening", weekend: "afternoon" },
      equipment: { captureCard: true, mobileMirror: true },
      risk_tags: [],
      default_settlement_method: "base_salary_cpt",
      default_price: 110,
      default_base_salary: 1800,
      default_cps_rate_bps: 800,
      risk_level: "low",
      auto_trust: "trusted",
      clean_report_count: 12,
      duration_baseline: 140,
      created_by: account.id,
    },
    {
      id: auditStreamerId,
      organization_id: organization.id,
      user_id: null,
      display_name: "北辰洛白",
      real_name: "林洛",
      gender: "male",
      phone: "13900001002",
      wechat: `showcase_${suffix.slice(0, 6)}_b`,
      note: "用于展示 OCR 复核和黄标证据。",
      source_type: "supplier_recommended",
      primary_supplier_id: supplierId,
      referrer: "北辰内容供应",
      cooperation_status: "key_development",
      categories: ["长线运营", "公会协同"],
      platforms: ["douyin"],
      styles: ["复盘拆解", "公会带动"],
      skills: ["留存运营", "付费引导"],
      availability: { weekday: "night" },
      equipment: { pcStreaming: true },
      risk_tags: ["duration_review"],
      default_settlement_method: "cpt",
      default_price: 96,
      default_base_salary: 0,
      default_cps_rate_bps: 500,
      risk_level: "medium",
      risk_reason: "近期有一次时长截图差异，需要人工确认。",
      auto_trust: "probation",
      clean_report_count: 3,
      duration_baseline: 150,
      created_by: account.id,
    },
    {
      id: trialStreamerId,
      organization_id: organization.id,
      user_id: null,
      display_name: "潮音小满",
      real_name: "许满",
      gender: "female",
      phone: "13900001003",
      wechat: `showcase_${suffix.slice(0, 6)}_c`,
      note: "用于展示招募报名与录屏驳回。",
      source_type: "external",
      primary_supplier_id: supplierId,
      referrer: "公开报名",
      cooperation_status: "not_started",
      categories: ["试播", "短视频联动"],
      platforms: ["bilibili", "douyin"],
      styles: ["轻松种草"],
      skills: ["试玩反馈"],
      availability: { weekday: "afternoon" },
      equipment: { mobileOnly: true },
      risk_tags: [],
      default_settlement_method: "cpt",
      default_price: 80,
      default_base_salary: 0,
      default_cps_rate_bps: 0,
      risk_level: "low",
      auto_trust: "probation",
      clean_report_count: 0,
      duration_baseline: 90,
      created_by: account.id,
    },
  ];

  const extraProjects = manifest.projectIds
    .slice(projects.length)
    .map((projectId, offset) => {
      const index = projects.length + offset;
      const status = pick(
        ["active", "recruiting", "pending_start", "settling", "ended"],
        index,
      );
      const rate = 80 + (index % 6) * 12;
      const monthDay = twoDigit(1 + (index % 24));

      return {
        id: projectId,
        organization_id: organization.id,
        code: `SHOWCASE-BULK-${String(index + 1).padStart(2, "0")}-${suffix
          .slice(0, 4)
          .toUpperCase()}`,
        name: `Showcase Project ${String(index + 1).padStart(2, "0")}`,
        status,
        sensitivity: index % 5 === 0 ? "high" : "normal",
        supplier_id: supplierId,
        created_by: account.id,
        owner_id: account.id,
        ops_manager_id: account.id,
        starts_at: `2026-06-${monthDay}T10:00:00.000Z`,
        ends_at: `2026-07-${twoDigit(1 + (index % 20))}T10:00:00.000Z`,
        recruiting_deadline: `2026-06-${twoDigit(1 + (index % 20))}`,
        open_signup: index % 3 !== 0,
        allow_direct_invite: true,
        force_recording: index % 4 !== 0,
        force_system_timing: true,
        default_settlement_method:
          index % 4 === 0 ? "base_salary_cpt" : index % 4 === 1 ? "cpt" : "cps",
        default_hourly_rate: rate,
        default_base_salary: index % 4 === 0 ? 1200 + index * 20 : 0,
        default_settlement_rule: {
          dataset: DATASET.code,
          volume: "large_showcase",
          cptHourlyRate: rate,
          cpsRateBps: 500 + (index % 5) * 100,
        },
        published_at:
          status === "draft"
            ? null
            : `2026-06-${twoDigit(1 + (index % 18))}T09:00:00.000Z`,
        vendor_name: `Vendor ${String(index + 1).padStart(2, "0")}`,
        product_name: `Product ${String(index + 1).padStart(2, "0")}`,
        agent_name: "Product showcase operations",
        supplier_name: "Showcase content supplier",
        description: `Generated showcase project ${index + 1} for list, filter, and paging demos.`,
        is_public_to_streamers: true,
        public_summary: `Showcase public brief ${index + 1}`,
        game_download_url: `https://example.cn/download/showcase-${index + 1}`,
        is_open_to_mcn_collaboration: index % 3 === 0,
        mcn_collaboration_summary:
          index % 3 === 0 ? "Open for partner MCN revenue share." : "",
        mcn_collaboration_terms:
          index % 3 === 0
            ? {
                dataset: DATASET.code,
                revenueShareBps: 1800 + (index % 5) * 100,
                settlementBasis: "project_revenue",
              }
            : {},
      };
    });
  const allProjects = [...projects, ...extraProjects];

  const extraStreamers = manifest.streamerIds
    .slice(streamers.length)
    .map((streamerId, offset) => {
      const index = streamers.length + offset;
      const price = 72 + (index % 9) * 8;

      return {
        id: streamerId,
        organization_id: organization.id,
        user_id: null,
        display_name: `Showcase Anchor ${String(index + 1).padStart(2, "0")}`,
        real_name: `Demo Talent ${String(index + 1).padStart(2, "0")}`,
        gender: index % 2 === 0 ? "female" : "male",
        phone: `139${String(10000000 + index).slice(0, 8)}`,
        wechat: `showcase_${suffix.slice(0, 6)}_${index + 1}`,
        note: `Generated showcase streamer ${index + 1}`,
        source_type: pick(
          ["signed", "external", "supplier_recommended", "account_managed"],
          index,
        ),
        primary_supplier_id: supplierId,
        referrer:
          index % 4 === 0
            ? "public_signup"
            : index % 4 === 1
              ? "supplier_pool"
              : "ops_invite",
        cooperation_status: pick(
          ["active", "key_development", "signed", "not_started", "paused"],
          index,
        ),
        categories: [
          pick(["new_release", "retention", "strategy", "casual"], index),
          "showcase",
        ],
        platforms: index % 3 === 0 ? ["douyin", "bilibili"] : ["douyin"],
        styles: [pick(["stable", "high_energy", "analysis", "trial"], index)],
        skills: [pick(["conversion", "walkthrough", "retention"], index)],
        availability: {
          weekday: pick(["afternoon", "evening", "night"], index),
          capacityPerWeek: 2 + (index % 5),
        },
        equipment: {
          mobileMirror: index % 2 === 0,
          pcStreaming: index % 3 === 0,
          captureCard: index % 4 === 0,
        },
        risk_tags: index % 11 === 0 ? ["duration_review"] : [],
        default_settlement_method: index % 4 === 0 ? "base_salary_cpt" : "cpt",
        default_price: price,
        default_base_salary: index % 4 === 0 ? 900 + index * 10 : 0,
        default_cps_rate_bps: 300 + (index % 7) * 100,
        risk_level:
          index % 13 === 0 ? "high" : index % 5 === 0 ? "medium" : "low",
        risk_reason:
          index % 13 === 0
            ? "Generated high-risk sample for review demos."
            : null,
        auto_trust:
          index % 13 === 0
            ? "restricted"
            : index % 5 === 0
              ? "probation"
              : "trusted",
        clean_report_count: index % 18,
        duration_baseline: 90 + (index % 6) * 15,
        created_by: account.id,
      };
    });
  const allStreamers = [...streamers, ...extraStreamers];

  const liveTasks = [
    {
      id: taskUpcomingId,
      organization_id: organization.id,
      project_id: primaryProjectId,
      streamer_id: boundStreamerId,
      title: "新品首日预热直播",
      task_type: "project",
      status: "pending_live",
      planned_start_at: "2026-06-29T12:00:00.000Z",
      planned_end_at: "2026-06-29T14:30:00.000Z",
      planned_duration: 150,
      requires_timing: true,
      system_duration: 0,
      anomaly_flags: [],
      created_by: account.id,
      note: DATASET.code,
    },
    {
      id: taskReviewId,
      organization_id: organization.id,
      project_id: primaryProjectId,
      streamer_id: boundStreamerId,
      title: "录屏复核中的直播",
      task_type: "project",
      status: "report_pending_review",
      planned_start_at: "2026-06-27T12:00:00.000Z",
      planned_end_at: "2026-06-27T14:00:00.000Z",
      planned_duration: 120,
      requires_timing: true,
      system_started_at: "2026-06-27T12:00:00.000Z",
      system_stopped_at: "2026-06-27T14:01:00.000Z",
      system_duration: 121,
      anomaly_flags: [],
      created_by: account.id,
      note: DATASET.code,
    },
    {
      id: taskApprovedId,
      organization_id: organization.id,
      project_id: primaryProjectId,
      streamer_id: boundStreamerId,
      title: "已审核进入结算池",
      task_type: "project",
      status: "report_approved",
      planned_start_at: "2026-06-26T12:00:00.000Z",
      planned_end_at: "2026-06-26T14:30:00.000Z",
      planned_duration: 150,
      requires_timing: true,
      system_started_at: "2026-06-26T12:00:00.000Z",
      system_stopped_at: "2026-06-26T14:27:00.000Z",
      system_duration: 147,
      anomaly_flags: [],
      created_by: account.id,
      note: DATASET.code,
    },
    {
      id: taskLiveId,
      organization_id: organization.id,
      project_id: settlementProjectId,
      streamer_id: auditStreamerId,
      title: "长线项目正在直播",
      task_type: "project",
      status: "live",
      planned_start_at: "2026-06-28T13:00:00.000Z",
      planned_end_at: "2026-06-28T15:30:00.000Z",
      planned_duration: 150,
      requires_timing: true,
      system_started_at: "2026-06-28T13:00:00.000Z",
      system_duration: 42,
      anomaly_flags: ["duration_watch"],
      created_by: account.id,
      note: DATASET.code,
    },
    {
      id: taskCompletedId,
      organization_id: organization.id,
      project_id: settlementProjectId,
      streamer_id: auditStreamerId,
      title: "已完成待复盘直播",
      task_type: "project",
      status: "completed",
      planned_start_at: "2026-06-24T13:00:00.000Z",
      planned_end_at: "2026-06-24T15:30:00.000Z",
      planned_duration: 150,
      requires_timing: true,
      system_started_at: "2026-06-24T13:00:00.000Z",
      system_stopped_at: "2026-06-24T15:22:00.000Z",
      system_duration: 142,
      anomaly_flags: ["screenshot_gap"],
      created_by: account.id,
      note: DATASET.code,
    },
  ];

  const extraLiveTasks = manifest.liveTaskIds
    .slice(liveTasks.length)
    .map((taskId, offset) => {
      const index = liveTasks.length + offset;
      const status = pick(
        [
          "pending_live",
          "live",
          "pending_report",
          "report_pending_review",
          "report_approved",
          "completed",
          "report_rejected",
          "abnormal",
        ],
        index,
      );
      const plannedDuration = 90 + (index % 5) * 30;
      const startHour = 10 + (index % 8);
      const projectId = pick(manifest.projectIds, index);
      const streamerId = pick(manifest.streamerIds, index + 3);
      const hasStarted = !["pending_live", "cancelled"].includes(status);
      const hasStopped = [
        "pending_report",
        "report_pending_review",
        "report_approved",
        "completed",
        "report_rejected",
        "abnormal",
      ].includes(status);

      return {
        id: taskId,
        organization_id: organization.id,
        project_id: projectId,
        streamer_id: streamerId,
        title: `Showcase live task ${String(index + 1).padStart(3, "0")}`,
        task_type: "project",
        status,
        planned_start_at: `2026-06-${twoDigit(1 + (index % 28))}T${twoDigit(
          startHour,
        )}:00:00.000Z`,
        planned_end_at: `2026-06-${twoDigit(1 + (index % 28))}T${twoDigit(
          startHour + 2,
        )}:30:00.000Z`,
        planned_duration: plannedDuration,
        requires_timing: true,
        system_started_at: hasStarted
          ? `2026-06-${twoDigit(1 + (index % 28))}T${twoDigit(
              startHour,
            )}:03:00.000Z`
          : null,
        system_stopped_at: hasStopped
          ? `2026-06-${twoDigit(1 + (index % 28))}T${twoDigit(
              startHour + 2,
            )}:18:00.000Z`
          : null,
        system_duration: hasStarted
          ? Math.max(20, plannedDuration - 12 + (index % 17))
          : 0,
        anomaly_flags:
          index % 17 === 0
            ? ["duration_watch"]
            : index % 19 === 0
              ? ["screenshot_gap"]
              : [],
        created_by: account.id,
        note: DATASET.code,
      };
    });
  const allLiveTasks = [...liveTasks, ...extraLiveTasks];

  const liveReports = [
    {
      id: reportReviewId,
      organization_id: organization.id,
      live_task_id: taskReviewId,
      project_id: primaryProjectId,
      streamer_id: boundStreamerId,
      status: "pending_review",
      system_duration: 121,
      screenshot_duration: 119,
      claimed_duration: 120,
      settlement_duration: null,
      time_source: null,
      evidence_level: null,
      divergence_pct: 0.0168,
      viewers: 1860,
      review_mode: "manual",
      auto_rule_version: null,
      auto_gate_snapshot: { dataset: DATASET.code, gate: "manual_review" },
      sampled: false,
      reviewed_by: null,
      reviewed_at: null,
      review_notes: null,
      include_in_task_result: true,
      enter_settlement_pool: true,
      risk_flags: [],
      created_by: account.id,
      created_at: "2026-06-27T14:05:00.000Z",
    },
    {
      id: reportBoundApprovedId,
      organization_id: organization.id,
      live_task_id: taskApprovedId,
      project_id: primaryProjectId,
      streamer_id: boundStreamerId,
      status: "approved",
      system_duration: 147,
      screenshot_duration: 146,
      claimed_duration: 146,
      settlement_duration: 147,
      time_source: "system",
      evidence_level: "green",
      divergence_pct: 0.0068,
      divergence_resolved_by: account.id,
      divergence_reason: "系统时长与截图接近，按系统时长结算。",
      viewers: 2320,
      review_mode: "auto",
      auto_rule_version: 1,
      auto_gate_snapshot: { dataset: DATASET.code, cleanReports: 12 },
      sampled: true,
      reviewed_by: account.id,
      reviewed_at: "2026-06-26T15:00:00.000Z",
      review_notes: "通过自动审核，并抽样复核。",
      include_in_task_result: true,
      enter_settlement_pool: true,
      risk_flags: [],
      created_by: account.id,
      created_at: "2026-06-26T14:35:00.000Z",
    },
    {
      id: reportAuditApprovedId,
      organization_id: organization.id,
      live_task_id: taskCompletedId,
      project_id: settlementProjectId,
      streamer_id: auditStreamerId,
      status: "approved",
      system_duration: 142,
      screenshot_duration: 136,
      claimed_duration: 145,
      settlement_duration: 136,
      time_source: "screenshot",
      evidence_level: "yellow",
      divergence_pct: 0.0422,
      divergence_resolved_by: account.id,
      divergence_reason: "截图证据更完整，按截图时长结算。",
      viewers: 2740,
      review_mode: "manual",
      auto_rule_version: 1,
      auto_gate_snapshot: { dataset: DATASET.code, gate: "screenshot_first" },
      sampled: false,
      reviewed_by: account.id,
      reviewed_at: "2026-06-24T16:05:00.000Z",
      review_notes: "黄标证据，进入人工抽查队列。",
      include_in_task_result: true,
      enter_settlement_pool: true,
      risk_flags: ["duration_divergence"],
      created_by: account.id,
      created_at: "2026-06-24T15:40:00.000Z",
    },
    {
      id: reportNeedMoreId,
      organization_id: organization.id,
      live_task_id: taskLiveId,
      project_id: settlementProjectId,
      streamer_id: auditStreamerId,
      status: "need_more",
      system_duration: 42,
      screenshot_duration: 35,
      claimed_duration: 45,
      settlement_duration: null,
      time_source: null,
      evidence_level: "red",
      divergence_pct: 0.1667,
      viewers: 980,
      review_mode: "manual",
      auto_gate_snapshot: {
        dataset: DATASET.code,
        gate: "needs_more_evidence",
      },
      sampled: false,
      reviewed_by: account.id,
      reviewed_at: "2026-06-28T14:00:00.000Z",
      review_notes: "缺少完整下播截图，请补充。",
      include_in_task_result: false,
      enter_settlement_pool: false,
      risk_flags: ["missing_evidence"],
      created_by: account.id,
      created_at: "2026-06-28T13:50:00.000Z",
    },
  ];

  const extraLiveReports = manifest.liveReportIds
    .slice(liveReports.length)
    .map((reportId, offset) => {
      const index = liveReports.length + offset;
      const isSettlementReport =
        offset <
        SHOWCASE_VOLUME.settlementBatchItems - BASE_SETTLEMENT_BATCH_ITEM_COUNT;
      const status = isSettlementReport
        ? "approved"
        : pick(
            [
              "pending",
              "ocr_ing",
              "pending_confirm",
              "pending_review",
              "need_more",
              "rejected",
            ],
            index,
          );
      const taskId = manifest.liveTaskIds[liveTasks.length + offset];
      const projectId = pick(manifest.projectIds, index);
      const streamerId = pick(manifest.streamerIds, index + 5);
      const systemDuration = 80 + (index % 8) * 12;
      const screenshotDuration = Math.max(
        0,
        systemDuration - (index % 9) + (index % 4),
      );
      const settlementDuration =
        status === "approved"
          ? Math.min(systemDuration, screenshotDuration)
          : null;
      const evidenceLevel =
        status === "approved" ? (index % 6 === 0 ? "yellow" : "green") : null;

      return {
        id: reportId,
        organization_id: organization.id,
        live_task_id: taskId,
        project_id: projectId,
        streamer_id: streamerId,
        status,
        system_duration: systemDuration,
        screenshot_duration: screenshotDuration,
        claimed_duration: systemDuration + (index % 7) - 3,
        settlement_duration: settlementDuration,
        time_source:
          status === "approved"
            ? evidenceLevel === "yellow"
              ? "screenshot"
              : "system"
            : null,
        evidence_level: evidenceLevel,
        divergence_pct:
          status === "approved" ? Number(((index % 9) / 100).toFixed(4)) : null,
        divergence_resolved_by: status === "approved" ? account.id : null,
        divergence_reason:
          status === "approved"
            ? "Generated showcase report for settlement demos."
            : null,
        viewers: 700 + index * 37,
        review_mode: index % 3 === 0 ? "auto" : "manual",
        auto_rule_version: index % 3 === 0 ? 1 : null,
        auto_gate_snapshot: { dataset: DATASET.code, bulkIndex: index },
        sampled: index % 7 === 0,
        reviewed_by: ["approved", "rejected", "need_more"].includes(status)
          ? account.id
          : null,
        reviewed_at: ["approved", "rejected", "need_more"].includes(status)
          ? `2026-06-${twoDigit(1 + (index % 28))}T15:00:00.000Z`
          : null,
        review_notes:
          status === "approved"
            ? "Approved generated showcase report."
            : status === "rejected"
              ? "Rejected generated showcase report."
              : null,
        include_in_task_result: status !== "rejected",
        enter_settlement_pool: status === "approved",
        risk_flags:
          evidenceLevel === "yellow"
            ? ["duration_review"]
            : status === "need_more"
              ? ["missing_evidence"]
              : [],
        created_by: account.id,
        created_at: `2026-06-${twoDigit(1 + (index % 28))}T14:05:00.000Z`,
      };
    });
  const allLiveReports = [...liveReports, ...extraLiveReports];

  const settlementBatches = [
    {
      id: payableBatchId,
      organization_id: organization.id,
      project_id: primaryProjectId,
      batch_type: "payable",
      status: "generated",
      period_start: DATASET.periodStart,
      period_end: DATASET.periodEnd,
      computed_amount: 449.5,
      manual_amount: 0,
      adjustment_amount: 50,
      evidence_summary: {
        dataset: DATASET.code,
        reportCount: 2,
        green: 1,
        yellow: 1,
      },
      created_by: account.id,
    },
    {
      id: receivableBatchId,
      organization_id: organization.id,
      project_id: primaryProjectId,
      batch_type: "receivable",
      status: "pending",
      period_start: DATASET.periodStart,
      period_end: DATASET.periodEnd,
      computed_amount: 12800,
      manual_amount: 0,
      adjustment_amount: 0,
      evidence_summary: {
        dataset: DATASET.code,
        vendor: "云途互娱",
        acceptedReports: 2,
      },
      created_by: account.id,
    },
  ];

  const settlementBatchItems = [
    {
      id: payableBoundItemId,
      organization_id: organization.id,
      settlement_batch_id: payableBatchId,
      project_id: primaryProjectId,
      streamer_id: boundStreamerId,
      live_report_id: reportBoundApprovedId,
      item_type: "live_report",
      computed_amount: 269.5,
      manual_amount: 0,
      adjustment_amount: 0,
      evidence_level: "green",
      evidence_snapshot: {
        dataset: DATASET.code,
        settlementDuration: 147,
        timeSource: "system",
      },
    },
    {
      id: payableAuditItemId,
      organization_id: organization.id,
      settlement_batch_id: payableBatchId,
      project_id: settlementProjectId,
      streamer_id: auditStreamerId,
      live_report_id: reportAuditApprovedId,
      item_type: "live_report",
      computed_amount: 217.6,
      manual_amount: 0,
      adjustment_amount: 50,
      evidence_level: "yellow",
      evidence_snapshot: {
        dataset: DATASET.code,
        settlementDuration: 136,
        timeSource: "screenshot",
      },
    },
    {
      id: receivableManualItemId,
      organization_id: organization.id,
      settlement_batch_id: receivableBatchId,
      project_id: primaryProjectId,
      streamer_id: null,
      live_report_id: null,
      item_type: "manual_revenue_adjustment",
      computed_amount: 12800,
      manual_amount: 0,
      adjustment_amount: 0,
      evidence_level: "green",
      evidence_snapshot: {
        dataset: DATASET.code,
        source: "vendor_acceptance",
        acceptedHours: 4.72,
      },
    },
  ];

  const extraSettlementBatches = manifest.settlementBatchIds
    .slice(settlementBatches.length)
    .map((batchId, offset) => {
      const index = settlementBatches.length + offset;
      const projectId = pick(manifest.projectIds.slice(2), offset);
      const batchType = index % 2 === 0 ? "payable" : "receivable";
      const computedAmount =
        batchType === "payable" ? 1200 + index * 88 : 8800 + index * 420;

      return {
        id: batchId,
        organization_id: organization.id,
        project_id: projectId,
        batch_type: batchType,
        status: pick(["generated", "pending", "confirmed", "locked"], index),
        period_start: DATASET.periodStart,
        period_end: DATASET.periodEnd,
        computed_amount: computedAmount,
        manual_amount: 0,
        adjustment_amount: index % 5 === 0 ? 80 : 0,
        evidence_summary: {
          dataset: DATASET.code,
          volume: "large_showcase",
          reportCount: 2 + (index % 6),
        },
        created_by: account.id,
      };
    });
  const allSettlementBatches = [
    ...settlementBatches,
    ...extraSettlementBatches,
  ];

  const extraSettlementBatchItems = manifest.settlementBatchItemIds
    .slice(settlementBatchItems.length)
    .map((itemId, offset) => {
      const index = settlementBatchItems.length + offset;
      const report = extraLiveReports[offset];
      const batch = pick(allSettlementBatches, index);
      const settlementDuration = report?.settlement_duration ?? 90;
      const hourlyRate = 70 + (index % 8) * 10;

      return {
        id: itemId,
        organization_id: organization.id,
        settlement_batch_id: batch.id,
        project_id: report?.project_id ?? batch.project_id,
        streamer_id: report?.streamer_id ?? null,
        live_report_id: report?.id ?? null,
        item_type: "live_report",
        computed_amount: Number(
          ((settlementDuration / 60) * hourlyRate).toFixed(2),
        ),
        manual_amount: 0,
        adjustment_amount: index % 9 === 0 ? 30 : 0,
        evidence_level: index % 6 === 0 ? "yellow" : "green",
        evidence_snapshot: {
          dataset: DATASET.code,
          settlementDuration,
          timeSource: index % 6 === 0 ? "screenshot" : "system",
          volume: "large_showcase",
        },
      };
    });
  const allSettlementBatchItems = [
    ...settlementBatchItems,
    ...extraSettlementBatchItems,
  ];

  const projectApplications = [
    {
      id: applicationRecordingId,
      organization_id: organization.id,
      project_id: primaryProjectId,
      streamer_id: trialStreamerId,
      source: "signup",
      status: "recording_reviewing",
      invited_by: null,
      submitted_at: "2026-06-23T06:30:00.000Z",
      decided_by: null,
      decided_at: null,
      decision_reason: null,
    },
    {
      id: applicationConfirmedId,
      organization_id: organization.id,
      project_id: primaryProjectId,
      streamer_id: boundStreamerId,
      source: "direct_invite",
      status: "joined",
      invited_by: account.id,
      submitted_at: "2026-06-19T06:30:00.000Z",
      decided_by: account.id,
      decided_at: "2026-06-19T08:00:00.000Z",
      decision_reason: "历史履约稳定，直接加入项目。",
    },
    {
      id: applicationRejectedId,
      organization_id: organization.id,
      project_id: settlementProjectId,
      streamer_id: trialStreamerId,
      source: "signup",
      status: "recording_rejected",
      invited_by: null,
      submitted_at: "2026-06-16T06:30:00.000Z",
      decided_by: account.id,
      decided_at: "2026-06-16T09:00:00.000Z",
      decision_reason: "录屏内容与项目调性不匹配，建议调整后再投递。",
    },
  ];

  const extraProjectApplications = manifest.projectApplicationIds
    .slice(projectApplications.length)
    .map((applicationId, offset) => {
      const index = projectApplications.length + offset;
      const status = pick(
        [
          "submitted",
          "invited",
          "recording_required",
          "recording_reviewing",
          "recording_approved",
          "confirmed",
          "joined",
          "declined",
        ],
        index,
      );
      const source = index % 2 === 0 ? "signup" : "direct_invite";
      const decided = [
        "recording_approved",
        "confirmed",
        "joined",
        "declined",
      ].includes(status);

      return {
        id: applicationId,
        organization_id: organization.id,
        project_id: pick(manifest.projectIds, index + 2),
        streamer_id: pick(manifest.streamerIds, index + 7),
        source,
        status,
        invited_by: source === "direct_invite" ? account.id : null,
        submitted_at: `2026-06-${twoDigit(1 + (index % 24))}T06:30:00.000Z`,
        decided_by: decided ? account.id : null,
        decided_at: decided
          ? `2026-06-${twoDigit(2 + (index % 23))}T09:00:00.000Z`
          : null,
        decision_reason: decided
          ? "Generated showcase application decision."
          : null,
      };
    });
  const allProjectApplications = [
    ...projectApplications,
    ...extraProjectApplications,
  ];

  const recordingSubmissions = [
    {
      id: recordingReviewingId,
      organization_id: organization.id,
      application_id: applicationRecordingId,
      project_id: primaryProjectId,
      streamer_id: trialStreamerId,
      version: 1,
      storage_path: `product-showcase/${suffix}/trial-review.mp4`,
      external_url: null,
      file_hash: `showcase-recording-${suffix}-review`,
      duration_seconds: 186,
      status: "reviewing",
      submitted_at: "2026-06-23T07:00:00.000Z",
      reviewed_by: null,
      reviewed_at: null,
      review_note: null,
    },
    {
      id: recordingApprovedId,
      organization_id: organization.id,
      application_id: applicationConfirmedId,
      project_id: primaryProjectId,
      streamer_id: boundStreamerId,
      version: 1,
      storage_path: `product-showcase/${suffix}/bound-approved.mp4`,
      external_url: null,
      file_hash: `showcase-recording-${suffix}-approved`,
      duration_seconds: 214,
      status: "approved",
      submitted_at: "2026-06-19T07:00:00.000Z",
      reviewed_by: account.id,
      reviewed_at: "2026-06-19T08:00:00.000Z",
      review_note: "节奏清晰，可以进入首发项目。",
    },
  ];

  const extraRecordingSubmissions = manifest.recordingSubmissionIds
    .slice(recordingSubmissions.length)
    .map((submissionId, offset) => {
      const index = recordingSubmissions.length + offset;
      const application = extraProjectApplications[offset];
      const status = pick(
        ["submitted", "reviewing", "approved", "rejected", "needs_changes"],
        index,
      );
      const reviewed = ["approved", "rejected", "needs_changes"].includes(
        status,
      );

      return {
        id: submissionId,
        organization_id: organization.id,
        application_id: application.id,
        project_id: application.project_id,
        streamer_id: application.streamer_id,
        version: 1,
        storage_path: `product-showcase/${suffix}/recordings/${submissionId}.mp4`,
        external_url: null,
        file_hash: `showcase-recording-${suffix}-${index}`,
        duration_seconds: 120 + (index % 7) * 18,
        status,
        submitted_at: `2026-06-${twoDigit(1 + (index % 24))}T07:00:00.000Z`,
        reviewed_by: reviewed ? account.id : null,
        reviewed_at: reviewed
          ? `2026-06-${twoDigit(2 + (index % 23))}T08:00:00.000Z`
          : null,
        review_note: reviewed ? "Generated showcase recording review." : null,
      };
    });
  const allRecordingSubmissions = [
    ...recordingSubmissions,
    ...extraRecordingSubmissions,
  ];

  const projectStreamers = [
    {
      id: manifest.projectStreamerIds[0],
      organization_id: organization.id,
      project_id: primaryProjectId,
      streamer_id: boundStreamerId,
      status: "joined",
      joined_at: "2026-06-19T08:00:00.000Z",
      decision_reason: "直接邀请并确认加入。",
      settlement_method: "base_salary_cpt",
      hourly_rate: 110,
      base_salary: 1800,
      cps_rate_bps: 800,
      settlement_rule: { dataset: DATASET.code, role: "primary_anchor" },
      created_by: account.id,
    },
    {
      id: manifest.projectStreamerIds[1],
      organization_id: organization.id,
      project_id: settlementProjectId,
      streamer_id: auditStreamerId,
      status: "joined",
      joined_at: "2026-06-02T08:00:00.000Z",
      decision_reason: "供应商推荐，人工复核通过。",
      settlement_method: "cpt",
      hourly_rate: 96,
      base_salary: 0,
      cps_rate_bps: 500,
      settlement_rule: { dataset: DATASET.code, role: "retention_anchor" },
      created_by: account.id,
    },
    {
      id: manifest.projectStreamerIds[2],
      organization_id: organization.id,
      project_id: primaryProjectId,
      streamer_id: trialStreamerId,
      status: "screening",
      joined_at: null,
      decision_reason: "等待录屏审核。",
      settlement_method: "cpt",
      hourly_rate: 80,
      base_salary: 0,
      cps_rate_bps: 0,
      settlement_rule: { dataset: DATASET.code, role: "trial_anchor" },
      created_by: account.id,
    },
  ];

  const extraProjectStreamers = manifest.projectStreamerIds
    .slice(projectStreamers.length)
    .map((projectStreamerId, offset) => {
      const index = projectStreamers.length + offset;
      const status = pick(["joined", "joined", "screening", "approved"], index);
      const hourlyRate = 72 + (index % 9) * 8;

      return {
        id: projectStreamerId,
        organization_id: organization.id,
        project_id: pick(manifest.projectIds, index + 2),
        streamer_id: manifest.streamerIds[index],
        status,
        joined_at:
          status === "joined"
            ? `2026-06-${twoDigit(1 + (index % 24))}T08:00:00.000Z`
            : null,
        decision_reason: "Generated showcase assignment.",
        settlement_method: index % 4 === 0 ? "base_salary_cpt" : "cpt",
        hourly_rate: hourlyRate,
        base_salary: index % 4 === 0 ? 900 + index * 10 : 0,
        cps_rate_bps: 300 + (index % 7) * 100,
        settlement_rule: {
          dataset: DATASET.code,
          volume: "large_showcase",
          role: pick(["lead", "support", "trial"], index),
        },
        created_by: account.id,
      };
    });
  const allProjectStreamers = [...projectStreamers, ...extraProjectStreamers];

  const streamerAccounts = allStreamers.flatMap((streamer, index) => [
    {
      id: manifest.streamerAccountIds[index],
      organization_id: organization.id,
      streamer_id: streamer.id,
      platform: "douyin",
      account_handle: `showcase_${suffix}_${index + 1}`,
      account_url: `https://example.cn/showcase/${suffix}/${index + 1}`,
      follower_count: [128000, 86000, 31000][index] ?? 22000 + index * 1300,
      is_primary: true,
      verified_at: "2026-06-18T08:00:00.000Z",
    },
  ]);

  const liveReportTuples = [
    [
      reportReviewId,
      screenshotReviewId,
      ocrReviewId,
      boundStreamerId,
      primaryProjectId,
      119,
      1860,
      "pending_review",
    ],
    [
      reportBoundApprovedId,
      screenshotBoundId,
      ocrBoundId,
      boundStreamerId,
      primaryProjectId,
      146,
      2320,
      "succeeded",
    ],
    [
      reportAuditApprovedId,
      screenshotAuditId,
      ocrAuditId,
      auditStreamerId,
      settlementProjectId,
      136,
      2740,
      "succeeded",
    ],
    [
      reportNeedMoreId,
      screenshotNeedMoreId,
      ocrNeedMoreId,
      auditStreamerId,
      settlementProjectId,
      35,
      980,
      "needs_confirmation",
    ],
  ];

  const reportScreenshots = liveReportTuples.map(
    ([reportId, screenshotId, , streamerId, projectId, duration, viewers]) => ({
      id: screenshotId,
      organization_id: organization.id,
      live_report_id: reportId,
      project_id: projectId,
      streamer_id: streamerId,
      storage_path: `product-showcase/${suffix}/reports/${reportId}.png`,
      file_hash: `showcase-${suffix}-${reportId}`,
      uploaded_by: account.id,
      uploaded_at: "2026-06-28T02:00:00.000Z",
      metadata: { dataset: DATASET.code, duration, viewers },
    }),
  );

  const ocrResults = liveReportTuples.map(
    ([reportId, screenshotId, ocrId, , , duration, viewers, status]) => ({
      id: ocrId,
      organization_id: organization.id,
      live_report_id: reportId,
      screenshot_id: screenshotId,
      status,
      raw_result: {
        dataset: DATASET.code,
        source: "scripted_ocr_result",
        words: ["duration", String(duration), "viewers", String(viewers)],
      },
      extracted_duration: duration,
      extracted_viewers: viewers,
      provider: "scripted",
      confidence: status === "needs_confirmation" ? 72 : 94,
      needs_confirmation: status === "needs_confirmation",
      raw_response: { dataset: DATASET.code, normalized: true },
    }),
  );

  const extraReportScreenshots = extraLiveReports.map((report, offset) => {
    const index = reportScreenshots.length + offset;

    return {
      id: manifest.screenshotIds[index],
      organization_id: organization.id,
      live_report_id: report.id,
      project_id: report.project_id,
      streamer_id: report.streamer_id,
      storage_path: `product-showcase/${suffix}/reports/${report.id}.png`,
      file_hash: `showcase-${suffix}-${report.id}`,
      uploaded_by: account.id,
      uploaded_at: `2026-06-${twoDigit(1 + (index % 28))}T14:00:00.000Z`,
      metadata: {
        dataset: DATASET.code,
        duration: report.screenshot_duration,
        viewers: report.viewers,
        volume: "large_showcase",
      },
    };
  });
  const allReportScreenshots = [
    ...reportScreenshots,
    ...extraReportScreenshots,
  ];

  const extraOcrResults = extraLiveReports.map((report, offset) => {
    const index = ocrResults.length + offset;
    const status =
      report.status === "need_more"
        ? "needs_confirmation"
        : report.status === "ocr_ing"
          ? "processing"
          : "succeeded";

    return {
      id: manifest.ocrResultIds[index],
      organization_id: organization.id,
      live_report_id: report.id,
      screenshot_id: manifest.screenshotIds[index],
      status,
      raw_result: {
        dataset: DATASET.code,
        source: "scripted_ocr_result",
        words: [
          "duration",
          String(report.screenshot_duration),
          "viewers",
          String(report.viewers),
        ],
      },
      extracted_duration: report.screenshot_duration,
      extracted_viewers: report.viewers,
      provider: "scripted",
      confidence: status === "needs_confirmation" ? 72 : 94,
      needs_confirmation: status === "needs_confirmation",
      raw_response: { dataset: DATASET.code, normalized: true },
    };
  });
  const allOcrResults = [...ocrResults, ...extraOcrResults];

  const rows = {
    manifest,
    partnerOrganization: {
      id: manifest.partnerOrganizationId,
      name: "外部协作样例 MCN",
      code: manifest.partnerOrganizationCode,
    },
    suppliers: [
      {
        id: supplierId,
        organization_id: organization.id,
        name: "北辰内容供应",
        contact_name: "陈知行",
        contact_phone: "13800002001",
        note: DATASET.code,
      },
    ],
    projects: allProjects,
    streamers: allStreamers,
    streamerAccounts,
    streamerSuppliers: allStreamers.map((streamer, index) => ({
      id: manifest.streamerSupplierIds[index],
      organization_id: organization.id,
      streamer_id: streamer.id,
      supplier_id: supplierId,
      relation_type: index === 0 ? "signed" : "cooperation",
      is_primary: true,
    })),
    projectStreamers: allProjectStreamers,
    projectApplications: allProjectApplications,
    recordingSubmissions: allRecordingSubmissions,
    liveTasks: allLiveTasks,
    liveReports: allLiveReports,
    reportScreenshots: allReportScreenshots,
    ocrResults: allOcrResults,
    reportChangeLogs: [
      {
        id: manifest.reportChangeLogIds[0],
        organization_id: organization.id,
        live_report_id: reportAuditApprovedId,
        changed_by: account.id,
        before_json: { settlementDuration: 142 },
        after_json: { settlementDuration: 136 },
        changed_fields: ["settlement_duration", "time_source"],
        reason: "截图证据优先。",
      },
    ],
    autoReviewRules: [
      {
        id: manifest.autoReviewRuleIds[0],
        organization_id: organization.id,
        version: (Number.parseInt(suffix.slice(0, 6), 16) % 100000) + 1,
        status: "shadow",
        scope: { dataset: DATASET.code, projectIds: manifest.projectIds },
        auto_review_enabled: true,
        divergence_threshold_pct: 0.08,
        divergence_threshold_min: 10,
        daily_duration_cap: 480,
        planned_duration_tolerance: 0.25,
        baseline_deviation_pct: 0.45,
        probation_clean_reports: 5,
        sample_rate: 0.3,
        effective_at: DATASET.now,
        created_by: account.id,
      },
    ],
    reviewSamples: [
      {
        id: manifest.reviewSampleIds[0],
        organization_id: organization.id,
        live_report_id: reportBoundApprovedId,
        sampled_by: account.id,
        sampled_at: "2026-06-26T15:10:00.000Z",
        result: "upheld",
        notes: "抽样复核通过。",
      },
    ],
    settlementBatches: allSettlementBatches,
    settlementBatchItems: allSettlementBatchItems,
    projectCollaborationShares: [
      {
        id: collaborationShareId,
        owner_organization_id: organization.id,
        project_id: primaryProjectId,
        token_hash: sha256Hex(`${DATASET.code}:${suffix}:share`),
        status: "active",
        expires_at: "2026-07-12T02:00:00.000Z",
        allow_applications: true,
        visible_fields: [
          "projectName",
          "collaborationSummary",
          "collaborationTerms",
        ],
        created_by: account.id,
        last_viewed_at: "2026-06-27T02:00:00.000Z",
        last_submitted_at: "2026-06-27T03:00:00.000Z",
      },
    ],
    projectCollaborationApplications: [
      {
        id: collaborationApplicationId,
        share_id: collaborationShareId,
        project_id: primaryProjectId,
        owner_organization_id: organization.id,
        applicant_organization_id: manifest.partnerOrganizationId,
        requested_revenue_share_bps: 2500,
        owner_counter_revenue_share_bps: null,
        final_revenue_share_bps: 2200,
        status: "approved",
        applicant_note: "可提供 12 名垂类主播和一名运营对接。",
        owner_review_note: "同意协作，按 22% 项目收入结算。",
        rejection_reason: "",
        submitted_by: account.id,
        reviewed_by: account.id,
        reviewed_at: "2026-06-27T04:00:00.000Z",
        applicant_confirmed_by: account.id,
        applicant_confirmed_at: "2026-06-27T04:05:00.000Z",
      },
    ],
    projectCollaborationAgreements: [
      {
        id: collaborationAgreementId,
        application_id: collaborationApplicationId,
        project_id: primaryProjectId,
        owner_organization_id: organization.id,
        partner_organization_id: manifest.partnerOrganizationId,
        revenue_share_bps: 2200,
        settlement_basis: "project_revenue",
        status: "active",
        owner_confirmed_by: account.id,
        owner_confirmed_at: "2026-06-27T04:00:00.000Z",
        partner_confirmed_by: account.id,
        partner_confirmed_at: "2026-06-27T04:05:00.000Z",
        status_reason: null,
      },
    ],
    projectCollaborationRevenueRecords: [
      {
        id: revenueRecordAId,
        agreement_id: collaborationAgreementId,
        project_id: primaryProjectId,
        owner_organization_id: organization.id,
        partner_organization_id: manifest.partnerOrganizationId,
        period_start: DATASET.periodStart,
        period_end: "2026-06-15",
        revenue_amount: 386000,
        status: "confirmed",
        evidence_snapshot: { dataset: DATASET.code, channel: "iap" },
        created_by: account.id,
        confirmed_by: account.id,
        confirmed_at: "2026-06-16T02:00:00.000Z",
      },
      {
        id: revenueRecordBId,
        agreement_id: collaborationAgreementId,
        project_id: primaryProjectId,
        owner_organization_id: organization.id,
        partner_organization_id: manifest.partnerOrganizationId,
        period_start: "2026-06-16",
        period_end: DATASET.periodEnd,
        revenue_amount: 524000,
        status: "confirmed",
        evidence_snapshot: { dataset: DATASET.code, channel: "ad_revenue" },
        created_by: account.id,
        confirmed_by: account.id,
        confirmed_at: "2026-06-28T02:00:00.000Z",
      },
    ],
    projectCollaborationSettlementBatches: [
      {
        id: collaborationSettlementBatchId,
        agreement_id: collaborationAgreementId,
        project_id: primaryProjectId,
        owner_organization_id: organization.id,
        partner_organization_id: manifest.partnerOrganizationId,
        batch_type: "partner_receivable",
        status: "generated",
        period_start: DATASET.periodStart,
        period_end: DATASET.periodEnd,
        computed_amount: 200200,
        manual_amount: 0,
        adjustment_amount: 0,
        evidence_summary: {
          dataset: DATASET.code,
          revenueAmount: 910000,
          revenueShareBps: 2200,
        },
        created_by: account.id,
      },
    ],
    projectCollaborationSettlementItems: [
      {
        id: collaborationSettlementItemAId,
        settlement_batch_id: collaborationSettlementBatchId,
        agreement_id: collaborationAgreementId,
        revenue_record_id: revenueRecordAId,
        project_id: primaryProjectId,
        owner_organization_id: organization.id,
        partner_organization_id: manifest.partnerOrganizationId,
        batch_type: "partner_receivable",
        item_type: "project_revenue_share",
        revenue_amount: 386000,
        revenue_share_bps: 2200,
        computed_amount: 84920,
        manual_amount: 0,
        adjustment_amount: 0,
        evidence_snapshot: {
          dataset: DATASET.code,
          revenueRecordId: revenueRecordAId,
        },
      },
      {
        id: collaborationSettlementItemBId,
        settlement_batch_id: collaborationSettlementBatchId,
        agreement_id: collaborationAgreementId,
        revenue_record_id: revenueRecordBId,
        project_id: primaryProjectId,
        owner_organization_id: organization.id,
        partner_organization_id: manifest.partnerOrganizationId,
        batch_type: "partner_receivable",
        item_type: "project_revenue_share",
        revenue_amount: 524000,
        revenue_share_bps: 2200,
        computed_amount: 115280,
        manual_amount: 0,
        adjustment_amount: 0,
        evidence_snapshot: {
          dataset: DATASET.code,
          revenueRecordId: revenueRecordBId,
        },
      },
    ],
    notifications: [
      {
        id: notificationTaskId,
        organization_id: organization.id,
        recipient_user_id: account.id,
        recipient_role: null,
        notification_type: "task",
        status: "unread",
        title: "今晚有 1 场新品预热直播",
        content: "云栈晨光将在 20:00 开始新品首日预热直播。",
        object_type: "live_task",
        object_id: taskUpcomingId,
        source: DATASET.source,
        is_high_risk: false,
      },
      {
        id: notificationReviewId,
        organization_id: organization.id,
        recipient_user_id: account.id,
        recipient_role: null,
        notification_type: "review",
        status: "unread",
        title: "1 条直播报告等待复核",
        content: "录屏复核中的直播已经完成 OCR，需要运营确认。",
        object_type: "live_report",
        object_id: reportReviewId,
        source: DATASET.source,
        is_high_risk: false,
      },
      {
        id: notificationRiskId,
        organization_id: organization.id,
        recipient_user_id: account.id,
        recipient_role: null,
        notification_type: "anomaly",
        status: "handled",
        title: "时长差异已按截图证据处理",
        content: "光塔长线项目存在截图差异，已进入黄标结算证据。",
        object_type: "live_report",
        object_id: reportAuditApprovedId,
        source: DATASET.source,
        is_high_risk: true,
        handled_at: "2026-06-24T16:10:00.000Z",
      },
      {
        id: notificationSettlementId,
        organization_id: organization.id,
        recipient_user_id: account.id,
        recipient_role: null,
        notification_type: "settlement",
        status: "unread",
        title: "6 月应付批次已生成",
        content: "本批次包含 2 条已审核报告和 1 条调整项。",
        object_type: "settlement_batch",
        object_id: payableBatchId,
        source: DATASET.source,
        is_high_risk: false,
      },
      ...manifest.notificationIds.slice(4).map((notificationId, offset) => {
        const index = 4 + offset;
        const notificationType = pick(
          ["task", "review", "anomaly", "settlement", "system"],
          index,
        );
        const objectType =
          notificationType === "task"
            ? "live_task"
            : notificationType === "settlement"
              ? "settlement_batch"
              : notificationType === "system"
                ? "project"
                : "live_report";
        const objectId =
          objectType === "live_task"
            ? pick(allLiveTasks, index).id
            : objectType === "settlement_batch"
              ? pick(allSettlementBatches, index).id
              : objectType === "project"
                ? pick(allProjects, index).id
                : pick(allLiveReports, index).id;

        return {
          id: notificationId,
          organization_id: organization.id,
          recipient_user_id: account.id,
          recipient_role: null,
          notification_type: notificationType,
          status: pick(["unread", "unread", "read", "handled"], index),
          title: `Showcase notification ${String(index + 1).padStart(2, "0")}`,
          content: `Generated showcase notification ${index + 1}.`,
          object_type: objectType,
          object_id: objectId,
          source: DATASET.source,
          is_high_risk: notificationType === "anomaly",
          handled_at:
            notificationType === "anomaly"
              ? `2026-06-${twoDigit(1 + (index % 28))}T16:10:00.000Z`
              : null,
        };
      }),
    ],
    billingPlan: {
      id: manifest.billingPlanId,
      code: "product_showcase_growth_v1",
      tier: "pro",
      name: "Product Showcase Growth",
      monthly_price_cents: 0,
      annual_price_cents: 0,
      included_active_streamers: 100,
      included_seats: 8,
      included_ocr: 300,
      included_ai: 200,
      included_storage_mb: 2048,
      included_exports: 50,
      features: { dataset: DATASET.code, showcase: true },
    },
    organizationSubscription: {
      id: manifest.organizationSubscriptionId,
      organization_id: organization.id,
      plan_id: manifest.billingPlanId,
      status: "active",
      billing_cycle: "monthly",
      current_period_start: DATASET.periodStart,
      current_period_end: DATASET.periodEnd,
      trial_ends_at: null,
    },
    usageEvents: DATASET.requiredUsageMetrics.map((metric, index) => ({
      id: manifest.usageEventIds[index],
      organization_id: organization.id,
      metric,
      quantity: [75, 8, 120, 64, 4096, 18][index],
      period_month: DATASET.periodMonth,
      source: DATASET.source,
      object_type: "product_showcase",
      object_id: manifest.datasetCode,
      metadata: { dataset: DATASET.code, metric },
    })),
    usageMonthlyCounters: DATASET.requiredUsageMetrics.map((metric, index) => ({
      id: manifest.usageCounterIds[index],
      organization_id: organization.id,
      metric,
      period_month: DATASET.periodMonth,
      used_quantity: [75, 8, 120, 64, 4096, 18][index],
      included_quantity: [100, 12, 500, 300, 8192, 80][index],
      addon_quantity: metric === "ocr" ? 100 : 0,
    })),
    usageAddons: [
      {
        id: manifest.usageAddonIds[0],
        organization_id: organization.id,
        metric: "ocr",
        quantity: 100,
        amount_cents: 0,
        period_start: DATASET.periodStart,
        period_end: DATASET.periodEnd,
        status: "active",
      },
    ],
  };

  return rows;
}

export function createProductShowcaseRunner(adapter) {
  return {
    async load(input) {
      const targetAccount = await resolveAccount(adapter, input);
      const organization = await adapter.resolveTargetOrganization(
        targetAccount,
        input,
      );
      const manifest = buildShowcaseManifest({
        accountId: targetAccount.id,
        organizationId: organization.id,
      });
      await adapter.clearRows(manifest);
      const rows = buildShowcaseRows({
        account: targetAccount,
        organization,
      });
      await adapter.insertRows(rows, manifest);
      return adapter.summarize(manifest, targetAccount);
    },
    async verify(input) {
      const targetAccount = await resolveAccount(adapter, input);
      const organization = await adapter.resolveTargetOrganization(
        targetAccount,
        input,
      );
      const manifest = buildShowcaseManifest({
        accountId: targetAccount.id,
        organizationId: organization.id,
      });
      return adapter.summarize(manifest, targetAccount);
    },
    async clear(input) {
      const targetAccount = await resolveAccount(adapter, input);
      const organization = await adapter.resolveTargetOrganization(
        targetAccount,
        input,
      );
      const manifest = buildShowcaseManifest({
        accountId: targetAccount.id,
        organizationId: organization.id,
      });
      await adapter.clearRows(manifest);
      return adapter.summarize(manifest, targetAccount);
    },
  };
}

function resolveAccount(adapter, input) {
  return adapter.resolveTargetAccount(input?.account);
}

function extendStableIds(seedIds, totalCount, createId) {
  return [
    ...seedIds,
    ...range(seedIds.length, totalCount).map((index) => createId(index)),
  ];
}

function range(startInclusive, endExclusive) {
  return Array.from(
    { length: Math.max(0, endExclusive - startInclusive) },
    (_, offset) => startInclusive + offset,
  );
}

function pick(values, index) {
  return values[index % values.length];
}

function twoDigit(value) {
  return String(value).padStart(2, "0");
}

function stableUuid(input) {
  const bytes = Buffer.from(
    createHash("sha256").update(input).digest(),
  ).subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

function shortHash(input) {
  return createHash("sha256").update(input).digest("hex").slice(0, 10);
}

function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
