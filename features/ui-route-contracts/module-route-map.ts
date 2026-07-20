export type OpsModuleId =
  | "m0"
  | "m1"
  | "m2"
  | "m3"
  | "m4"
  | "m5"
  | "m6"
  | "m7"
  | "m8"
  | "m9"
  | "m10"
  | "m11";

export type OpsRouteKey =
  | "org"
  | "projects"
  | "streamers"
  | "admission"
  | "tasks"
  | "reports"
  | "settle"
  | "export"
  | "audit"
  | "notifications"
  | "warroom"
  | "billing";

export type OpsModuleRoute = {
  module: OpsModuleId;
  label: string;
  href: string;
  routeKey: OpsRouteKey;
  status: "live" | "partial" | "stub";
};

export const OPS_MODULE_ROUTES: OpsModuleRoute[] = [
  {
    module: "m0",
    label: "M0 组织与权限",
    href: "/console/stubs/m0",
    routeKey: "org",
    status: "stub",
  },
  {
    module: "m1",
    label: "M1 项目管理",
    href: "/console/projects",
    routeKey: "projects",
    status: "partial",
  },
  {
    module: "m2",
    label: "M2 主播池",
    href: "/console/stubs/m2",
    routeKey: "streamers",
    status: "partial",
  },
  {
    module: "m3",
    label: "M3 选播准入",
    href: "/console/stubs/m3",
    routeKey: "admission",
    status: "partial",
  },
  {
    module: "m4",
    label: "M4 排班直播",
    href: "/console/stubs/m4",
    routeKey: "tasks",
    status: "live",
  },
  {
    module: "m5",
    label: "M5 报数审核",
    href: "/console/stubs/m5",
    routeKey: "reports",
    status: "live",
  },
  {
    module: "m6",
    label: "M6 结算批次",
    href: "/console/stubs/m6",
    routeKey: "settle",
    status: "live",
  },
  {
    module: "m7",
    label: "M7 审计中心",
    href: "/console/stubs/m7",
    routeKey: "audit",
    status: "live",
  },
  {
    module: "m8",
    label: "M8 导出交付",
    href: "/console/stubs/m8",
    routeKey: "export",
    status: "live",
  },
  {
    module: "m9",
    label: "M9 通知待办",
    href: "/console/stubs/m9",
    routeKey: "notifications",
    status: "live",
  },
  {
    module: "m10",
    label: "M10 作战台",
    href: "/console/stubs/m10",
    routeKey: "warroom",
    status: "partial",
  },
  {
    module: "m11",
    label: "M11 商业化与套餐",
    href: "/console/stubs/m11",
    routeKey: "billing",
    status: "partial",
  },
];

export function routeForOpsModule(module: string) {
  return OPS_MODULE_ROUTES.find((item) => item.module === module);
}
