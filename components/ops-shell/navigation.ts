import {
  BarChart3,
  Bot,
  CalendarClock,
  ClipboardCheck,
  Database,
  FileText,
  FolderKanban,
  Home,
  Landmark,
  Settings,
  ShieldCheck,
  UserRoundCheck,
  Users,
} from "lucide-react";

export const OPS_V2_NAV_ITEMS = [
  { label: "经营总览", href: "/console", icon: Home },
  { label: "项目管理", href: "/console/projects", icon: FolderKanban },
  { label: "主播资源池", href: "/console/streamers", icon: Users },
  { label: "选播准入", href: "/console/admissions", icon: UserRoundCheck },
  { label: "直播排班", href: "/console/schedules", icon: CalendarClock },
  { label: "报数审核", href: "/console/reports", icon: ClipboardCheck },
  { label: "结算中心", href: "/console/settlements", icon: Landmark },
  { label: "审计中心", href: "/console/audit", icon: ShieldCheck },
  { label: "数据导出", href: "/console/exports", icon: FileText },
  { label: "知识库", href: "/console/knowledge", icon: Database },
  { label: "AI 作战台", href: "/console/ai", icon: Bot },
  { label: "组织设置", href: "/console/settings", icon: Settings },
] as const;

export type OpsV2NavItem = (typeof OPS_V2_NAV_ITEMS)[number];

export { BarChart3 };
