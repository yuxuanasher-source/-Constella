"use client";

// 临时 harness:用样例数据渲染真实的运营后台,用于截图验证 HeroUI 原语改造效果。
// 铺开完成后此页可删除。
import OpsReferenceApp from "@/components/reference-ui/ops-reference";

const projectCards = [
  { id: "P-1042", code: "BRAND-S1", name: "品牌直播专项", vendor: "鎏光互娱", product: "星海纪元", status: "active", pricing: "时薪 + 提成", leadOps: "陈薇", bizOwner: "周凯", start: "2026-05-01", end: "2026-08-01", streamers: { active: 24, candidate: 7, pendingReview: 2 }, metrics: { plannedHours: 2400, doneHours: 1820, audience: 120000, reportedPending: 1, anomalies: 0, receivable: 620000, payable: 410000, gross: 486000, margin: 22.4 }, risk: "low" },
  { id: "P-1038", code: "MOBA-Q3", name: "MOBA 赛事陪播", vendor: "深蓝网络", product: "巅峰对决", status: "recruiting", pricing: "纯时薪", leadOps: "李航", bizOwner: "周凯", start: "2026-06-01", end: "2026-09-01", streamers: { active: 8, candidate: 18, pendingReview: 4 }, metrics: { plannedHours: 1600, doneHours: 320, audience: 40000, reportedPending: 3, anomalies: 1, receivable: 120000, payable: 78000, gross: 92000, margin: 15.1 }, risk: "medium" },
  { id: "P-1031", code: "CARD-NY", name: "卡牌新年活动", vendor: "瀚海文化", product: "灵契", status: "settling", pricing: "保底 + 阶梯", leadOps: "王琪", bizOwner: "孙倩", start: "2026-01-01", end: "2026-03-01", streamers: { active: 17, candidate: 2, pendingReview: 0 }, metrics: { plannedHours: 3000, doneHours: 2980, audience: 210000, reportedPending: 0, anomalies: 0, receivable: 910000, payable: 560000, gross: 731000, margin: 28.7 }, risk: "low" },
  { id: "P-1025", code: "FPS-EX", name: "射击品类拓展", vendor: "鎏光互娱", product: "深空突围", status: "paused", pricing: "时薪 + 提成", leadOps: "陈薇", bizOwner: "周凯", start: "2026-04-01", end: "2026-07-01", streamers: { active: 5, candidate: 17, pendingReview: 6 }, metrics: { plannedHours: 2000, doneHours: 640, audience: 22000, reportedPending: 5, anomalies: 3, receivable: 80000, payable: 64000, gross: 58000, margin: 8.9 }, risk: "high" },
  { id: "P-1019", code: "SLG-LT", name: "策略长线运营", vendor: "星澜游戏", product: "万象征途", status: "active", pricing: "纯提成", leadOps: "赵敏", bizOwner: "孙倩", start: "2026-02-01", end: "2026-12-01", streamers: { active: 31, candidate: 3, pendingReview: 1 }, metrics: { plannedHours: 4800, doneHours: 4120, audience: 305000, reportedPending: 2, anomalies: 0, receivable: 1280000, payable: 820000, gross: 1024000, margin: 31.2 }, risk: "low" },
];

export default function HeroUiPilotOpsPage() {
  return <OpsReferenceApp initialRoute="projects" projectCards={projectCards} />;
}
