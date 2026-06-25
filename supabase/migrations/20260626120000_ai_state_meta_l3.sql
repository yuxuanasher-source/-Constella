-- L3 受限执行的状态元数据（与 features/ai/tiers.ts 同源）。
-- 异常工单 / 转取消 / 通知 经状态机网关 ai_attempt_transition 兜底。

insert into public.state_machine_meta
  (state_machine, state, ai_tier, requires_human_confirm, financial_impact, is_frozen, high_risk_audit)
values
  ('task', 'abnormal_ticket', 'L3_BOUNDED', false, false, false, false),
  ('task', 'cancelled',       'L3_BOUNDED', true,  false, false, false),
  ('notification', 'queued',         'L3_BOUNDED', false, false, false, false),
  ('notification', 'high_risk_sent', 'L3_BOUNDED', true,  false, false, false)
on conflict (state_machine, state) do nothing;
