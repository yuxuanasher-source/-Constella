const memberRoleLabels: Record<string, string> = {
  owner: "负责人",
  ops_manager: "运营负责人",
  operator_business: "次级运营",
  finance: "财务",
  streamer: "主播",
};

export function organizationMemberRouteErrorMessage(error: Error): string {
  const createMatch = error.message.match(
    /^Current role cannot create (.+) accounts$/i,
  );
  if (createMatch) {
    const role = createMatch[1];
    return `当前角色无权创建${memberRoleLabels[role] ?? role}账号`;
  }

  if (error.message === "Current role cannot view organization members") {
    return "当前角色无权查看组织成员";
  }

  if (error.message === "Only owner can manage organization members") {
    return "仅负责人可管理组织成员";
  }

  if (error.message === "Cross-organization access is not allowed") {
    return "当前成员不属于本组织";
  }

  return error.message;
}
