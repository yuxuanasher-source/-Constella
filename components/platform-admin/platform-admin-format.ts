export function formatCurrencyCents(value: number | null) {
  if (value === null) {
    return "—";
  }
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value / 100);
}

export function formatDateKey(value: string | null | undefined) {
  if (!value) {
    return "—";
  }
  return value.slice(0, 10);
}

export function formatInteger(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

export function lifecycleLabel(value: string) {
  return (
    {
      active: "正常",
      frozen: "已冻结",
      archived: "已归档",
    }[value] ?? value
  );
}

export function subscriptionStatusLabel(value: string) {
  return (
    {
      trialing: "试用中",
      active: "生效中",
      past_due: "已逾期",
      readonly: "只读",
      cancelled: "已取消",
    }[value] ?? value
  );
}

export function roleLabel(value: string) {
  return (
    {
      owner: "负责人",
      ops_manager: "运营负责人",
      operator: "运营",
      operator_business: "商务运营",
      finance: "财务",
      streamer: "主播",
    }[value] ?? value
  );
}
