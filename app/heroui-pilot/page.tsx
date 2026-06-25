"use client";

import * as React from "react";
import { Button, Card, Chip, Input, Table } from "@heroui/react";

// —— 试点用示例数据(铺开时会接你真实的 Supabase 项目 DTO)——
type Project = {
  id: string;
  code: string;
  name: string;
  vendor: string;
  product: string;
  status: keyof typeof STATUS;
  pricing: string;
  leadOps: string;
  activeStreamers: number;
  totalStreamers: number;
  doneHours: number;
  plannedHours: number;
  gross: number;
  margin: number;
  risk: "low" | "mid" | "high";
};

const STATUS = {
  active: { label: "进行中", color: "success" as const },
  recruiting: { label: "招募中", color: "accent" as const },
  settling: { label: "结算中", color: "accent" as const },
  paused: { label: "已暂停", color: "warning" as const },
  ended: { label: "已结束", color: "default" as const },
};

const RISK = {
  low: { label: "低", color: "success" as const },
  mid: { label: "中", color: "warning" as const },
  high: { label: "高", color: "danger" as const },
};

const PROJECTS: Project[] = [
  { id: "P-1042", code: "BRAND-S1", name: "品牌直播专项", vendor: "鎏光互娱", product: "星海纪元", status: "active", pricing: "时薪 + 提成", leadOps: "陈薇", activeStreamers: 24, totalStreamers: 31, doneHours: 1820, plannedHours: 2400, gross: 486000, margin: 22.4, risk: "low" },
  { id: "P-1038", code: "MOBA-Q3", name: "MOBA 赛事陪播", vendor: "深蓝网络", product: "巅峰对决", status: "recruiting", pricing: "纯时薪", leadOps: "李航", activeStreamers: 8, totalStreamers: 26, doneHours: 320, plannedHours: 1600, gross: 92000, margin: 15.1, risk: "mid" },
  { id: "P-1031", code: "CARD-NY", name: "卡牌新年活动", vendor: "瀚海文化", product: "灵契", status: "settling", pricing: "保底 + 阶梯", leadOps: "王琪", activeStreamers: 17, totalStreamers: 19, doneHours: 2980, plannedHours: 3000, gross: 731000, margin: 28.7, risk: "low" },
  { id: "P-1025", code: "FPS-EX", name: "射击品类拓展", vendor: "鎏光互娱", product: "深空突围", status: "paused", pricing: "时薪 + 提成", leadOps: "陈薇", activeStreamers: 5, totalStreamers: 22, doneHours: 640, plannedHours: 2000, gross: 58000, margin: 8.9, risk: "high" },
  { id: "P-1019", code: "SLG-LT", name: "策略长线运营", vendor: "星澜游戏", product: "万象征途", status: "active", pricing: "纯提成", leadOps: "赵敏", activeStreamers: 31, totalStreamers: 34, doneHours: 4120, plannedHours: 4800, gross: 1024000, margin: 31.2, risk: "low" },
  { id: "P-1007", code: "RPG-CL", name: "二次元收尾结算", vendor: "瀚海文化", product: "缥缈录", status: "ended", pricing: "保底 + 阶梯", leadOps: "王琪", activeStreamers: 0, totalStreamers: 12, doneHours: 1560, plannedHours: 1560, gross: 348000, margin: 19.8, risk: "mid" },
];

const STATUS_FILTERS = [
  { key: "all", label: "全部" },
  { key: "active", label: "进行中" },
  { key: "recruiting", label: "招募中" },
  { key: "settling", label: "结算中" },
  { key: "paused", label: "已暂停" },
  { key: "ended", label: "已结束" },
] as const;

function Initials({ name }: { name: string }) {
  return (
    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-default-200 text-[11px] font-semibold text-default-700">
      {name.slice(0, 1)}
    </span>
  );
}

export default function HeroUiPilotPage() {
  const [status, setStatus] = React.useState<string>("all");
  const [query, setQuery] = React.useState("");

  const normalized = query.trim().toLowerCase();
  const filtered = PROJECTS.filter((p) => {
    const matchStatus = status === "all" || p.status === status;
    const matchQuery =
      !normalized ||
      [p.name, p.code, p.id, p.vendor, p.product, p.leadOps]
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    return matchStatus && matchQuery;
  });

  return (
    <main className="min-h-screen bg-default-50 p-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        {/* 页头 */}
        <header className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-default-900">项目管理</h1>
            <p className="mt-1 text-sm text-default-500">
              厂商 → 产品 → 项目；同时管理报名、录屏、排班、报数与结算
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm">
              导出项目表
            </Button>
            <Button variant="primary" size="sm">
              新建项目
            </Button>
          </div>
        </header>

        <Card className="p-0">
          {/* 状态筛选 */}
          <div className="flex flex-wrap items-center gap-2 border-b border-default-200 px-4 py-3">
            {STATUS_FILTERS.map((f) => (
              <button key={f.key} onClick={() => setStatus(f.key)} type="button">
                <Chip
                  variant={status === f.key ? "primary" : "soft"}
                  color={status === f.key ? "accent" : "default"}
                  size="sm"
                >
                  {f.label}
                </Chip>
              </button>
            ))}
          </div>

          {/* 工具条 */}
          <div className="flex items-center gap-3 border-b border-default-200 px-4 py-3">
            <Input
              className="w-72"
              placeholder="项目名 / 编号 / 厂商"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="flex-1" />
            <span className="text-sm text-default-500">
              共 <b className="text-default-800">{filtered.length}</b> 个项目
            </span>
          </div>

          {/* 表格 */}
          <Table className="w-full">
           <Table.Content aria-label="项目列表">
            <Table.Header>
              <Table.Column isRowHeader>项目</Table.Column>
              <Table.Column>厂商 / 产品</Table.Column>
              <Table.Column>状态</Table.Column>
              <Table.Column>结算方式</Table.Column>
              <Table.Column>负责人</Table.Column>
              <Table.Column>主播</Table.Column>
              <Table.Column>直播时长</Table.Column>
              <Table.Column>预估毛利</Table.Column>
              <Table.Column>风险</Table.Column>
            </Table.Header>
            <Table.Body>
              {filtered.map((p) => (
                <Table.Row key={p.id} id={p.id}>
                  <Table.Cell>
                    <div className="flex flex-col">
                      <span className="font-medium text-default-900">{p.name}</span>
                      <span className="text-xs text-default-400">
                        {p.id} · {p.code}
                      </span>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex flex-col">
                      <span className="text-default-700">{p.vendor}</span>
                      <span className="text-xs text-default-400">{p.product}</span>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <Chip color={STATUS[p.status].color} variant="soft" size="sm">
                      {STATUS[p.status].label}
                    </Chip>
                  </Table.Cell>
                  <Table.Cell>
                    <span className="text-sm text-default-600">{p.pricing}</span>
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex items-center gap-2">
                      <Initials name={p.leadOps} />
                      <span className="text-sm text-default-700">{p.leadOps}</span>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <span className="text-default-900">{p.activeStreamers}</span>
                    <span className="text-default-400"> / {p.totalStreamers}</span>
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex flex-col">
                      <span className="text-default-900">
                        {p.doneHours.toLocaleString()} h
                      </span>
                      <span className="text-xs text-default-400">
                        / 计划 {p.plannedHours.toLocaleString()}
                      </span>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex flex-col">
                      <span className="text-default-900">
                        ¥{p.gross.toLocaleString()}
                      </span>
                      <span className="text-xs text-default-400">
                        {p.margin.toFixed(1)}%
                      </span>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <Chip color={RISK[p.risk].color} variant="soft" size="sm">
                      {RISK[p.risk].label}
                    </Chip>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
           </Table.Content>
          </Table>
        </Card>
      </div>
    </main>
  );
}
